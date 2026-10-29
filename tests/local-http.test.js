import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createApp } from '../server/app.js';
import { createAuthService } from '../server/auth.js';

const HOST = 'localhost:3000', ORIGIN = `http://${HOST}`;
async function request(app, { method = 'GET', url = '/api/chatgpt/status', host = HOST, origin, body, headers = {} } = {}) {
  const req = Readable.from(body === undefined ? [] : [typeof body === 'string' ? body : JSON.stringify(body)]);
  Object.assign(req, { method, url, socket: { remoteAddress: '127.0.0.1' }, headers: {
    ...(host !== null ? { host } : {}), ...(origin ? { origin } : {}),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers,
  } });
  const result = {};
  await app(req, {
    writeHead(status, responseHeaders) { result.status = status; result.headers = responseHeaders; },
    end(data) { result.raw = data; if (data) { try { result.body = JSON.parse(data); } catch {} } },
  });
  return result;
}
function fixture({ sharing = false, localMode = true, ...options } = {}) {
  const calls = [];
  const status = { configured: true, mode: 'local', provider: 'chatgpt',
    session: { status: sharing ? 'signed_in' : 'signed_out', sharing }, profiles: [{ id: 'profile-1', label: 'My profile' }],
    capabilities: { text: true, images: false, video: false }, usageUrl: 'https://chatgpt.com/settings/usage' };
  const service = {
    status: async () => status,
    signIn: async value => { calls.push(['signIn', value]); return status; },
    cancelSignIn: async () => { calls.push(['cancelSignIn']); return status; },
    selectProfile: async value => { calls.push(['selectProfile', value]); return status; },
    signOut: async () => { calls.push(['signOut']); return status; },
    models: async () => { calls.push(['models']); return [{ slug: 'available-model', displayName: 'Available model' }]; },
  };
  const app = createApp({
    authService: createAuthService({ publicOrigin: ORIGIN }), localMode, localPort: 3000,
    chatgptService: service, serveStatic: false,
    creativeHandler: async (body, context) => { calls.push(['creative', body, context.chatgptService === service]); return { project: { status: 'generated', id: 'p1' } }; },
    ...options,
  });
  return { app, calls, service };
}

test('local status works without Google client ID or Origin and returns only the public envelope', async () => {
  const { app, calls } = fixture();
  const r = await request(app);
  assert.equal(r.status, 200); assert.equal(r.body.provider, 'chatgpt');
  assert.equal(r.body.session.sharing, false); assert.deepEqual(calls, []);
  const runtime = await request(app, { url: '/runtime-config.json' });
  assert.deepEqual(runtime.body.chatgpt, { enabled: true, mode: 'local', apiBaseUrl: '' });
  assert.equal(runtime.body.googleClientId, '');
  const profiles = await request(app, { url: '/api/chatgpt/profiles' });
  assert.deepEqual(profiles.body, { profiles: [{ id: 'profile-1', label: 'My profile' }] });
});

test('rejects DNS-rebinding Host, remote Origin, missing POST Origin, and cross-site fetches before SDK calls', async () => {
  for (const input of [
    { host: 'evil.example:3000' }, { host: 'localhost.evil.example:3000' },
    { host: '127.0.0.1:3000.evil.example' }, { host: '0.0.0.0:3000' },
    { host: 'localhost:4173' }, { host: null },
    { origin: 'https://fenglingai-max.github.io' }, { origin: 'http://localhost:4173' },
    { host: HOST, origin: 'http://127.0.0.1:3000' },
    { headers: { 'sec-fetch-site': 'cross-site' } },
    { headers: { 'sec-fetch-site': 'same-site' } },
    { method: 'POST', url: '/api/chatgpt/sign-in', body: {} },
  ]) {
    const { app, calls } = fixture();
    const r = await request(app, input);
    assert.equal(r.status, 403, JSON.stringify(input));
    assert.equal(r.headers['Access-Control-Allow-Origin'], undefined);
    assert.deepEqual(calls, []);
  }
});

test('allows the two exact loopback hostnames only with their matching local Origin', async () => {
  for (const host of ['localhost:3000', '127.0.0.1:3000']) {
    const { app } = fixture();
    const r = await request(app, { host, origin: `http://${host}`, headers: { 'sec-fetch-site': 'same-origin' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers['Access-Control-Allow-Origin'], `http://${host}`);
  }
});

test('explicit sign-in opens the official browser flow and only explicit profile IDs reach the SDK', async () => {
  const { app, calls } = fixture();
  let r = await request(app, { method: 'POST', url: '/api/chatgpt/sign-in', origin: ORIGIN, body: { openBrowser: false, redirect: 'https://attacker.example' } });
  assert.equal(r.status, 200); assert.deepEqual(calls.at(-1), ['signIn', { openBrowser: true }]);
  r = await request(app, { method: 'POST', url: '/api/chatgpt/select-profile', origin: ORIGIN, body: { profileId: 'profile-1' } });
  assert.equal(r.status, 200); assert.deepEqual(calls.at(-1), ['selectProfile', 'profile-1']);
  const count = calls.length;
  r = await request(app, { method: 'POST', url: '/api/chatgpt/select-profile', origin: ORIGIN, body: { profileId: '' } });
  assert.equal(r.status, 400); assert.equal(calls.length, count);
  await request(app, { method: 'POST', url: '/api/chatgpt/cancel-sign-in', origin: ORIGIN, body: {} });
  assert.deepEqual(calls.at(-1), ['cancelSignIn']);
  await request(app, { method: 'POST', url: '/api/chatgpt/sign-out', origin: ORIGIN, body: {} });
  assert.deepEqual(calls.at(-1), ['signOut']);
});

test('model discovery and creation cannot spend plan usage before explicit sharing', async () => {
  const { app, calls } = fixture();
  let r = await request(app, { url: '/api/chatgpt/models' });
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'chatgpt_sharing_required');
  r = await request(app, { method: 'POST', url: '/api/chatgpt/creative-generation', origin: ORIGIN, body: { input: { theme: 'test' } } });
  assert.equal(r.status, 403); assert.deepEqual(calls, []);
});

test('shares only the selected local service with the creative handler and preserves its generated result', async () => {
  const { app, calls } = fixture({ sharing: true });
  const modelList = await request(app, { url: '/api/chatgpt/models' });
  assert.deepEqual(modelList.body, [{ slug: 'available-model', displayName: 'Available model' }]);
  const body = { model: 'available-model', input: { theme: '用户原始主题', references: [{ name: 'ref.png', type: 'portrait' }] } };
  const r = await request(app, { method: 'POST', url: '/api/chatgpt/creative-generation', origin: ORIGIN, body });
  assert.equal(r.status, 200); assert.equal(r.body.project.id, 'p1');
  assert.deepEqual(calls.at(-1), ['creative', body, true]);
});

test('public server mode refuses all ChatGPT operations even when given a configured local service', async () => {
  const { app, calls } = fixture({ localMode: false });
  const r = await request(app);
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'local_only');
  assert.deepEqual(calls, []);
});

test('SDK-safe errors are exposed, arbitrary provider exceptions remain hidden', async () => {
  const { app, service } = fixture();
  service.signIn = async () => { const e = new Error('本机安全存储不可用。'); Object.assign(e, { name: 'ChatGPTLocalError', code: 'secure_storage_unavailable', status: 503, retryable: true }); throw e; };
  let r = await request(app, { method: 'POST', url: '/api/chatgpt/sign-in', origin: ORIGIN, body: {} });
  assert.equal(r.status, 503); assert.equal(r.body.error.code, 'secure_storage_unavailable');
  service.signIn = async () => { throw new Error('secret_token_in_provider_stack'); };
  r = await request(app, { method: 'POST', url: '/api/chatgpt/sign-in', origin: ORIGIN, body: {} });
  assert.equal(r.status, 500); assert.doesNotMatch(r.raw, /secret_token/);
});
