/**
 * Google Identity Services client. Google credentials remain in memory and are
 * accepted only after the configured Central.ai server verifies them.
 */
const GOOGLE_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const DEFAULT_MESSAGE = 'Google 登录尚未启用，请先完成 OAuth 客户端和后端配置。';

export class AuthClientError extends Error {
  constructor(code, message) { super(message); this.name = 'AuthClientError'; this.code = code; }
}

function normalizeApiOrigin(value, pageUrl) {
  let url;
  try { url = new URL(value || new URL(pageUrl).origin, pageUrl); }
  catch { throw new AuthClientError('invalid_configuration', '登录服务地址无效。'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password ||
      url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new AuthClientError('invalid_configuration', '登录服务必须使用 HTTPS 来源地址，不能包含路径、查询或登录信息。');
  }
  return url.origin;
}

function timestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string') { const n = Date.parse(value); if (Number.isFinite(n)) return n; }
  return null;
}

function publicUser(value) {
  if (!value || typeof value.id !== 'string' || !value.id.startsWith('google:') || value.id.length > 260)
    throw new AuthClientError('invalid_response', '登录服务没有返回有效的 Google 用户。');
  const safe = { id: value.id, name: String(value.name || '').slice(0, 200), email: String(value.email || '').slice(0, 320) };
  try { const url = new URL(value.picture); if (url.protocol === 'https:' && !url.username && !url.password) safe.picture = url.href; } catch {}
  return Object.freeze(safe);
}

let googleScriptPromise;
function loadGoogleIdentity() {
  const win = globalThis.window;
  const doc = globalThis.document;
  if (win?.google?.accounts?.id) return Promise.resolve(win.google.accounts.id);
  if (!doc || !win) return Promise.reject(new AuthClientError('browser_required', '请在浏览器中完成 Google 登录。'));
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    let script = doc.querySelector(`script[src="${GOOGLE_SCRIPT_URL}"]`);
    let owned = false;
    const finish = () => {
      cleanup();
      if (win.google?.accounts?.id) resolve(win.google.accounts.id);
      else { googleScriptPromise = null; if (owned) script?.remove(); reject(new AuthClientError('google_unavailable', 'Google 登录组件未能加载，请稍后重试。')); }
    };
    const fail = () => {
      cleanup(); googleScriptPromise = null;
      if (owned) script?.remove();
      reject(new AuthClientError('google_unavailable', '无法连接 Google 登录服务，请检查网络后重试。'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      script?.removeEventListener('load', finish);
      script?.removeEventListener('error', fail);
    };
    const timer = setTimeout(fail, 15000);
    if (!script) { script = doc.createElement('script'); script.src = GOOGLE_SCRIPT_URL; script.async = true; script.defer = true; owned = true; }
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', fail, { once: true });
    if (owned) doc.head.appendChild(script);
  });
  return googleScriptPromise;
}

/**
 * snapshot(): { status, user, message, configured, apiBaseUrl,
 *               googleClientId, expiresAt, errorMessage }
 * init({ force: true }) reloads public configuration after a failed attempt.
 * fetchAuthenticated() accepts only /api/* paths on the configured API origin.
 */
export function createAuthClient(options = {}) {
  const pageUrl = options.pageUrl || globalThis.location?.href || 'http://localhost/';
  const pageOrigin = new URL(pageUrl).origin;
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
  const loadGoogle = options.loadGoogle || loadGoogleIdentity;
  const now = options.now || Date.now;
  const requestTimeoutMs = options.requestTimeoutMs || 12000;
  const configUrl = options.runtimeConfigUrl || new URL('../runtime-config.json', import.meta.url).href;
  const listeners = new Set();
  let state = { status: 'loading', user: null, message: '正在检查登录配置…', configured: false, apiBaseUrl: '', googleClientId: '', expiresAt: null, errorMessage: '' };
  let initPromise;
  let apiOrigin = '';
  let bearerCredential = null;
  let expiryTimer;
  let googleId;
  let loginAttempt = 0;

  const snapshot = () => Object.freeze({ ...state });
  function update(values) {
    state = { ...state, ...values };
    for (const listener of listeners) { try { listener(snapshot()); } catch { /* A UI listener must not change authentication state. */ } }
  }
  function clearCredential() { bearerCredential = null; clearTimeout(expiryTimer); }
  function signedOut(message = '使用 Google 账号登录 Central.ai。', errorMessage = '') {
    clearCredential(); update({ status: 'signed_out', user: null, expiresAt: null, message, errorMessage });
  }
  function acceptSession(user, expiresAt, credential = null) {
    const expiry = timestamp(expiresAt);
    if (!expiry || expiry <= now()) throw new AuthClientError('invalid_response', '登录会话已过期，请重新登录。');
    clearCredential(); bearerCredential = credential;
    update({ status: 'signed_in', user: publicUser(user), expiresAt: new Date(expiry).toISOString(), message: '已通过 Google 身份验证。', errorMessage: '' });
    expiryTimer = setTimeout(() => signedOut('登录会话已到期，请重新登录。'), Math.min(expiry - now(), 2147483647));
    expiryTimer?.unref?.();
  }
  async function send(url, init = {}) {
    if (!fetchImpl) throw new AuthClientError('browser_required', '当前环境不支持网络请求。');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal, cache: 'no-store', redirect: 'error' });
    } catch (error) {
      throw new AuthClientError(error?.name === 'AbortError' ? 'timeout' : 'network_error',
        error?.name === 'AbortError' ? '登录服务响应超时，请重试。' : '无法连接登录服务，请检查配置或稍后重试。');
    } finally { clearTimeout(timer); }
  }
  async function request(path, { method = 'GET', body, authenticated = false } = {}) {
    if (!apiOrigin) throw new AuthClientError('not_configured', DEFAULT_MESSAGE);
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated && apiOrigin !== pageOrigin && bearerCredential) headers.Authorization = `Bearer ${bearerCredential}`;
    const response = await send(new URL(path, apiOrigin).href, {
      method, headers, credentials: apiOrigin === pageOrigin ? 'same-origin' : 'omit',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 204) return null;
    let data;
    try { data = await response.json(); } catch { throw new AuthClientError('invalid_response', '登录服务返回了无法识别的响应。'); }
    if (!response.ok) {
      const code = typeof data?.error?.code === 'string' ? data.error.code : `http_${response.status}`;
      const message = typeof data?.error?.message === 'string' ? data.error.message.slice(0, 300) : '登录未完成，请重试。';
      throw new AuthClientError(code, message);
    }
    return data;
  }
  async function initialize() {
    clearCredential(); apiOrigin = '';
    update({ status: 'loading', user: null, configured: false, apiBaseUrl: '', googleClientId: '', expiresAt: null, message: '正在检查登录配置…', errorMessage: '' });
    try {
      let config = options.runtimeConfig;
      if (config === undefined) {
        const response = await send(configUrl, { credentials: 'omit', headers: { Accept: 'application/json' } });
        if (!response.ok) { update({ status: 'not_configured', message: DEFAULT_MESSAGE }); return snapshot(); }
        config = await response.json();
      }
      if (config?.authEnabled !== true) { update({ status: 'not_configured', message: DEFAULT_MESSAGE }); return snapshot(); }
      apiOrigin = normalizeApiOrigin(config.apiBaseUrl, pageUrl);
      const serverConfig = await request('/api/config');
      if (serverConfig?.google?.configured !== true || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(serverConfig.google.clientId || '')) {
        update({ status: 'not_configured', apiBaseUrl: apiOrigin, message: DEFAULT_MESSAGE }); return snapshot();
      }
      if (config.googleClientId && config.googleClientId !== serverConfig.google.clientId)
        throw new AuthClientError('client_id_mismatch', '网页与后端的 Google 客户端 ID 不一致。');
      update({ configured: true, apiBaseUrl: apiOrigin, googleClientId: serverConfig.google.clientId, status: 'signed_out', message: '使用 Google 账号登录 Central.ai。' });
      // Cross-origin Pages deployments do not rely on blocked third-party cookies.
      // Refresh requires a new Google login because no token is persisted.
      if (apiOrigin !== pageOrigin) return snapshot();
      try {
        const session = await request('/api/auth/session');
        if (session?.authenticated === true) acceptSession(session.user, session.expiresAt);
      } catch (error) {
        if (['unauthorized', 'unauthenticated', 'not_authenticated', 'session_expired', 'http_401'].includes(error.code)) signedOut();
        else throw error;
      }
      return snapshot();
    } catch (error) {
      clearCredential(); update({ status: error.code === 'not_configured' ? 'not_configured' : 'unavailable', user: null, expiresAt: null, message: error.message || '登录服务暂时不可用。', errorMessage: error.message || '登录服务暂时不可用。' });
      return snapshot();
    }
  }
  const init = ({ force = false } = {}) => {
    if (!initPromise || force) { loginAttempt += 1; initPromise = initialize(); }
    return initPromise;
  };

  async function renderGoogleButton(container) {
    await init();
    if (!state.configured) throw new AuthClientError('not_configured', state.message || DEFAULT_MESSAGE);
    if (!container || typeof container.replaceChildren !== 'function') throw new TypeError('需要 Google 登录按钮容器。');
    const attempt = ++loginAttempt;
    update({ errorMessage: '' });
    try {
      const challenge = await request('/api/auth/challenge', { method: 'POST', body: {} });
      if (!challenge?.challengeId || !challenge?.nonce || !timestamp(challenge.expiresAt) || timestamp(challenge.expiresAt) <= now())
        throw new AuthClientError('invalid_response', '登录校验已过期，请重试。');
      googleId = await loadGoogle();
      if (!googleId?.initialize || !googleId?.renderButton) throw new AuthClientError('google_unavailable', 'Google 登录组件不可用。');
      if (attempt !== loginAttempt) return;
      googleId.initialize({
        client_id: state.googleClientId, nonce: challenge.nonce, auto_select: false, ux_mode: 'popup', context: 'signin',
        callback: async (response) => {
          if (attempt !== loginAttempt) return;
          if (!response?.credential || typeof response.credential !== 'string') {
            signedOut('Google 未返回登录凭证，请重试。', 'Google 未返回登录凭证，请重试。'); return;
          }
          update({ message: '正在由 Central.ai 验证 Google 身份…' });
          try {
            const result = await request('/api/auth/google', { method: 'POST', body: { credential: response.credential, challengeId: challenge.challengeId } });
            if (attempt !== loginAttempt) return;
            if (result?.authentication !== 'google') throw new AuthClientError('invalid_response', 'Google 身份尚未通过服务端验证。');
            acceptSession(result.user, apiOrigin === pageOrigin ? result.expiresAt : (result.bearerExpiresAt || result.expiresAt), apiOrigin === pageOrigin ? null : response.credential);
          } catch (error) { if (attempt !== loginAttempt) return; const message = error.message || 'Google 登录失败，请重试。'; signedOut(message, message); }
        },
      });
      container.replaceChildren();
      googleId.renderButton(container, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', logo_alignment: 'left', width: Math.min(Math.max(container.clientWidth || 320, 200), 400) });
      if (state.status !== 'signed_in') update({ status: 'signed_out', message: '通过 Google 官方登录窗口继续。' });
    } catch (error) {
      if (attempt !== loginAttempt) return;
      update({ message: error.message || 'Google 登录未能载入。', errorMessage: error.message || 'Google 登录未能载入。' });
      throw error;
    }
  }

  async function signOut() {
    loginAttempt += 1;
    if (!state.configured) { clearCredential(); return snapshot(); }
    await request('/api/auth/logout', { method: 'POST', body: {}, authenticated: true });
    try { googleId?.disableAutoSelect?.(); } catch {}
    signedOut('已退出 Central.ai。');
    return snapshot();
  }

  async function fetchAuthenticated(path, init = {}) {
    if (!state.configured || state.status !== 'signed_in') throw new AuthClientError('unauthorized', '请先登录 Central.ai。');
    const url = new URL(path, apiOrigin);
    if (url.origin !== apiOrigin || !url.pathname.startsWith('/api/') || url.username || url.password || url.hash)
      throw new AuthClientError('untrusted_destination', '认证请求只能发送到已配置的 Central.ai API。');
    if (timestamp(state.expiresAt) <= now()) { signedOut('登录会话已到期，请重新登录。'); throw new AuthClientError('session_expired', state.message); }
    const headers = new Headers(init.headers || {});
    // The caller cannot replace the identity credential or forward it to a redirect.
    headers.delete('Authorization');
    if (apiOrigin !== pageOrigin && bearerCredential) headers.set('Authorization', `Bearer ${bearerCredential}`);
    const response = await send(url.href, { ...init, headers, credentials: apiOrigin === pageOrigin ? 'same-origin' : 'omit' });
    if (response.status === 401) signedOut('登录会话已失效，请重新登录。');
    return response;
  }

  return Object.freeze({
    init, snapshot, renderGoogleButton, signOut, fetchAuthenticated,
    subscribe(listener) { if (typeof listener !== 'function') throw new TypeError('认证订阅需要回调函数。'); listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
  });
}

export const auth = createAuthClient();
