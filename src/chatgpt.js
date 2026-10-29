/**
 * Central.ai personal local runtime client. It never connects a hosted web page
 * to localhost and never receives or stores ChatGPT/Codex credentials.
 */
export class LocalChatGPTError extends Error {
  constructor(code, message) { super(message); this.name = 'LocalChatGPTError'; this.code = code; }
}

const LOCAL_REQUIRED = '此功能需在你自己的电脑上运行 Central.ai，再使用你本人的 ChatGPT 账号授权。在线演示不会连接你的本机。';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_JOB_STATES = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
const safeString = (value, max = 300) => typeof value === 'string' ? value.slice(0, max) : '';
function localOrigin(pageUrl) {
  try {
    const url = new URL(pageUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}
function identity(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.freeze({ name: safeString(value.name, 200), email: safeString(value.email, 320) });
}
function profilesList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(p => p && typeof p === 'object' && typeof (p.id || p.profileId) === 'string').slice(0, 100).map(p => Object.freeze({
    id: safeString(p.id || p.profileId, 200), label: safeString(p.label || p.name || p.profileLabel || p.id || p.profileId, 200),
    ...(p.identity ? { identity: identity(p.identity) } : {}),
    ...(typeof p.sharing === 'boolean' ? { sharing: p.sharing } : {}),
    ...(typeof p.selected === 'boolean' ? { selected: p.selected } : {}),
    ...(typeof p.status === 'string' ? { status: safeString(p.status, 80) } : {}),
    ...(typeof p.pending === 'boolean' ? { pending: p.pending } : {}),
  }));
}
function modelsList(value) {
  const models = Array.isArray(value) ? value : value?.models || value?.data;
  if (!Array.isArray(models)) throw new LocalChatGPTError('invalid_response', '本机服务未返回有效的模型列表。');
  return models.filter(m => m && typeof m === 'object' && typeof (m.slug || m.model || m.id) === 'string').slice(0, 200).map(m => {
    const slug = safeString(m.slug || m.model || m.id, 200);
    return Object.freeze({ slug, id: slug, displayName: safeString(m.displayName || m.display_name || m.name || slug, 200),
      ...(typeof m.isDefault === 'boolean' ? { isDefault: m.isDefault } : {}) });
  });
}
function errorText(value) {
  return typeof value === 'string' ? safeString(value) : safeString(value?.message);
}

/**
 * Public snapshot contains safe display fields only. status is one of loading,
 * local_required, unavailable, signed_out, waiting_for_browser, profile_required,
 * sharing_required, ready. Authenticated access always also requires sharing=true.
 */
export function createChatGPTClient(options = {}) {
  const origin = localOrigin(options.pageUrl || globalThis.location?.href || '');
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
  const listeners = new Set();
  let state = {
    status: origin ? 'loading' : 'local_required', local: Boolean(origin), configured: false, authenticated: false,
    message: origin ? '正在检查本机 ChatGPT 连接…' : LOCAL_REQUIRED, errorMessage: '',
    session: Object.freeze({ status: 'unknown', sharing: false }), profiles: Object.freeze([]), models: Object.freeze([]),
    identity: null, capabilities: Object.freeze({ text: false, images: false, video: false }), generating: false,
    usageUrl: 'https://chatgpt.com/settings/usage',
  };
  let initPromise;
  let loginEpoch = 0;
  let pendingSignIn;
  let modelEpoch = 0;
  let statusEpoch = 0;
  let currentGeneration = 0;
  const snapshot = () => Object.freeze({ ...state });
  function update(values) {
    state = { ...state, ...values };
    for (const fn of listeners) { try { fn(snapshot()); } catch { /* View errors cannot authorize local access. */ } }
  }
  function requireLocal() { if (!origin) throw new LocalChatGPTError('local_required', LOCAL_REQUIRED); }
  function requireSharing() {
    requireLocal();
    if (state.status !== 'ready' || state.session.sharing !== true || state.authenticated !== true)
      throw new LocalChatGPTError('sharing_required', state.message || '请先使用本人的 ChatGPT 账号授权并选择可用资料。');
  }
  async function request(path, { method = 'GET', body, signal, timeoutMs = options.requestTimeoutMs || 15000 } = {}) {
    requireLocal();
    const leafRoute = /^\/api\/chatgpt\/[a-z-]+$/.test(path);
    const imageMatch = /^\/api\/chatgpt\/image-jobs\/([^/]+)(\/cancel)?$/.exec(path);
    if (!leafRoute && !(imageMatch && UUID.test(imageMatch[1]))) throw new LocalChatGPTError('invalid_destination', '本机请求路径无效。');
    if (!fetchImpl) throw new LocalChatGPTError('unavailable', '当前浏览器不支持本机连接。');
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetchImpl(new URL(path, origin).href, {
        method, credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 204 && response.ok) return null;
      let data;
      try { data = await response.json(); } catch { throw new LocalChatGPTError('invalid_response', '本机服务返回了无法识别的响应。请确认已运行带 ChatGPT 支持的 Central.ai。'); }
      if (!response.ok) throw new LocalChatGPTError(safeString(data?.error?.code, 100) || `http_${response.status}`, errorText(data?.error) || '本机 ChatGPT 请求未完成。');
      return data;
    } catch (error) {
      if (error instanceof LocalChatGPTError) throw error;
      if (controller.signal.aborted) throw new LocalChatGPTError(timedOut ? 'timeout' : 'cancelled', timedOut ? '本机服务尚未返回，请检查本机窗口或稍后刷新状态。' : '已停止等待本次请求。');
      throw new LocalChatGPTError('unavailable', '无法连接本机 ChatGPT 服务。请确认已在这台电脑启动 Central.ai。');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  function applyStatus(data) {
    if (!data || typeof data !== 'object' || data.mode !== 'local' || !['codex','chatgpt'].includes(data.provider) || !data.session || typeof data.session.status !== 'string')
      throw new LocalChatGPTError('invalid_response', '本机 ChatGPT 状态格式无效。');
    const raw = data.session;
    const session = Object.freeze({ status: safeString(raw.status, 80), sharing: raw.sharing === true,
      ...(typeof raw.profileId === 'string' ? { profileId: safeString(raw.profileId, 200) } : {}),
      ...(typeof raw.profileLabel === 'string' ? { profileLabel: safeString(raw.profileLabel, 200) } : {}),
      ...(raw.identity ? { identity: identity(raw.identity) } : {}),
      ...(raw.error ? { error: Object.freeze({ code: safeString(raw.error.code, 100), message: errorText(raw.error), retryable: raw.error.retryable === true }) } : {}),
    });
    const configured = data.configured === true;
    const knownAuthenticated = ['connected', 'authenticated', 'signed_in', 'ready'].includes(session.status);
    const waiting = ['connecting', 'waiting_for_browser', 'authenticating', 'pending', 'signing_in'].includes(session.status);
    const missingProfile = ['profile_required', 'select_profile', 'profile_selection_required'].includes(session.status);
    let status, message;
    if (!configured) { status = 'unavailable'; message = errorText(raw.error) || '本机 ChatGPT 运行环境尚未配置完成。'; }
    else if (waiting) { status = 'waiting_for_browser'; message = '请在打开的浏览器中完成 ChatGPT 授权。可以取消或刷新连接状态。'; }
    else if (missingProfile) { status = 'profile_required'; message = '请选择你本人已授权的 ChatGPT 登录资料。'; }
    else if (knownAuthenticated && !session.sharing) { status = 'sharing_required'; message = '已识别 ChatGPT 账号，但尚未允许本机 Central.ai 使用该账号。'; }
    else if (knownAuthenticated && session.sharing) { status = 'ready'; message = '已连接你本人的 ChatGPT 账号，创作请求将在这台电脑运行。'; }
    else if (['unavailable', 'error', 'unsupported'].includes(session.status)) { status = 'unavailable'; message = errorText(raw.error) || '此 ChatGPT 连接暂时不可用。'; }
    else { status = 'signed_out'; message = session.status === 'reauth_required' ? '此 ChatGPT 账号需要重新授权，请在本机继续登录。' : '在这台电脑授权你本人的 ChatGPT 账号后继续。'; }
    const sameProfile = state.session.profileId === session.profileId;
    if (!sameProfile || status !== 'ready') modelEpoch += 1;
    update({ status, message, configured, authenticated: knownAuthenticated, session, identity: session.identity || null,
      profiles: Object.freeze(profilesList(data.profiles)), models: sameProfile && status === 'ready' ? state.models : Object.freeze([]),
      errorMessage: errorText(raw.error),
      capabilities: Object.freeze({ text: data.capabilities?.text === true, images: data.capabilities?.images === true, video: data.capabilities?.video === true }),
    });
    return snapshot();
  }
  async function refresh() {
    if (!origin) { update({ status: 'local_required', message: LOCAL_REQUIRED, errorMessage: '' }); return snapshot(); }
    const epoch = ++statusEpoch;
    try { const data = await request('/api/chatgpt/status'); if (epoch !== statusEpoch) return snapshot(); return applyStatus(data); }
    catch (error) {
      if (epoch !== statusEpoch) return snapshot();
      modelEpoch += 1;
      update({ status: 'unavailable', configured: false, authenticated: false, models: Object.freeze([]), identity: null,
        session: Object.freeze({ status: 'unavailable', sharing: false }), message: error.message, errorMessage: error.message });
      return snapshot();
    }
  }
  function init({ force = false } = {}) {
    if (!initPromise || force) initPromise = refresh();
    return initPromise;
  }
  async function signIn({ newProfile = false, profileId, reconsent = false } = {}) {
    requireLocal();
    if (profileId !== undefined && (typeof profileId !== 'string' || !profileId || profileId.length > 200)) throw new TypeError('请选择有效的 ChatGPT 登录资料。');
    const body = { ...(newProfile ? { newProfile: true } : {}), ...(profileId ? { profileId } : {}), ...(reconsent ? { reconsent: true } : {}) };
    if (state.generating) throw new LocalChatGPTError('generation_in_progress', '创作仍在运行，请完成后再更换账号。');
    const epoch = ++loginEpoch;
    statusEpoch += 1;
    pendingSignIn?.abort();
    const controller = new AbortController(); pendingSignIn = controller;
    update({ status: 'waiting_for_browser', message: '请在打开的浏览器中完成 ChatGPT 授权。你可以随时取消或刷新状态。', errorMessage: '' });
    try {
      // Login may legitimately wait for a human browser flow. It is not a normal
      // short API timeout; the backend should normally acknowledge immediately.
      await request('/api/chatgpt/sign-in', { method: 'POST', body, signal: controller.signal, timeoutMs: options.signInTimeoutMs || 300000 });
      if (epoch !== loginEpoch) return snapshot();
      return await refresh();
    } catch (error) {
      if (epoch !== loginEpoch) return snapshot();
      // A lost HTTP response does not prove the OAuth flow stopped on the server.
      const current = await refresh();
      if (epoch !== loginEpoch) return snapshot();
      if (current.status === 'ready' || current.status === 'waiting_for_browser') return current;
      update({ errorMessage: error.message });
      throw error;
    } finally { if (pendingSignIn === controller) pendingSignIn = null; }
  }
  async function cancelSignIn() {
    requireLocal();
    await request('/api/chatgpt/cancel-sign-in', { method: 'POST', body: {} });
    loginEpoch += 1; pendingSignIn?.abort(); pendingSignIn = null;
    return refresh();
  }
  async function listProfiles() {
    requireLocal();
    const data = await request('/api/chatgpt/profiles');
    if (!Array.isArray(data?.profiles)) throw new LocalChatGPTError('invalid_response', '本机服务未返回有效的登录资料。');
    const profiles = Object.freeze(profilesList(data.profiles)); update({ profiles }); return profiles;
  }
  async function selectProfile(profileId) {
    requireLocal();
    if (state.generating) throw new LocalChatGPTError('generation_in_progress', '创作仍在运行，请完成后再更换账号。');
    if (typeof profileId !== 'string' || !profileId || profileId.length > 200) throw new TypeError('请选择有效的 ChatGPT 登录资料。');
    loginEpoch += 1; modelEpoch += 1; statusEpoch += 1;
    update({ status: 'loading', models: Object.freeze([]), message: '正在切换本机 ChatGPT 登录资料…', errorMessage: '' });
    try { await request('/api/chatgpt/select-profile', { method: 'POST', body: { profileId } }); return await refresh(); }
    catch (error) { await refresh(); update({ errorMessage: error.message }); throw error; }
  }
  async function signOut() {
    requireLocal();
    if (state.generating) throw new LocalChatGPTError('generation_in_progress', '创作仍在运行，请完成后再退出账号。');
    statusEpoch += 1; modelEpoch += 1;
    update({ status: 'loading', models: Object.freeze([]), message: '正在退出本机 ChatGPT 连接…', errorMessage: '' });
    try {
      await request('/api/chatgpt/sign-out', { method: 'POST', body: {} });
      loginEpoch += 1; pendingSignIn?.abort(); pendingSignIn = null;
      return await refresh();
    } catch (error) { await refresh(); update({ errorMessage: error.message }); throw error; }
  }
  async function listModels() {
    requireSharing();
    const epoch = ++modelEpoch;
    try {
      const models = Object.freeze(modelsList(await request('/api/chatgpt/models')));
      if (epoch !== modelEpoch || state.status !== 'ready' || !state.session.sharing) return state.models;
      update({ models, errorMessage: '' }); return models;
    } catch (error) { if (epoch === modelEpoch) update({ errorMessage: error.message }); throw error; }
  }
  function requireImages() {
    requireSharing();
    if (state.capabilities.images !== true)
      throw new LocalChatGPTError('images_unavailable', '当前本机 Codex 尚未提供可用的原生图像生成能力。');
  }
  function jobId(value) {
    if (typeof value !== 'string' || !UUID.test(value))
      throw new LocalChatGPTError('invalid_job_id', '图像任务编号必须是有效的 UUID。');
    return value;
  }
  function normalizeImageJob(data, expectedId) {
    const source = data?.job || data;
    if (!source || typeof source !== 'object' || Array.isArray(source) || !UUID.test(source.id || '') || !IMAGE_JOB_STATES.has(source.status))
      throw new LocalChatGPTError('invalid_response', '本机服务返回了无效的图像任务。');
    if (expectedId && source.id !== expectedId)
      throw new LocalChatGPTError('invalid_response', '图像任务编号与当前请求不一致。');
    const job = { id: source.id, status: source.status };
    if (source.status === 'succeeded') {
      let url;
      try { url = new URL(source.imageUrl, origin); } catch {}
      if (typeof source.imageUrl !== 'string' || !url || url.origin !== origin || url.username || url.password || url.search || url.hash ||
          url.pathname !== `/api/chatgpt/image-jobs/${source.id}/image.png`)
        throw new LocalChatGPTError('invalid_response', '已完成的图像任务没有有效的本机 PNG 结果。');
      job.imageUrl = url.href;
    }
    if (typeof source.projectId === 'string') job.projectId = safeString(source.projectId, 200);
    if (typeof source.assetId === 'string') job.assetId = safeString(source.assetId, 200);
    if (source.error) job.error = Object.freeze({ code: safeString(source.error.code, 100), message: errorText(source.error), retryable: source.error.retryable === true });
    return Object.freeze(job);
  }
  function imageInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('请提供角色或道具的图像生成设置。');
    const { projectId, assetId, prompt } = input;
    if (typeof projectId !== 'string' || !projectId || projectId.length > 200 || typeof assetId !== 'string' || !assetId || assetId.length > 200)
      throw new LocalChatGPTError('invalid_image_input', '图像任务需要有效的项目编号与资产编号。');
    if (typeof prompt !== 'string' || !prompt.trim()) throw new LocalChatGPTError('invalid_image_input', '请先填写完整的资产图像提示词。');
    const refs = input.references || [];
    if (!Array.isArray(refs) || refs.length > 9) throw new LocalChatGPTError('invalid_image_input', '图像参考最多为 9 张图片。');
    const references = refs.map((ref, i) => {
      const match = typeof ref?.dataUrl === 'string' && /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(ref.dataUrl);
      if (!match || match[2].length % 4 !== 0) throw new LocalChatGPTError('invalid_image_input', `参考 ${i + 1} 需要重新上传 JPG、PNG 或 WebP 图片。`);
      const bytes = match[2].length * 3 / 4 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
      if (bytes > 8 * 1024 * 1024) throw new LocalChatGPTError('invalid_image_input', `参考 ${i + 1} 不能超过 8 MB。`);
      return { id: safeString(ref.id, 200) || `reference-${i + 1}`, type: safeString(ref.type, 80), name: safeString(ref.name, 300), dataUrl: ref.dataUrl };
    });
    return { projectId, assetId, prompt, references };
  }
  async function startImageJob(input) {
    requireImages();
    const job = normalizeImageJob(await request('/api/chatgpt/image-jobs', { method: 'POST', body: imageInput(input), timeoutMs: 10000 }));
    return job;
  }
  async function getImageJob(id) {
    requireImages(); jobId(id);
    return normalizeImageJob(await request(`/api/chatgpt/image-jobs/${id}`), id);
  }
  async function cancelImageJob(id) {
    requireImages(); jobId(id);
    return normalizeImageJob(await request(`/api/chatgpt/image-jobs/${id}/cancel`, { method: 'POST', body: {} }), id);
  }
  async function generateCreativePackage(input, model = state.models[0]?.slug) {
    requireSharing();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('请提供创作主题与设置。');
    if (typeof model !== 'string' || !state.models.some(m => m.slug === model)) throw new LocalChatGPTError('model_required', '请从此账号的可用模型中选择创作模型。');
    if (state.generating) throw new LocalChatGPTError('generation_in_progress', '当前创作仍在运行，请等待结果后再提交。');
    const generation = ++currentGeneration;
    update({ generating: true, errorMessage: '' });
    try {
      const result = await request('/api/chatgpt/creative-generation', { method: 'POST', body: { input, model }, timeoutMs: options.generationTimeoutMs || 300000 });
      if (!result?.project || typeof result.project !== 'object' || Array.isArray(result.project))
        throw new LocalChatGPTError('invalid_response', '本机创作未返回完整项目，请检查本机服务输出；未替换成演示草案。');
      return result.project;
    } catch (error) { if (generation === currentGeneration) update({ errorMessage: error.message }); throw error; }
    finally { if (generation === currentGeneration) update({ generating: false }); }
  }
  return Object.freeze({
    init, refresh, snapshot, signIn, cancelSignIn, selectProfile, signOut, listModels, listProfiles, generateCreativePackage,
    startImageJob, getImageJob, cancelImageJob,
    subscribe(listener) { if (typeof listener !== 'function') throw new TypeError('连接订阅需要回调函数。'); listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
  });
}

export const chatgpt = createChatGPTClient();
