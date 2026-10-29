import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { AuthError, createAuthService } from './auth.js';
import { ImageGenerationError } from './codex-images.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
};

async function jsonBody(request, limit) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || ''))
    throw new AuthError('unsupported_media_type', '请使用 application/json 请求。', 415);
  const length = Number(request.headers['content-length']);
  if (Number.isFinite(length) && length > limit) {
    request.resume?.(); throw new AuthError('payload_too_large', '登录请求体过大。', 413);
  }
  const chunks = []; let bytes = 0;
  const iterator = request.iterator ? request.iterator({ destroyOnReturn: false }) : request;
  for await (const chunk of iterator) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > limit) { request.resume?.(); throw new AuthError('payload_too_large', '登录请求体过大。', 413); }
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw new AuthError('invalid_json', '登录请求不是有效 JSON 对象。', 400); }
}

/** Node request handler; static assets are served only from a built dist/. */
export function createApp({
  authService = createAuthService(), staticDirectory = path.resolve('dist'),
  serveStatic = true, maxBodyBytes = 20_480,
  now = Date.now, rateWindowMs = 60_000, rateLimit = 90, challengeRateLimit = 12,
  localMode = false, localPort = 3000, chatgptService = null, creativeHandler = null, creativeBodyBytes = 65_536, imageService = null,
} = {}) {
  const root = path.resolve(staticDirectory);
  const windows = new Map();
  const localHosts = new Set([`localhost:${localPort}`, `127.0.0.1:${localPort}`]);
  if (localMode && (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535)) throw new TypeError('本机服务端口无效。');
  function assertLocalRequest(request) {
    const host = String(request.headers.host || '').toLowerCase();
    if (!localHosts.has(host)) throw new AuthError('local_host_required', '本机 ChatGPT 服务仅接受 localhost 或 127.0.0.1 的真实主机地址。', 403);
    const origin = request.headers.origin;
    // Browsers forbid scripts from changing Host. Requiring both the real
    // loopback Host and matching Origin prevents DNS rebinding and remote pages.
    if (origin && origin !== `http://${host}`) throw new AuthError('local_origin_required', '本机 ChatGPT 服务仅允许同源的本机网页调用。', 403);
    if (!['GET', 'HEAD'].includes(request.method) && !origin)
      throw new AuthError('origin_required', '此操作需要本机网页的有效来源。', 403);
    const site = request.headers['sec-fetch-site'];
    if (site && !['same-origin', 'none'].includes(site))
      throw new AuthError('local_origin_required', '远程网页不能访问本机 ChatGPT 服务。', 403);
  }
  function requireChatGPT() {
    if (!localMode) throw new AuthError('local_only', 'ChatGPT 计划连接只可在本人电脑的本机服务中使用。', 403);
    if (!chatgptService) throw new AuthError('local_chatgpt_unavailable', '本机 ChatGPT 组件未就绪，请检查安装和配置。', 503);
    return chatgptService;
  }
  async function requirePlanSharing() {
    const service = requireChatGPT();
    const status = await service.status();
    if (status?.session?.sharing !== true)
      throw new AuthError('chatgpt_sharing_required', '请先通过 ChatGPT 官方登录，并明确授权使用自己的计划。', 403);
    return service;
  }

  function limitRequest(request, route) {
    const current = now();
    for (const [key, value] of windows) if (value.expiresAt <= current) windows.delete(key);
    const ip = request.socket?.remoteAddress || 'unknown';
    // Never trust X-Forwarded-For from a public caller. Configure the trusted
    // reverse proxy's rate limiter before horizontal or proxy deployment.
    const kind = route.startsWith('/api/auth/') || (route.startsWith('/api/chatgpt/') && request.method === 'POST') ? 'auth' : 'api';
    const key = `${ip}|${kind}`;
    let window = windows.get(key);
    if (!window) {
      if (windows.size >= 10_000) throw new AuthError('service_busy', '登录服务繁忙，请稍后重试。', 503);
      window = { count: 0, expiresAt: current + rateWindowMs }; windows.set(key, window);
    }
    window.count += 1;
    if (window.count > (kind === 'auth' ? challengeRateLimit : rateLimit))
      throw new AuthError('rate_limited', '登录请求过于频繁，请稍后重试。', 429);
  }
  return async function app(request, response) {
    const requestOrigin = request.headers.origin;
    const headers = { ...securityHeaders, 'Cache-Control': 'no-store' };
    const reply = (status, data, extra = {}) => {
      response.writeHead(status, { ...headers, ...(data === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }), ...extra });
      response.end(data === undefined ? undefined : JSON.stringify(data));
    };
    try {
      if (localMode) assertLocalRequest(request);
      const pathname = new URL(request.url, 'http://central.invalid').pathname;
      const isAPI = pathname.startsWith('/api/');
      if (isAPI) {
        if (!localMode) authService.assertOrigin(requestOrigin, !['GET', 'HEAD'].includes(request.method));
        if (requestOrigin) {
          headers['Access-Control-Allow-Origin'] = requestOrigin;
          headers.Vary = 'Origin';
          // No third-party cookie CORS. Static hosts use a short-lived bearer.
        }
        if (request.method === 'OPTIONS') {
          const method = request.headers['access-control-request-method'];
          if (!['GET', 'POST'].includes(method)) throw new AuthError('method_not_allowed', '不支持此请求方法。', 405);
          const requestedHeaders = (request.headers['access-control-request-headers'] || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
          if (requestedHeaders.some(h => !['content-type', 'authorization'].includes(h)))
            throw new AuthError('headers_not_allowed', '不支持此请求头。', 403);
          return reply(204, undefined, {
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '600',
          });
        }
        limitRequest(request, pathname);
        if (pathname === '/api/health' && request.method === 'GET')
          return reply(200, { status: 'ok', googleConfigured: authService.configured, ...(localMode ? { mode: 'local' } : {}) });
        if (pathname === '/api/config' && request.method === 'GET') return reply(200, {
          ...authService.config(), chatgpt: { enabled: localMode, mode: localMode ? 'local' : 'disabled', configured: Boolean(localMode && chatgptService) },
        });
        if (pathname.startsWith('/api/chatgpt/')) {
          const imageRoute = /^\/api\/chatgpt\/image-jobs(?:\/([0-9a-f-]+)(\/cancel|\/image\.png)?)?$/.exec(pathname);
          if(imageRoute){
            requireChatGPT();
            if(!imageService)throw new ImageGenerationError('image_tool_unavailable','本机图片组件尚未就绪。',503);
            const id=imageRoute[1],suffix=imageRoute[2];
            if(!id&&request.method==='POST')return reply(202,{job:await imageService.start(await jsonBody(request,29*1024*1024))});
            if(id&&!suffix&&request.method==='GET')return reply(200,{job:imageService.get(id)});
            if(id&&suffix==='/cancel'&&request.method==='POST'){await jsonBody(request,maxBodyBytes);return reply(200,{job:imageService.cancel(id)});}
            if(id&&suffix==='/image.png'&&request.method==='GET'){const bytes=await imageService.image(id);response.writeHead(200,{...headers,'Content-Type':'image/png','Content-Length':bytes.length});return response.end(bytes);}
            return reply(405,{error:{code:'method_not_allowed',message:'不支持此图片任务操作。'}});
          }

          if (pathname === '/api/chatgpt/status' && request.method === 'GET')
            return reply(200, await requireChatGPT().status());
          if (pathname === '/api/chatgpt/profiles' && request.method === 'GET') {
            const status = await requireChatGPT().status();
            return reply(200, { profiles: status.profiles || [] });
          }
          if (pathname === '/api/chatgpt/models' && request.method === 'GET') {
            const service = await requirePlanSharing();
            return reply(200, await service.models());
          }
          if (pathname === '/api/chatgpt/sign-in' && request.method === 'POST') {
            await jsonBody(request, maxBodyBytes);
            return reply(200, await requireChatGPT().signIn({ openBrowser: true }));
          }
          if (pathname === '/api/chatgpt/select-profile' && request.method === 'POST') {
            const body = await jsonBody(request, maxBodyBytes);
            if (typeof body.profileId !== 'string' || !body.profileId.trim() || body.profileId.length > 200)
              throw new AuthError('invalid_profile', '请选择有效的本机 ChatGPT 账户。', 400);
            return reply(200, await requireChatGPT().selectProfile(body.profileId));
          }
          if (pathname === '/api/chatgpt/sign-out' && request.method === 'POST') {
            await jsonBody(request, maxBodyBytes);
            return reply(200, await requireChatGPT().signOut());
          }
          if (pathname === '/api/chatgpt/cancel-sign-in' && request.method === 'POST') {
            await jsonBody(request, maxBodyBytes);
            return reply(200, await requireChatGPT().cancelSignIn());
          }
          if (pathname === '/api/chatgpt/creative-generation' && request.method === 'POST') {
            const body = await jsonBody(request, creativeBodyBytes);
            const service = await requirePlanSharing();
            if (typeof creativeHandler !== 'function')
              throw new AuthError('creative_not_configured', '本机文字创作处理器尚未就绪。', 503);
            return reply(200, await creativeHandler(body, { chatgptService: service, request }));
          }
          return reply(404, { error: { code: 'not_found', message: '未找到本机 ChatGPT 接口或请求方法不受支持。' } });
        }

        if (pathname === '/api/auth/challenge' && request.method === 'POST') {
          await jsonBody(request, maxBodyBytes);
          return reply(200, authService.challenge(requestOrigin));
        }
        if (pathname === '/api/auth/google' && request.method === 'POST') {
          const body = await jsonBody(request, maxBodyBytes);
          const result = await authService.exchange(body, requestOrigin);
          return reply(200, result.body, result.cookie ? { 'Set-Cookie': result.cookie } : {});
        }
        if (pathname === '/api/auth/session' && request.method === 'GET') {
          return reply(200, await authService.authenticate({
            authorization: request.headers.authorization, cookie: request.headers.cookie, origin: requestOrigin,
          }));
        }
        if (pathname === '/api/auth/logout' && request.method === 'POST') {
          await jsonBody(request, maxBodyBytes);
          const result = authService.logout({
            authorization: request.headers.authorization, cookie: request.headers.cookie, origin: requestOrigin,
          });
          return reply(204, undefined, result.cookie ? { 'Set-Cookie': result.cookie } : {});
        }
        const known = ['/api/health', '/api/config', '/api/auth/challenge', '/api/auth/google', '/api/auth/session', '/api/auth/logout'];
        return reply(known.includes(pathname) ? 405 : 404, { error: { code: known.includes(pathname) ? 'method_not_allowed' : 'not_found', message: '未找到此 API 或请求方法不受支持。' } });
      }
      if (pathname === '/runtime-config.json' && request.method === 'GET') {
        if (!localMode) authService.assertOrigin(requestOrigin);
        return reply(200, { authEnabled: true, apiBaseUrl: '', googleClientId: authService.config().google.clientId,
          chatgpt: { enabled: localMode, mode: localMode ? 'local' : 'disabled', apiBaseUrl: '' } });
      }
      if (!serveStatic || !['GET', 'HEAD'].includes(request.method)) return reply(404, { error: { code: 'not_found', message: '未找到页面。' } });
      let decoded;
      try { decoded = decodeURIComponent(pathname); } catch { return reply(400, { error: { code: 'invalid_path', message: '无效路径。' } }); }
      const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
      const file = path.resolve(root, relative);
      // Dotfiles, source server files, and parent paths are never web assets.
      if (!file.startsWith(root + path.sep) || relative.split(/[\\/]/).some(part => part.startsWith('.')))
        return reply(404, { error: { code: 'not_found', message: '未找到页面。' } });
      const details = await stat(file);
      if (!details.isFile()) return reply(404, { error: { code: 'not_found', message: '未找到页面。' } });
      response.writeHead(200, { ...securityHeaders, 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(file));
    } catch (error) {
      if (['ChatGPTLocalError', 'CreativeGenerationError'].includes(error.name) && typeof error.code === 'string') {
        const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
        return reply(status, { error: { code: error.code.slice(0, 100), message: String(error.message || '本机 ChatGPT 操作未完成。').slice(0, 400),
          ...(typeof error.retryable === 'boolean' ? { retryable: error.retryable } : {}) } });
      }
      if (error instanceof AuthError || error instanceof ImageGenerationError) return reply(error.status, { error: { code: error.code, message: error.message } }, error.status === 429 ? { 'Retry-After': '60' } : {});
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return reply(404, { error: { code: 'not_found', message: '未找到页面。' } });
      // Do not return provider payloads, credentials, stack traces, or filesystem paths.
      return reply(500, { error: { code: 'internal_error', message: '登录服务暂时不可用，请稍后重试。' } });
    }
  };
}
