import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatGPTClient } from '../src/chatgpt.js';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const envelope = (status = 'connected', sharing = true, profileId = 'personal-1') => ({
  configured: true, mode: 'local', provider: 'chatgpt',
  session: { status, sharing, profileId, profileLabel: 'My account', identity: { name: 'Creator', email: 'creator@example.com' } },
  profiles: [{ id: 'personal-1', label: 'My account', status, sharing, identity: { name: 'Creator', email: 'creator@example.com' } }],
  capabilities: { text: true, images: false, video: false }, usageUrl: 'https://chatgpt.com/settings/usage',
});
const models = [{ slug: 'available-model', displayName: 'Available model' }, { slug: 'other-model', displayName: 'Other model' }];
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function setup({ state = envelope(), route, options = {} } = {}) {
  const calls = [];
  let current = state;
  const client = createChatGPTClient({
    pageUrl: 'http://localhost:4173/', ...options,
    fetchImpl: (url, init) => {
      calls.push({ url, init });
      const result = Promise.resolve().then(async () => {
        const custom = route ? await route(url, init) : undefined;
        if (custom !== undefined) return custom;
        const path = new URL(url).pathname;
        if (path === '/api/chatgpt/status') return json(current);
        if (path === '/api/chatgpt/profiles') return json({ profiles: current.profiles });
        if (path === '/api/chatgpt/models') return json(models);
        if (path === '/api/chatgpt/sign-in') { current = envelope(); return json(current); }
        if (path === '/api/chatgpt/sign-out' || path === '/api/chatgpt/cancel-sign-in') { current = envelope('disconnected', false); return json(current); }
        if (path === '/api/chatgpt/select-profile') { current = envelope('connected', true, JSON.parse(init.body).profileId); return json(current); }
        if (path === '/api/chatgpt/creative-generation') return json({ project: { id: 'real-project', generation: { connected: true } } });
        throw new Error(`Unexpected ${url}`);
      });
      return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('aborted', 'AbortError'));
        if (init.signal.aborted) return abort();
        init.signal.addEventListener('abort', abort, { once: true });
        result.then(resolve, reject).finally(() => init.signal.removeEventListener('abort', abort));
      });
    },
  });
  return { client, calls, setState(data) { current = data; } };
}
async function ready(t) { await t.client.init(); await t.client.listModels(); }

test('hosted and lookalike origins never make local requests or start authorization', async () => {
  for (const pageUrl of ['https://fenglingai-max.github.io/central-ai/', 'https://localhost.evil.example/', 'http://127.0.0.1.evil.example/', 'http://192.168.1.2:4173/', 'file:///studio/index.html']) {
    let requests = 0;
    const c = createChatGPTClient({ pageUrl, fetchImpl: async () => { requests++; throw new Error('must not connect'); } });
    assert.equal(c.snapshot().status, 'local_required');
    await c.init();
    await c.refresh();
    for (const run of [() => c.signIn(), () => c.listProfiles(), () => c.listModels(), () => c.signOut(), () => c.selectProfile('a'), () => c.generateCreativePackage({}, 'a')])
      await assert.rejects(run(), { code: 'local_required' });
    assert.equal(requests, 0);
  }
});

test('local connected and sharing authorization is explicit; public snapshot drops credential-shaped fields', async () => {
  const data = envelope();
  data.accessToken = 'should-never-appear'; data.session.token = 'private-token'; data.profiles[0].secret = 'private-secret';
  const t = setup({ state: data });
  await t.client.init();
  const s = t.client.snapshot();
  assert.equal(s.status, 'ready'); assert.equal(s.authenticated, true); assert.equal(s.session.sharing, true);
  assert.equal(s.session.status, 'connected');
  assert.equal(s.capabilities.images, false); assert.equal(s.capabilities.video, false);
  assert.equal(JSON.stringify(s).includes('private-'), false);
  assert.equal(JSON.stringify(s).includes('should-never-appear'), false);
  assert.equal(t.calls[0].url, 'http://localhost:4173/api/chatgpt/status');
  assert.equal(t.calls[0].init.credentials, 'same-origin');
  assert.equal(t.calls[0].init.redirect, 'error');
  assert.equal(t.calls[0].init.headers.Authorization, undefined);
});

test('connected without sharing is distinct from signed out and cannot list models or generate', async () => {
  const t = setup({ state: envelope('connected', false) });
  await t.client.init();
  assert.equal(t.client.snapshot().status, 'sharing_required');
  assert.equal(t.client.snapshot().authenticated, true);
  await assert.rejects(t.client.listModels(), { code: 'sharing_required' });
  await assert.rejects(t.client.generateCreativePackage({}, 'available-model'), { code: 'sharing_required' });
  assert.equal(t.calls.length, 1);
});

test('disconnected, connecting, reauthorization, and unavailable states remain distinguishable', async () => {
  for (const [raw, expected] of [['disconnected', 'signed_out'], ['connecting', 'waiting_for_browser'], ['reauth_required', 'signed_out']]) {
    const t = setup({ state: envelope(raw, false) }); await t.client.init();
    assert.equal(t.client.snapshot().status, expected); assert.equal(t.client.snapshot().authenticated, false);
  }
  const t = setup({ state: { ...envelope(), configured: false } }); await t.client.init();
  assert.equal(t.client.snapshot().status, 'unavailable');
});

test('model list is the live account result and unsupported model IDs are never guessed', async () => {
  const t = setup(); await ready(t);
  assert.deepEqual(t.client.snapshot().models.map(m => m.slug), ['available-model', 'other-model']);
  await assert.rejects(t.client.generateCreativePackage({ theme: 'A story' }, 'invented-model'), { code: 'model_required' });
  const project = await t.client.generateCreativePackage({ theme: 'A story' }, 'other-model');
  assert.equal(project.id, 'real-project');
  const call = t.calls.at(-1);
  assert.deepEqual(JSON.parse(call.init.body), { input: { theme: 'A story' }, model: 'other-model' });
});

test('creative failure never silently produces a demo project', async () => {
  const t = setup({ route: url => new URL(url).pathname === '/api/chatgpt/creative-generation' ? json({ notice: 'no project' }) : undefined });
  await ready(t);
  await assert.rejects(t.client.generateCreativePackage({ theme: 'A story' }, 'available-model'), { code: 'invalid_response' });
  assert.equal(t.client.snapshot().generating, false);
  assert.ok(t.client.snapshot().errorMessage.includes('未返回完整项目'));
});

test('browser authorization stays pending beyond a normal request timeout and can complete normally', async () => {
  const login = deferred();
  const t = setup({ state: envelope('disconnected', false), options: { requestTimeoutMs: 3, signInTimeoutMs: 300 },
    route: url => new URL(url).pathname === '/api/chatgpt/sign-in' ? login.promise : undefined });
  await t.client.init();
  const promise = t.client.signIn({ newProfile: true, reconsent: true });
  assert.equal(t.client.snapshot().status, 'waiting_for_browser');
  await new Promise(resolve => setTimeout(resolve, 12));
  assert.equal(t.client.snapshot().status, 'waiting_for_browser');
  t.setState(envelope()); login.resolve(json(envelope())); await promise;
  assert.equal(t.client.snapshot().status, 'ready');
  const signIn = t.calls.find(c => c.url.endsWith('/sign-in'));
  assert.deepEqual(JSON.parse(signIn.init.body), { newProfile: true, reconsent: true });
});

test('cancel authorization calls the backend, aborts the old wait, and does not invent a logged-in session', async () => {
  const login = deferred();
  const t = setup({ state: envelope('connecting', false), route: url => new URL(url).pathname === '/api/chatgpt/sign-in' ? login.promise : undefined });
  await t.client.init(); const waiting = t.client.signIn();
  await t.client.cancelSignIn(); await waiting;
  assert.equal(t.client.snapshot().status, 'signed_out');
  assert.equal(t.client.snapshot().session.sharing, false);
  assert.equal(t.calls.some(c => c.url.endsWith('/cancel-sign-in')), true);
  login.resolve(json(envelope()));
  await Promise.resolve(); assert.equal(t.client.snapshot().status, 'signed_out');
});

test('profile selection clears old model choices until the selected account is confirmed', async () => {
  const selection = deferred();
  const t = setup({ route: url => new URL(url).pathname === '/api/chatgpt/select-profile' ? selection.promise : undefined });
  await ready(t);
  const switching = t.client.selectProfile('personal-2');
  assert.equal(t.client.snapshot().status, 'loading');
  assert.equal(t.client.snapshot().models.length, 0);
  await assert.rejects(t.client.generateCreativePackage({}, 'available-model'), { code: 'sharing_required' });
  t.setState(envelope('connected', true, 'personal-2')); selection.resolve(json(envelope('connected', true, 'personal-2'))); await switching;
  assert.equal(t.client.snapshot().session.profileId, 'personal-2');
  assert.equal(t.client.snapshot().models.length, 0);
});

test('an old model response cannot populate a newly selected profile', async () => {
  const pendingModels = deferred();
  const t = setup({ route: url => new URL(url).pathname === '/api/chatgpt/models' ? pendingModels.promise : undefined });
  await t.client.init(); const modelRequest = t.client.listModels();
  await t.client.selectProfile('personal-2');
  pendingModels.resolve(json(models)); await modelRequest;
  assert.equal(t.client.snapshot().session.profileId, 'personal-2');
  assert.equal(t.client.snapshot().models.length, 0);
});

test('stale status responses cannot overwrite a newer authoritative status', async () => {
  const first = deferred(); let count = 0;
  const t = setup({ route: url => new URL(url).pathname === '/api/chatgpt/status' && ++count === 1 ? first.promise : undefined });
  const oldStatus = t.client.refresh(); await t.client.refresh();
  assert.equal(t.client.snapshot().status, 'ready');
  first.resolve(json(envelope('disconnected', false))); await oldStatus;
  assert.equal(t.client.snapshot().status, 'ready');
});

test('signing out is confirmed by the backend and failed signout does not claim success', async () => {
  const t = setup(); await ready(t); await t.client.signOut();
  assert.equal(t.client.snapshot().status, 'signed_out'); assert.equal(t.client.snapshot().models.length, 0);
  const bad = setup({ route: url => new URL(url).pathname === '/api/chatgpt/sign-out' ? json({ error: { code: 'busy', message: '仍有任务' } }, 409) : undefined });
  await ready(bad);
  await assert.rejects(bad.client.signOut(), { code: 'busy' });
  assert.equal(bad.client.snapshot().status, 'ready');
});

test('concurrent generation and account switching are blocked while a request is running', async () => {
  const generation = deferred();
  const t = setup({ route: url => new URL(url).pathname === '/api/chatgpt/creative-generation' ? generation.promise : undefined });
  await ready(t); const first = t.client.generateCreativePackage({}, 'available-model');
  assert.equal(t.client.snapshot().generating, true);
  await assert.rejects(t.client.generateCreativePackage({}, 'available-model'), { code: 'generation_in_progress' });
  await assert.rejects(t.client.selectProfile('personal-2'), { code: 'generation_in_progress' });
  await assert.rejects(t.client.signOut(), { code: 'generation_in_progress' });
  generation.resolve(json({ project: { id: 'done' } })); assert.equal((await first).id, 'done');
  assert.equal(t.client.snapshot().generating, false);
});

test('manual refresh can recover a local server that was initially unavailable', async () => {
  let offline = true;
  const t = setup({ route: () => { if (offline) throw new Error('server stopped'); } });
  const statuses = []; const unsub = t.client.subscribe(s => statuses.push(s.status));
  await t.client.init(); assert.equal(t.client.snapshot().status, 'unavailable');
  offline = false; await t.client.init({ force: true }); assert.equal(t.client.snapshot().status, 'ready');
  assert.ok(statuses.includes('unavailable')); assert.ok(statuses.includes('ready')); unsub();
});

const IMAGE_ID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_IMAGE_ID = '123e4567-e89b-42d3-a456-426614174001';
const PNG_REFERENCE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2sAAAAASUVORK5CYII=';
const imageInput = () => ({ projectId: 'central-project', assetId: 'C001', prompt: 'A single character reference sheet.', references: [{ id: 'ref-1', type: 'portrait', name: 'reference.png', dataUrl: PNG_REFERENCE }] });
function imageEnvelope() { const data = envelope(); data.capabilities.images = true; return data; }

test('image submission creates one asynchronous queued job with explicit references and no automatic polling', async () => {
  const t = setup({ state: imageEnvelope(), route: (url, init) => new URL(url).pathname === '/api/chatgpt/image-jobs' ? json({ job: { id: IMAGE_ID, status: 'queued' } }) : undefined });
  await t.client.init();
  const input = { ...imageInput(), apiKey: 'must-not-be-forwarded' };
  const job = await t.client.startImageJob(input);
  assert.equal(job.id, IMAGE_ID); assert.equal(job.status, 'queued'); assert.equal(job.imageUrl, undefined);
  const calls = t.calls.filter(c => c.url.includes('/image-jobs'));
  assert.equal(calls.length, 1); assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), imageInput());
  assert.equal(t.client.snapshot().generating, false);
});

test('image jobs require an authorized local account and detected native image capability', async () => {
  const disabled = setup(); await disabled.client.init();
  await assert.rejects(disabled.client.startImageJob(imageInput()), { code: 'images_unavailable' });
  assert.equal(disabled.calls.length, 1);
  const noSharing = setup({ state: { ...imageEnvelope(), session: { status: 'connected', sharing: false } } });
  await noSharing.client.init();
  await assert.rejects(noSharing.client.startImageJob(imageInput()), { code: 'sharing_required' });
  let calls = 0;
  const remote = createChatGPTClient({ pageUrl: 'https://fenglingai-max.github.io/central-ai/', fetchImpl: async () => { calls++; } });
  for (const fn of [() => remote.startImageJob(imageInput()), () => remote.getImageJob(IMAGE_ID), () => remote.cancelImageJob(IMAGE_ID)])
    await assert.rejects(fn(), { code: 'local_required' });
  assert.equal(calls, 0);
});

test('image status requests accept only UUID IDs and cannot become arbitrary local or remote endpoints', async () => {
  const t = setup({ state: imageEnvelope() }); await t.client.init();
  for (const id of ['../status', 'https://evil.example/job', `${IMAGE_ID}/cancel`, `${IMAGE_ID}?url=x`, '%2e%2e%2fstatus', '00000000-0000-0000-0000-000000000000', 'not-a-uuid']) {
    await assert.rejects(t.client.getImageJob(id), { code: 'invalid_job_id' });
    await assert.rejects(t.client.cancelImageJob(id), { code: 'invalid_job_id' });
  }
  assert.equal(t.calls.length, 1);
});

test('running image jobs remain pending, and cancellation uses the fixed local POST endpoint', async () => {
  const t = setup({ state: imageEnvelope(), route: (url) => {
    const path = new URL(url).pathname;
    if (path === `/api/chatgpt/image-jobs/${IMAGE_ID}`) return json({ id: IMAGE_ID, status: 'running' });
    if (path === `/api/chatgpt/image-jobs/${IMAGE_ID}/cancel`) return json({ job: { id: IMAGE_ID, status: 'cancelled' } });
  } }); await t.client.init();
  assert.deepEqual(await t.client.getImageJob(IMAGE_ID), { id: IMAGE_ID, status: 'running' });
  const cancelled = await t.client.cancelImageJob(IMAGE_ID);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(t.calls.at(-1).url, `http://localhost:4173/api/chatgpt/image-jobs/${IMAGE_ID}/cancel`);
  assert.equal(t.calls.at(-1).init.method, 'POST');
  assert.deepEqual(JSON.parse(t.calls.at(-1).init.body), {});
});

test('completed image jobs accept only their own same-origin PNG artifact URL', async () => {
  const path = `/api/chatgpt/image-jobs/${IMAGE_ID}/image.png`;
  const t = setup({ state: imageEnvelope(), route: url => new URL(url).pathname.endsWith(IMAGE_ID) ? json({ job: { id: IMAGE_ID, status: 'succeeded', imageUrl: path } }) : undefined });
  await t.client.init(); const job = await t.client.getImageJob(IMAGE_ID);
  assert.equal(job.imageUrl, `http://localhost:4173${path}`);
  for (const imageUrl of [undefined, `https://evil.example${path}`, `http://localhost:9999${path}`, path.replace('.png', '.svg'), `${path}?token=secret`, `${path}#other`, PNG_REFERENCE, `/api/chatgpt/image-jobs/${OTHER_IMAGE_ID}/image.png`]) {
    const bad = setup({ state: imageEnvelope(), route: url => new URL(url).pathname.endsWith(IMAGE_ID) ? json({ id: IMAGE_ID, status: 'succeeded', imageUrl }) : undefined });
    await bad.client.init();
    await assert.rejects(bad.client.getImageJob(IMAGE_ID), { code: 'invalid_response' });
  }
});

test('mismatched job IDs and unsupported success shapes never show a generated image', async () => {
  for (const job of [{ id: OTHER_IMAGE_ID, status: 'running' }, { id: IMAGE_ID, status: 'completed' }, { id: IMAGE_ID, status: 'succeeded' }]) {
    const t = setup({ state: imageEnvelope(), route: url => new URL(url).pathname.endsWith(IMAGE_ID) ? json({ job }) : undefined });
    await t.client.init(); await assert.rejects(t.client.getImageJob(IMAGE_ID), { code: 'invalid_response' });
  }
});

test('image references must be reuploaded image data, not SVGs or unverified remote URLs', async () => {
  const t = setup({ state: imageEnvelope() }); await t.client.init();
  for (const dataUrl of ['https://example.com/reference.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', undefined, 'data:image/png;base64,broken']) {
    const input = imageInput(); input.references[0].dataUrl = dataUrl;
    await assert.rejects(t.client.startImageJob(input), { code: 'invalid_image_input' });
  }
  const tooMany = imageInput(); tooMany.references = Array.from({ length: 10 }, () => imageInput().references[0]);
  await assert.rejects(t.client.startImageJob(tooMany), { code: 'invalid_image_input' });
  assert.equal(t.calls.length, 1);
});

test('the native Codex service envelope is accepted by the browser, with real native image capability', async()=>{
  const t=setup({state:{...envelope(),provider:'codex',capabilities:{text:true,images:true,video:false}}});
  await ready(t);assert.equal(t.client.snapshot().status,'ready');assert.equal(t.client.snapshot().capabilities.images,true);assert.equal(t.client.snapshot().models.length,2);
});
