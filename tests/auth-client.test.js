import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthClient, AuthClientError } from '../src/auth.js';

const CID = '1234567890-example-client.apps.googleusercontent.com';
const PAGE = 'https://studio.example/central-ai/';
const API = 'https://api.example';
const NOW = Date.parse('2026-10-30T01:00:00Z');
const expiresAt = new Date(NOW + 15 * 60 * 1000).toISOString();
const user = { id: 'google:12345', sub: '12345', name: 'Example Creator', email: 'creator@example.com', picture: 'https://example.com/avatar.jpg' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setup(extra = {}) {
  let callbacks;
  let rendered;
  let googleLoads = 0;
  let disabledAutoSelect = 0;
  const calls = [];
  const gis = {
    initialize(options) { callbacks = options; },
    renderButton(container, options) { rendered = { container, options }; },
    disableAutoSelect() { disabledAutoSelect += 1; },
  };
  const route = async (url, init) => {
    const path = new URL(url).pathname;
    if (extra.route) { const value = await extra.route(url, init); if (value !== undefined) return value; }
    if (path === '/api/config') return json({ google: { configured: true, clientId: CID } });
    if (path === '/api/auth/session') return json({ error: { code: 'unauthenticated', message: '未登录' } }, 401);
    if (path === '/api/auth/challenge') return json({ challengeId: 'challenge-1', nonce: 'nonce-123', expiresAt });
    if (path === '/api/auth/google') return json({ user, expiresAt, bearerExpiresAt: expiresAt, authentication: 'google' });
    if (path === '/api/auth/logout') return new Response(null, { status: 204 });
    if (path === '/api/test') return json({ ok: true });
    throw new Error(`Unexpected request ${url}`);
  };
  const client = createAuthClient({
    pageUrl: PAGE,
    runtimeConfig: { authEnabled: true, apiBaseUrl: API, googleClientId: CID },
    now: () => NOW,
    loadGoogle: async () => { googleLoads += 1; return gis; },
    ...extra.options,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return route(url, init); },
  });
  const container = { clientWidth: 320, replaceChildren() { this.emptied = true; } };
  return { client, calls, container, get callbacks() { return callbacks; }, get rendered() { return rendered; }, get googleLoads() { return googleLoads; }, get disabledAutoSelect() { return disabledAutoSelect; } };
}

async function signIn(context, credential = 'google-id-token') {
  await context.client.renderGoogleButton(context.container);
  await context.callbacks.callback({ credential });
}

test('disabled static deployment only loads its runtime config and never calls GitHub /api or Google', async () => {
  const urls = [];
  let googleLoaded = false;
  const client = createAuthClient({
    pageUrl: 'https://fenglingai-max.github.io/central-ai/', runtimeConfigUrl: 'https://fenglingai-max.github.io/central-ai/runtime-config.json',
    fetchImpl: async url => { urls.push(url); return json({ authEnabled: false, apiBaseUrl: '', googleClientId: '' }); },
    loadGoogle: async () => { googleLoaded = true; },
  });
  const updates = [];
  const unsubscribe = client.subscribe(s => updates.push(s.status));
  await client.init();
  assert.equal(client.snapshot().status, 'not_configured');
  assert.equal(client.snapshot().configured, false);
  await assert.rejects(client.renderGoogleButton({ replaceChildren() {} }), { code: 'not_configured' });
  assert.deepEqual(urls, ['https://fenglingai-max.github.io/central-ai/runtime-config.json']);
  assert.equal(googleLoaded, false);
  assert.ok(updates.includes('not_configured'));
  unsubscribe();
});

test('server configuration is authoritative and a mismatched client ID fails closed', async () => {
  const t = setup({ options: { runtimeConfig: { authEnabled: true, apiBaseUrl: API, googleClientId: 'other.apps.googleusercontent.com' } } });
  await t.client.init();
  assert.equal(t.client.snapshot().status, 'unavailable');
  assert.equal(t.client.snapshot().user, null);
  assert.equal(t.googleLoads, 0);
  assert.equal(t.calls.length, 1);
});

test('insecure remote destinations and URL credentials are rejected before any API request', async () => {
  for (const origin of ['http://api.example', 'https://user:password@api.example', 'https://api.example/somewhere', 'https://api.example/?token=secret']) {
    const t = setup({ options: { runtimeConfig: { authEnabled: true, apiBaseUrl: origin } } });
    await t.client.init();
    assert.equal(t.client.snapshot().status, 'unavailable');
    assert.equal(t.calls.length, 0);
  }
});

test('Google button gets the server nonce, and the user is not signed in until server verification succeeds', async () => {
  let finishVerify;
  const verification = new Promise(resolve => { finishVerify = resolve; });
  const t = setup({ route: (url) => new URL(url).pathname === '/api/auth/google' ? verification : undefined });
  await t.client.renderGoogleButton(t.container);
  assert.equal(t.callbacks.client_id, CID);
  assert.equal(t.callbacks.nonce, 'nonce-123');
  assert.equal(t.callbacks.auto_select, false);
  assert.equal(t.rendered.options.theme, 'outline');
  assert.equal(t.rendered.options.text, 'continue_with');
  assert.equal(t.container.emptied, true);
  const callbackPromise = t.callbacks.callback({ credential: 'google-id-token' });
  assert.equal(t.client.snapshot().status, 'signed_out');
  assert.equal(t.client.snapshot().user, null);
  finishVerify(json({ user, expiresAt, authentication: 'google' }));
  await callbackPromise;
  assert.equal(t.client.snapshot().status, 'signed_in');
  assert.equal(t.client.snapshot().user.id, 'google:12345');
  assert.equal(t.client.snapshot().user.sub, undefined);
  const exchange = t.calls.find(call => call.url.endsWith('/api/auth/google'));
  assert.deepEqual(JSON.parse(exchange.init.body), { challengeId: 'challenge-1', credential: 'google-id-token' });
  assert.equal(exchange.init.redirect, 'error');
});

test('rejected credentials cannot create a local authenticated user', async () => {
  const t = setup({ route: url => new URL(url).pathname === '/api/auth/google' ? json({ error: { code: 'invalid_credential', message: '凭证无效' } }, 401) : undefined });
  await signIn(t);
  assert.equal(t.client.snapshot().status, 'signed_out');
  assert.equal(t.client.snapshot().user, null);
  assert.equal(t.client.snapshot().errorMessage, '凭证无效');
  await assert.rejects(t.client.fetchAuthenticated('/api/test'), { code: 'unauthorized' });
});

test('cross-origin token stays in memory, is sent only to the configured API, and does not survive a fresh client', async () => {
  const t = setup();
  await signIn(t, 'private-google-token');
  assert.equal(t.calls.some(call => call.url.endsWith('/api/auth/session')), false);
  await t.client.fetchAuthenticated('/api/test', { headers: { Authorization: 'Bearer caller-token' }, credentials: 'include', redirect: 'follow' });
  const authenticated = t.calls.at(-1);
  assert.equal(authenticated.url, `${API}/api/test`);
  assert.equal(authenticated.init.headers.get('Authorization'), 'Bearer private-google-token');
  assert.equal(authenticated.init.credentials, 'omit');
  assert.equal(authenticated.init.redirect, 'error');
  for (const url of ['https://other.example/api/test', `${API}/other`, '//other.example/api/test', `${API}/api/test#secret`])
    await assert.rejects(t.client.fetchAuthenticated(url), { code: 'untrusted_destination' });
  const snap = t.client.snapshot();
  assert.equal(JSON.stringify(snap).includes('private-google-token'), false);
  const fresh = setup();
  await fresh.client.init();
  assert.equal(fresh.client.snapshot().status, 'signed_out');
});

test('same-origin deployment restores verified HttpOnly session and never adds a bearer header', async () => {
  const t = setup({
    options: { runtimeConfig: { authEnabled: true, apiBaseUrl: '', googleClientId: CID } },
    route: url => new URL(url).pathname === '/api/auth/session' ? json({ authenticated: true, user, expiresAt }) : undefined,
  });
  await t.client.init();
  assert.equal(t.client.snapshot().status, 'signed_in');
  assert.equal(t.client.snapshot().apiBaseUrl, 'https://studio.example');
  assert.equal(t.googleLoads, 0);
  await t.client.fetchAuthenticated('/api/test');
  assert.equal(t.calls.at(-1).init.credentials, 'same-origin');
  assert.equal(t.calls.at(-1).init.headers.has('Authorization'), false);
});

test('same-origin missing session is a signed-out state, not an unavailable service', async () => {
  const t = setup({ options: { runtimeConfig: { authEnabled: true, apiBaseUrl: '' } } });
  await t.client.init();
  assert.equal(t.client.snapshot().status, 'signed_out');
  assert.equal(t.client.snapshot().configured, true);
});

test('logout revokes the grant before clearing the local user and disables automatic selection', async () => {
  const t = setup();
  await signIn(t);
  await t.client.signOut();
  const logout = t.calls.find(call => call.url.endsWith('/api/auth/logout'));
  assert.equal(logout.init.headers.Authorization, 'Bearer google-id-token');
  assert.equal(logout.init.credentials, 'omit');
  assert.equal(t.client.snapshot().user, null);
  assert.equal(t.client.snapshot().status, 'signed_out');
  assert.equal(t.disabledAutoSelect, 1);
  await assert.rejects(t.client.fetchAuthenticated('/api/test'), { code: 'unauthorized' });
});

test('failed logout keeps the verified state visible instead of claiming server revocation', async () => {
  const t = setup({ route: url => new URL(url).pathname === '/api/auth/logout' ? json({ error: { code: 'unavailable', message: '暂时不可用' } }, 503) : undefined });
  await signIn(t);
  await assert.rejects(t.client.signOut(), { code: 'unavailable' });
  assert.equal(t.client.snapshot().status, 'signed_in');
});

test('expired login challenge never opens Google or accepts a credential', async () => {
  const t = setup({ route: url => new URL(url).pathname === '/api/auth/challenge' ? json({ challengeId: 'old', nonce: 'old', expiresAt: new Date(NOW - 1000).toISOString() }) : undefined });
  await assert.rejects(t.client.renderGoogleButton(t.container), { code: 'invalid_response' });
  assert.equal(t.googleLoads, 0);
  assert.equal(t.client.snapshot().user, null);
});

test('an expired or malformed server session is never treated as successful authentication', async () => {
  for (const result of [
    { user, expiresAt: new Date(NOW - 1000).toISOString(), authentication: 'google' },
    { user: { id: 'other-account' }, expiresAt, authentication: 'google' },
    { user, expiresAt, authentication: 'unverified' },
  ]) {
    const t = setup({ route: url => new URL(url).pathname === '/api/auth/google' ? json(result) : undefined });
    await signIn(t);
    assert.equal(t.client.snapshot().status, 'signed_out');
    assert.equal(t.client.snapshot().user, null);
  }
});

test('a stale Google popup callback is ignored when a newer login attempt exists', async () => {
  const t = setup();
  await t.client.renderGoogleButton(t.container);
  const oldCallback = t.callbacks.callback;
  await t.client.renderGoogleButton(t.container);
  await oldCallback({ credential: 'stale-token' });
  assert.equal(t.calls.filter(call => call.url.endsWith('/api/auth/google')).length, 0);
  assert.equal(t.client.snapshot().status, 'signed_out');
});

test('network errors remain visible and request redirects cannot silently receive a credential', async () => {
  const t = setup({ route: url => { if (new URL(url).pathname === '/api/config') throw new Error('offline'); } });
  await t.client.init();
  assert.equal(t.client.snapshot().status, 'unavailable');
  assert.equal(t.client.snapshot().user, null);
  assert.ok(t.client.snapshot().message.includes('无法连接'));
  assert.equal(t.calls[0].init.redirect, 'error');
});


test('cross-origin login uses the shorter bearer grant expiration returned by the server', async () => {
  const bearerExpiresAt = new Date(NOW + 5 * 60 * 1000).toISOString();
  const t = setup({ route: url => new URL(url).pathname === '/api/auth/google' ? json({ user, expiresAt, bearerExpiresAt, authentication: 'google' }) : undefined });
  await signIn(t);
  assert.equal(t.client.snapshot().expiresAt, bearerExpiresAt);
  assert.equal(t.client.snapshot().errorMessage, '');
});


test('an old in-flight verification failure cannot clear a newer successful login', async () => {
  let rejectOld;
  const oldVerification = new Promise((resolve, reject) => { rejectOld = reject; });
  const t = setup({ route: (url, init) => {
    if (new URL(url).pathname === '/api/auth/google' && JSON.parse(init.body).credential === 'old-token') return oldVerification;
  }});
  await t.client.renderGoogleButton(t.container);
  const oldRequest = t.callbacks.callback({ credential: 'old-token' });
  await t.client.renderGoogleButton(t.container);
  await t.callbacks.callback({ credential: 'new-token' });
  assert.equal(t.client.snapshot().status, 'signed_in');
  rejectOld(new Error('old exchange failed'));
  await oldRequest;
  assert.equal(t.client.snapshot().status, 'signed_in');
  assert.equal(t.client.snapshot().errorMessage, '');
  await t.client.fetchAuthenticated('/api/test');
  assert.equal(t.calls.at(-1).init.headers.get('Authorization'), 'Bearer new-token');
});

test('an old in-flight challenge failure does not overwrite a newer login attempt', async () => {
  let rejectOld;
  let challengeCount = 0;
  const oldChallenge = new Promise((resolve, reject) => { rejectOld = reject; });
  const t = setup({ route: url => {
    if (new URL(url).pathname === '/api/auth/challenge' && ++challengeCount === 1) return oldChallenge;
  }});
  await t.client.init();
  const firstAttempt = t.client.renderGoogleButton(t.container);
  await Promise.resolve();
  await t.client.renderGoogleButton(t.container);
  await t.callbacks.callback({ credential: 'new-token' });
  rejectOld(new Error('old challenge failed'));
  await firstAttempt;
  assert.equal(t.client.snapshot().status, 'signed_in');
  assert.equal(t.client.snapshot().errorMessage, '');
});
