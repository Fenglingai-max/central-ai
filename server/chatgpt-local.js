/** Central.ai personal loopback bridge to the official, locally installed Codex CLI. */
import { spawn } from 'node:child_process';
import { access, constants, mkdir, open, lstat, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';
const MESSAGES = {
  sdk_unavailable: '尚未找到本机官方 Codex CLI。请安装 Codex 或设置 CENTRAL_CODEX_PATH。',
  sign_in_required: '请先在本机 Codex 中登录自己的 ChatGPT 账号。',
  api_key_not_allowed: '当前 Codex 使用 API Key。请改用 ChatGPT 登录后使用自己的套餐。',
  connection_busy: '请等待当前登录或生成完成后再继续。',
  connection_changed: '操作期间本机账号发生变化，结果未保存。',
  profile_not_found: '本机桥接只使用当前 Codex 账号，请在 Codex 中切换账号后刷新。',
  invalid_request: '请求格式无效，请检查模型与文本输入。',
  model_not_found: '该模型不在当前本机 Codex 的可用列表中。',
  cancelled: '操作已取消。',
  timed_out: '本机 Codex 未在时限内完成，请重试。',
  output_too_large: '本机 Codex 返回内容过大，操作已停止。',
  invalid_response: '本机 Codex 没有返回完整、有效的结果。',
  generation_failed: '本机 Codex 未完成生成。请在 Codex 中检查账号、权限和套餐用量。',
  image_generation_failed: '没有收到已完成的原生图片生成记录，未将其他文件当作生成结果。',
  image_file_unavailable: '原生图片工具未返回可读取的本机图片文件。',
  invalid_image: '原生图片文件不可安全读取或格式无效。',
  cli_unavailable: '本机 Codex 无法启动，请检查安装与运行权限。',
  chatgpt_unavailable: '本机 Codex 暂时无法完成此操作，请检查登录与网络。',
};
export class ChatGPTLocalError extends Error {
  constructor(code, { status, retryable = false } = {}) {
    const key = Object.hasOwn(MESSAGES, code) ? code : 'chatgpt_unavailable';
    super(MESSAGES[key]); this.name = 'ChatGPTLocalError'; this.code = key;
    this.status = status ?? (key === 'sign_in_required' ? 401 : key === 'api_key_not_allowed' ? 403 : key === 'connection_busy' ? 409 : ['invalid_request', 'model_not_found'].includes(key) ? 400 : 503);
    this.retryable = retryable;
  }
  toJSON() { return { code: this.code, message: this.message, status: this.status, retryable: this.retryable }; }
}
const safeError = error => error instanceof ChatGPTLocalError ? error : new ChatGPTLocalError(error?.name === 'AbortError' ? 'cancelled' : 'chatgpt_unavailable');
export const CODEX_DISABLED_TOOLS = ['shell_tool', 'apps', 'plugins', 'browser_use', 'computer_use'];
const disabledToolArgs = () => CODEX_DISABLED_TOOLS.flatMap(name => ['--disable', name]);
export function codexEnvironment(source = process.env) {
  // Only OS runtime, local Codex location, and configured network/CA settings are inherited.
  const allowed = ['HOME','USER','USERNAME','LOGNAME','PATH','SHELL','TMPDIR','TMP','TEMP','SystemRoot','WINDIR','APPDATA','LOCALAPPDATA','USERPROFILE','PROGRAMDATA','COMSPEC','PATHEXT','LANG','LC_ALL','LC_CTYPE','TZ','TERM','NO_COLOR','CODEX_HOME','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR','CODEX_CA_CERTIFICATE','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY','https_proxy','http_proxy','all_proxy','no_proxy'];
  return Object.fromEntries(allowed.filter(key => typeof source[key] === 'string').map(key => [key, source[key]]));
}
export async function getCodexExecutable({ env = process.env } = {}) {
  const explicit = env.CENTRAL_CODEX_PATH || env.CODEX_CLI_PATH;
  const candidates = explicit ? [explicit] : [
    ...String(env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex')),
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
  ];
  for (const candidate of candidates) { try { await access(candidate, constants.X_OK); return path.resolve(candidate); } catch {} }
  throw new ChatGPTLocalError('sdk_unavailable');
}
function stop(child) { if (!child || child.exitCode !== null) return; child.stdin?.end(); child.kill('SIGTERM'); const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1200); timer.unref?.(); }

/** Stdio JSON-RPC only. Does not start a thread or a turn on initialization. */
export async function createCodexRPC({ cliPath, cwd = ROOT, spawnImpl = spawn, env = process.env, timeoutMs = 20000, signal, onEvent, enableImageGeneration = false } = {}) {
  cliPath ||= await getCodexExecutable({ env });
  const args = ['app-server', '--stdio', '-c', 'model_provider="openai"', ...disabledToolArgs(), ...(enableImageGeneration ? ['--enable', 'image_generation'] : [])];
  const child = spawnImpl(cliPath, args, { cwd, env: codexEnvironment(env), shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const pending = new Map(), listeners = new Set(), waiters = new Set(), recent = [];
  let id = 0, buffer = '', bytes = 0, dead = false;
  const send = message => { if (dead || child.stdin.destroyed) throw new ChatGPTLocalError('cli_unavailable'); child.stdin.write(JSON.stringify(message) + '\n'); };
  const fail = error => { if (dead) return; dead = true; for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); for (const w of waiters) { clearTimeout(w.timer); w.reject(error); } waiters.clear(); stop(child); };
  child.on('error', () => fail(new ChatGPTLocalError('cli_unavailable')));
  child.on('exit', () => fail(new ChatGPTLocalError('cli_unavailable')));
  child.stderr?.on('data', () => {}); // Never forward raw provider diagnostics or tokens to HTTP or logs.
  child.stdout.setEncoding?.('utf8');
  child.stdout.on('data', chunk => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 64 * 1024 * 1024) return fail(new ChatGPTLocalError('output_too_large'));
    buffer += chunk.toString('utf8');
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch { return fail(new ChatGPTLocalError('invalid_response')); }
      if (Object.hasOwn(msg, 'id') && !msg.method) {
        const p = pending.get(msg.id); if (!p) continue; pending.delete(msg.id); clearTimeout(p.timer);
        msg.error ? p.reject(new ChatGPTLocalError('chatgpt_unavailable')) : p.resolve(msg.result);
      } else if (msg.method && Object.hasOwn(msg, 'id')) {
        // This web UI never grants agent requests new execution privileges or credentials.
        try { if (/requestApproval$/.test(msg.method)) send({ id: msg.id, result: { decision: 'decline' } }); else send({ id: msg.id, error: { code: -32601, message: 'Central.ai does not authorize this request.' } }); } catch {}
      } else if (msg.method) {
        recent.push(msg); if (recent.length > 200) recent.shift();
        for (const w of [...waiters]) if (w.method === msg.method && w.predicate(msg.params)) { waiters.delete(w); clearTimeout(w.timer); w.resolve(msg.params); }
        for (const listener of listeners) { try { listener(msg); } catch {} }
        try { onEvent?.(msg); } catch {}
      }
    }
  });
  const abort = () => fail(new ChatGPTLocalError('cancelled'));
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const rpc = {
    child,
    request(method, params = {}, options = {}) {
      if (dead) return Promise.reject(new ChatGPTLocalError('cli_unavailable'));
      const requestId = ++id;
      return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(requestId); reject(new ChatGPTLocalError('timed_out', { retryable: true })); }, options.timeoutMs ?? timeoutMs); timer.unref?.(); pending.set(requestId, { resolve, reject, timer }); try { send({ id: requestId, method, params }); } catch (error) { clearTimeout(timer); pending.delete(requestId); reject(safeError(error)); } });
    },
    notify(method, params = {}) { send({ method, params }); },
    onNotification(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    waitFor(method, predicate = () => true, options = {}) {
      const old = recent.find(message => message.method === method && predicate(message.params)); if (old) return Promise.resolve(old.params);
      if (dead) return Promise.reject(new ChatGPTLocalError('cli_unavailable'));
      return new Promise((resolve, reject) => { const w = { method, predicate, resolve, reject }; w.timer = setTimeout(() => { waiters.delete(w); reject(new ChatGPTLocalError('timed_out', { retryable: true })); }, options.timeoutMs ?? timeoutMs); w.timer.unref?.(); waiters.add(w); });
    },
    close() { signal?.removeEventListener('abort', abort); fail(new ChatGPTLocalError('cancelled')); },
  };
  try { await rpc.request('initialize', { clientInfo: { name: 'central_ai_local', title: 'Central.ai Local', version: '0.3.0' } }); rpc.notify('initialized'); return rpc; } catch (error) { rpc.close(); throw safeError(error); }
}

async function modelCatalog(rpc) {
  const models = []; let cursor;
  for (let page = 0; page < 10; page++) {
    const result = await rpc.request('model/list', { includeHidden: false, limit: 100, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(result?.data)) throw new ChatGPTLocalError('invalid_response');
    for (const m of result.data) if (!m.hidden && typeof m.model === 'string') models.push({ slug: m.model, displayName: typeof m.displayName === 'string' ? m.displayName : m.model, isDefault: m.isDefault === true });
    cursor = result.nextCursor; if (!cursor) return models;
  }
  throw new ChatGPTLocalError('invalid_response');
}
const profileFor = account => 'codex-' + createHash('sha256').update(String(account?.email || 'local-account')).digest('hex').slice(0, 20);
async function requireAccount(rpc) {
  const result = await rpc.request('account/read', { refreshToken: false });
  const account = result?.account;
  if (!account) throw new ChatGPTLocalError('sign_in_required');
  if (account.type !== 'chatgpt') throw new ChatGPTLocalError('api_key_not_allowed');
  return { type: 'chatgpt', email: typeof account.email === 'string' ? account.email.slice(0, 320) : null, planType: typeof account.planType === 'string' ? account.planType.slice(0, 50) : null };
}

/** Run an actual native image tool turn only when the caller explicitly requests it. */
export async function runImageTurn({ cliPath, cwd, prompt, referencePaths = [], model, signal, onEvent, timeoutMs = 360000, rpcFactory = createCodexRPC } = {}) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || typeof prompt !== 'string' || !prompt.trim() || !Array.isArray(referencePaths) || referencePaths.length > 12 || referencePaths.some(p => typeof p !== 'string' || !path.isAbsolute(p))) throw new ChatGPTLocalError('invalid_request');
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  const leaf = await lstat(cwd);
  if (!leaf.isDirectory() || leaf.isSymbolicLink()) throw new ChatGPTLocalError('invalid_request');
  cwd = await realpath(cwd);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); timer.unref?.();
  const merged = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
  const rpc = await rpcFactory({ cliPath, cwd, signal: merged, timeoutMs: 30000, enableImageGeneration: true, onEvent });
  const items = [];
  const remove = rpc.onNotification(message => { if (message.method === 'item/completed' && message.params?.item) items.push(message.params.item); });
  try {
    await requireAccount(rpc);
    const catalog = await modelCatalog(rpc);
    const chosen = model || catalog.find(m => m.isDefault)?.slug || catalog[0]?.slug;
    if (!chosen || !catalog.some(m => m.slug === chosen)) throw new ChatGPTLocalError('model_not_found');
    const started = await rpc.request('thread/start', { model: chosen, modelProvider: 'openai', cwd, sandbox: 'workspace-write', approvalPolicy: 'never', ephemeral: true });
    const threadId = started?.thread?.id; if (!threadId) throw new ChatGPTLocalError('invalid_response');
    const completed = rpc.waitFor('turn/completed', p => p?.threadId === threadId, { timeoutMs }); completed.catch(() => {});
    const input = [{ type: 'text', text: prompt }, ...referencePaths.map(p => ({ type: 'localImage', path: p }))];
    const begun = await rpc.request('turn/start', { threadId, input, cwd, model: chosen, approvalPolicy: 'never', sandboxPolicy: { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false } });
    const result = await completed;
    if (result?.turn?.status !== 'completed' || result.turn.error) throw new ChatGPTLocalError('generation_failed');
    const imageItems = items.filter(item => item.type === 'imageGeneration' && item.status === 'completed' && !item.failure);
    if (!imageItems.length) throw new ChatGPTLocalError('image_generation_failed');
    const image = imageItems.find(item => typeof item.savedPath === 'string' && path.isAbsolute(item.savedPath));
    if (!image) throw new ChatGPTLocalError('image_file_unavailable');
    // Copy only the regular PNG file attested by the actual native image tool item.
    const file = await open(image.savedPath, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
    let data;
    try { const stat = await file.stat(); if (!stat.isFile() || stat.size < 16 || stat.size > 32 * 1024 * 1024) throw new ChatGPTLocalError('invalid_image'); data = await file.readFile(); } finally { await file.close(); }
    if (!data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new ChatGPTLocalError('invalid_image');
    const assetPath = path.join(cwd, 'asset.png');
    if (path.resolve(image.savedPath) !== assetPath) {
      try { const target = await open(assetPath, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW)); try { const stat = await target.stat(); if (!stat.isFile() || stat.size !== data.length || !(await target.readFile()).equals(data)) throw new ChatGPTLocalError('invalid_image'); } finally { await target.close(); } }
      catch (error) { if (error.code === 'ENOENT') await writeFile(assetPath, data, { flag: 'wx', mode: 0o600 }); else throw error; }
    }
    return { imageGenerated: true, path: assetPath, imageItems, items, threadId, turnId: begun?.turn?.id || result.turn.id, model: chosen, text: items.filter(i => i.type === 'agentMessage').map(i => i.text || '').join('\n') };
  } catch (error) { throw safeError(error); } finally { clearTimeout(timer); remove(); rpc.close(); }
}

function runCommand(cliPath, args, { cwd = ROOT, prompt, signal, spawnImpl = spawn, timeoutMs = 180000, maxBytes = 8 * 1024 * 1024, onEvent } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(cliPath, args, { cwd, env: codexEnvironment(), shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '', errorOutput = '', bytes = 0, settled = false;
    const done = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(result); };
    const abort = () => { stop(child); done(new ChatGPTLocalError('cancelled')); };
    const timer = setTimeout(() => { stop(child); done(new ChatGPTLocalError('timed_out', { retryable: true })); }, timeoutMs); timer.unref?.();
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () => done(new ChatGPTLocalError('cli_unavailable')));
    child.stdout.setEncoding?.('utf8'); child.stderr.setEncoding?.('utf8');
    child.stdout.on('data', data => { bytes += Buffer.byteLength(data); if (bytes > maxBytes) { stop(child); return done(new ChatGPTLocalError('output_too_large')); } output += data.toString('utf8'); });
    child.stderr.on('data', data => { if (errorOutput.length < 16384) errorOutput += data.toString('utf8'); });
    child.on('close', code => done(null, { code, output, errorOutput }));
    if (prompt !== undefined) child.stdin.end(prompt); else child.stdin.end();
    if (signal?.aborted) abort();
  });
}
export function parseCodexExecOutput(output, exitCode = 0) {
  let completed = false, failed = false, text = '';
  for (const line of output.split('\n').filter(s => s.trim())) {
    let event; try { event = JSON.parse(line); } catch { throw new ChatGPTLocalError('invalid_response'); }
    if (event.type === 'turn.completed') completed = true;
    if (event.type === 'turn.failed' || event.type === 'error') failed = true;
    if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') text = event.item.text;
  }
  if (exitCode !== 0 || failed) throw new ChatGPTLocalError('generation_failed');
  if (!completed || !text.trim()) throw new ChatGPTLocalError('invalid_response');
  return text;
}

export async function createChatGPTLocalService({ cliPath, workDir = path.join(ROOT, 'server/local-data/codex-work'), spawnImpl = spawn, rpcFactory = createCodexRPC, commandRunner = runCommand, openBrowser = true } = {}) {
  try { cliPath ||= await getCodexExecutable(); } catch {}
  let busy, closed = false, loginController, imagesEnabled = false;
  const active = new Set();
  const rpcOptions = () => ({ cliPath, spawnImpl, cwd: ROOT });
  const begin = operation => { if (closed) throw new ChatGPTLocalError('cancelled'); if (busy) throw new ChatGPTLocalError('connection_busy'); if (!cliPath) throw new ChatGPTLocalError('sdk_unavailable'); busy = operation; };
  const envelope = (session, configured = true) => ({ configured, mode: 'local', provider: 'codex', session, profiles: session.profileId ? [{ id: session.profileId, label: '本机 Codex 账号', status: session.status, sharing: session.sharing, identity: session.identity }] : [], capabilities: { text: true, images: imagesEnabled, video: false }, usageUrl: CHATGPT_USAGE_URL });
  async function readStatus() {
    if (!cliPath) return envelope({ status: 'disconnected', sharing: false, error: new ChatGPTLocalError('sdk_unavailable').toJSON() }, false);
    if (busy === 'sign-in') return envelope({ status: 'connecting', sharing: false });
    let rpc;
    try {
      const check = await commandRunner(cliPath, ['login', 'status'], { spawnImpl, timeoutMs: 15000 });
      if (check.code !== 0 || !/logged in.*chatgpt/i.test(check.output + check.errorOutput)) {
        const usingKey = /api.?key/i.test(check.output + check.errorOutput);
        return envelope({ status: 'disconnected', sharing: false, ...(usingKey ? { error: new ChatGPTLocalError('api_key_not_allowed').toJSON() } : {}) });
      }
      rpc = await rpcFactory(rpcOptions());
      const account = await requireAccount(rpc);
      const features = await commandRunner(cliPath, ['features', 'list'], { spawnImpl, timeoutMs: 15000 });
      imagesEnabled = features.code === 0 && /^image_generation\s+\S+\s+true\s*$/m.test(features.output || '');
      return envelope({ status: 'connected', sharing: true, profileId: profileFor(account), profileLabel: '本机 Codex', identity: { ...(account.email ? { email: account.email } : {}) }, planType: account.planType });
    } catch (error) { return envelope({ status: 'reauth_required', sharing: false, error: safeError(error).toJSON() }, true); } finally { rpc?.close(); }
  }
  async function models() {
    begin('models'); let rpc;
    try { rpc = await rpcFactory(rpcOptions()); await requireAccount(rpc); return await modelCatalog(rpc); } catch (error) { throw safeError(error); } finally { rpc?.close(); busy = undefined; }
  }
  return {
    cliPath, status: readStatus,
    async signIn() {
      begin('sign-in'); loginController = new AbortController();
      try { const result = await commandRunner(cliPath, ['login'], { spawnImpl, timeoutMs: 10 * 60 * 1000, signal: loginController.signal }); if (result.code !== 0) throw new ChatGPTLocalError('sign_in_required'); }
      catch (error) { throw safeError(error); } finally { busy = undefined; loginController = undefined; }
      return readStatus();
    },
    cancelSignIn() { loginController?.abort(); },
    async selectProfile(id) { const current = await readStatus(); if (!id || id !== current.session.profileId) throw new ChatGPTLocalError('profile_not_found'); return current; },
    async signOut() { begin('sign-out'); try { const result = await commandRunner(cliPath, ['logout'], { spawnImpl, timeoutMs: 15000 }); if (result.code !== 0) throw new ChatGPTLocalError('chatgpt_unavailable'); } finally { busy = undefined; } return readStatus(); },
    models,
    async respond({ model, input, instructions, signal } = {}) {
      begin('response'); const controller = new AbortController(); active.add(controller); let rpc;
      try {
        if (typeof model !== 'string' || !model.trim() || model.length > 200 || typeof instructions !== 'undefined' && (typeof instructions !== 'string' || instructions.length > 50000)) throw new ChatGPTLocalError('invalid_request');
        const text = typeof input === 'string' ? input : Array.isArray(input) && input.every(m => m && ['user','assistant','developer'].includes(m.role) && typeof m.content === 'string') ? input.map(m => `${m.role}: ${m.content}`).join('\n\n') : '';
        if (!text.trim() || text.length > 200000) throw new ChatGPTLocalError('invalid_request');
        rpc = await rpcFactory(rpcOptions()); const account = await requireAccount(rpc); const beforeId = profileFor(account); const catalog = await modelCatalog(rpc); rpc.close(); rpc = undefined;
        if (!catalog.some(m => m.slug === model)) throw new ChatGPTLocalError('model_not_found');
        await mkdir(workDir, { recursive: true, mode: 0o700 });
        const args = ['exec', '--ephemeral', '--json', '--sandbox', 'read-only', '--ignore-user-config', ...disabledToolArgs(), '-c', 'model_provider="openai"', '-c', 'forced_login_method="chatgpt"', '-c', 'approval_policy="never"', '--skip-git-repo-check', '--color', 'never', '-m', model, '-'];
        const prompt = `${instructions || '返回用户要求的文本结果。'}\n\n不要读取账号凭证或修改文件。以下为用户创作输入：\n${text}`;
        const result = await commandRunner(cliPath, args, { cwd: workDir, prompt, spawnImpl, signal: AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]), timeoutMs: 240000 });
        const responseText = parseCodexExecOutput(result.output, result.code);
        rpc = await rpcFactory(rpcOptions()); if (profileFor(await requireAccount(rpc)) !== beforeId) throw new ChatGPTLocalError('connection_changed');
        return { text: responseText, model, profileId: beforeId, usingChatGPTPlan: true };
      } catch (error) { throw safeError(error); } finally { rpc?.close(); active.delete(controller); busy = undefined; }
    },
    close() { closed = true; loginController?.abort(); for (const operation of active) operation.abort(); },
  };
}
