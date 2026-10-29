import http from 'node:http';
import { createApp } from './app.js';
import { createAuthService, normalizeOrigin } from './auth.js';
import { createChatGPTLocalService } from './chatgpt-local.js';
import { createCreativeHandler } from './creative.js';
import {createImageService} from './codex-images.js';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是有效端口。');
const publicOrigin = process.env.CENTRAL_PUBLIC_ORIGIN || `http://localhost:${port}`;
const localMode = process.env.CENTRAL_LOCAL_CHATGPT_ENABLED !== 'false';
const host = process.env.HOST || '127.0.0.1';
if (localMode) {
  if (!['127.0.0.1', 'localhost'].includes(host))
    throw new Error('本机 ChatGPT 模式必须绑定 127.0.0.1 或 localhost，不能监听公网或 0.0.0.0。');
  if (![ `http://localhost:${port}`, `http://127.0.0.1:${port}` ].includes(normalizeOrigin(publicOrigin)))
    throw new Error('本机 ChatGPT 模式的 CENTRAL_PUBLIC_ORIGIN 必须是当前端口的 HTTP localhost 或 127.0.0.1。');
}

const secureCookies = process.env.CENTRAL_DEV_INSECURE_COOKIES !== 'true';
if (process.env.NODE_ENV === 'production' && !secureCookies) throw new Error('生产环境不允许关闭 Secure Cookie。');
const authService = createAuthService({
  googleClientId: process.env.GOOGLE_CLIENT_ID || '', publicOrigin,
  allowedOrigins: [...(process.env.CENTRAL_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    ...(localMode ? [`http://localhost:${port}`, `http://127.0.0.1:${port}`] : [])],
  secureCookies,
});
const chatgptService = localMode ? await createChatGPTLocalService() : null;
const imageService=chatgptService?createImageService({chatgptService}):null;
const server = http.createServer(createApp({ authService, localMode, localPort: port, chatgptService, imageService, creativeHandler: createCreativeHandler() }));

server.headersTimeout = 15_000;
server.requestTimeout = 20_000;
server.maxHeadersCount = 80;
server.listen(port, host, () => {
  console.log(`Central.ai server listening at http://${host}:${port}; ChatGPT mode ${localMode ? 'local only' : 'disabled'}; Google login ${authService.configured ? 'configured' : 'not configured'}.`);

});

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.close();
  try { await imageService?.close?.(); await chatgptService?.close?.(); } finally { process.exitCode = 0; }
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
