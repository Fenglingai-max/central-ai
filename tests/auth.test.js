import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService, AuthError, normalizeOrigin } from '../server/auth.js';

const CLIENT_ID = '123456-test.apps.googleusercontent.com';
const SERVER = 'https://api.central.example';
const STATIC = 'https://fenglingai-max.github.io';
const TIME = 1_793_289_600_000;
function fixture(options = {}) {
  let current = TIME, claims, verificationCalls = 0;
  const auth = createAuthService({
    googleClientId: CLIENT_ID, publicOrigin: SERVER, allowedOrigins: [STATIC],
    now: () => current,
    verifyIdToken: async credential => {
      verificationCalls += 1;
      if (credential === 'invalid-signature') throw new Error('provider internals must not leak');
      return claims;
    },
    ...options,
  });
  return {
    auth,
    setClaims: value => { claims = value; },
    advance: milliseconds => { current += milliseconds; },
    get verificationCalls() { return verificationCalls; },
    async signIn(origin = STATIC, overrides = {}, credential = 'signed.google.token') {
      const challenge = auth.challenge(origin);
      claims = { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'google-user-01',
        name: '测试用户', email: 'person@example.com', picture: 'https://lh3.googleusercontent.com/a/test',
        iat: Math.floor(current / 1000), exp: Math.floor(current / 1000) + 3600,
        nonce: challenge.nonce, ...overrides };
      return { result: await auth.exchange({ challengeId: challenge.challengeId, credential }, origin), challenge, credential };
    },
  };
}
const hasCode = code => error => error instanceof AuthError && error.code === code;

test('reports missing OAuth setup without loading a verifier or manufacturing a user', async () => {
  let used = false;
  const auth = createAuthService({ verifyIdToken: async () => { used = true; }, publicOrigin: SERVER });
  assert.deepEqual(auth.config().google, { configured: false, clientId: '' });
  assert.throws(() => auth.challenge(SERVER), hasCode('not_configured'));
  await assert.rejects(auth.authenticate({}), hasCode('not_configured'));
  assert.equal(used, false);
});

test('uses Google sub as the account ID, and never trusts an arbitrary avatar URL', async () => {
  const { result } = await fixture().signIn(STATIC, { picture: 'https://attacker.example/track' });
  assert.equal(result.body.user.id, 'google:google-user-01');
  assert.equal(result.body.user.email, 'person@example.com');
  assert.equal(result.body.user.picture, null);
  assert.equal(result.cookie, null);
});

test('checks audience, issuer, expiry, future issuance, subject and nonce after SDK verification', async () => {
  for (const [overrides, code] of [
    [{ aud: 'another-client.apps.googleusercontent.com' }, 'invalid_audience'],
    [{ aud: [CLIENT_ID, 'other'], azp: 'other' }, 'invalid_audience'],
    [{ iss: 'https://attacker.example' }, 'invalid_issuer'],
    [{ exp: TIME / 1000 }, 'credential_expired'],
    [{ iat: TIME / 1000 + 120 }, 'invalid_issued_at'],
    [{ sub: '' }, 'invalid_subject'],
    [{ nonce: 'unrelated' }, 'invalid_nonce'],
  ]) {
    await assert.rejects(fixture().signIn(STATIC, overrides), hasCode(code));
  }
});

test('a nonce is bound to origin, expires, and cannot be exchanged twice or in parallel', async () => {
  const f = fixture();
  let challenge = f.auth.challenge(STATIC);
  f.setClaims({ aud: CLIENT_ID, iss: 'accounts.google.com', exp: TIME / 1000 + 3600, sub: 'a', nonce: challenge.nonce });
  await assert.rejects(f.auth.exchange({ credential: 'token', challengeId: challenge.challengeId }, SERVER), hasCode('invalid_challenge'));
  const attempts = await Promise.allSettled([
    f.auth.exchange({ credential: 'token', challengeId: challenge.challengeId }, STATIC),
    f.auth.exchange({ credential: 'token', challengeId: challenge.challengeId }, STATIC),
  ]);
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(r => r.status === 'rejected' && r.reason.code === 'invalid_challenge').length, 1);
  challenge = f.auth.challenge(STATIC);
  f.advance(5 * 60_000);
  await assert.rejects(f.auth.exchange({ credential: 'token', challengeId: challenge.challengeId }, STATIC), hasCode('invalid_challenge'));
});

test('does not accept an ID token bearer until the login challenge was exchanged', async () => {
  const f = fixture();
  await assert.rejects(f.auth.authenticate({ authorization: 'Bearer signed.google.token', origin: STATIC }), hasCode('unauthenticated'));
  const { credential } = await f.signIn();
  assert.equal((await f.auth.authenticate({ authorization: `Bearer ${credential}`, origin: STATIC })).user.sub, 'google-user-01');
  assert.ok(f.verificationCalls >= 2, 'SDK verification runs again when an ID token authenticates an API call');
  await assert.rejects(f.auth.authenticate({ authorization: `Bearer ${credential}`, origin: SERVER }), hasCode('unauthenticated'));
  await assert.rejects(f.auth.authenticate({ authorization: `Bearer ${credential}` }), hasCode('origin_required'));
  f.advance(15 * 60_000);
  await assert.rejects(f.auth.authenticate({ authorization: `Bearer ${credential}`, origin: STATIC }), hasCode('unauthenticated'));
});

test('same-origin login creates an opaque secure HttpOnly Lax cookie and caps its lifetime', async () => {
  const f = fixture();
  const { result } = await f.signIn(SERVER, { exp: TIME / 1000 + 180 });
  assert.match(result.cookie, /^__Host-central_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=180$/);
  assert.doesNotMatch(result.cookie, /signed\.google\.token|google-user-01/);
  const cookie = result.cookie.split(';')[0];
  const user = await f.auth.authenticate({ cookie });
  assert.equal(user.authenticated, true);
  await assert.rejects(f.auth.authenticate({ cookie, origin: STATIC }), hasCode('unauthenticated'));
  f.advance(180_000);
  await assert.rejects(f.auth.authenticate({ cookie, origin: SERVER }), hasCode('unauthenticated'));
});

test('logout revokes the associated cookie and bearer grant without revoking another browser origin', async () => {
  const f = fixture();
  const { result, credential } = await f.signIn(SERVER);
  const cookie = result.cookie.split(';')[0];
  const clear = f.auth.logout({ cookie, origin: SERVER });
  assert.match(clear.cookie, /Max-Age=0/);
  await assert.rejects(f.auth.authenticate({ cookie, origin: SERVER }), hasCode('unauthenticated'));
  await assert.rejects(f.auth.authenticate({ authorization: `Bearer ${credential}`, origin: SERVER }), hasCode('unauthenticated'));
  const cross = await f.signIn(STATIC);
  assert.equal(f.auth.logout({ authorization: `Bearer ${cross.credential}`, origin: SERVER }).cookie.includes('Max-Age=0'), true);
  assert.equal((await f.auth.authenticate({ authorization: `Bearer ${cross.credential}`, origin: STATIC })).authenticated, true);
  f.auth.logout({ authorization: `Bearer ${cross.credential}`, origin: STATIC });
  await assert.rejects(f.auth.authenticate({ authorization: `Bearer ${cross.credential}`, origin: STATIC }), hasCode('unauthenticated'));
});

test('fails closed on SDK errors, rejects untrusted origins, and bounds unauthenticated state', async () => {
  const f = fixture({ maxEntries: 2 });
  await assert.rejects(f.signIn(STATIC, {}, 'invalid-signature'), error => hasCode('invalid_credential')(error) && !error.message.includes('internals'));
  assert.throws(() => f.auth.challenge('https://attacker.example'), hasCode('origin_not_allowed'));
  assert.throws(() => f.auth.challenge(), hasCode('origin_required'));
  f.auth.challenge(STATIC); f.auth.challenge(SERVER);
  assert.throws(() => f.auth.challenge(STATIC), hasCode('auth_capacity'));
  f.advance(5 * 60_000);
  assert.ok(f.auth.challenge(STATIC).nonce);
});

test('origin configuration rejects paths, wildcard origins, and insecure public cookies', () => {
  assert.equal(normalizeOrigin('https://fenglingai-max.github.io'), STATIC);
  assert.equal(normalizeOrigin('https://fenglingai-max.github.io/central-ai/'), null);
  assert.equal(normalizeOrigin('http://not-local.example'), null);
  assert.equal(normalizeOrigin('*'), null);
  assert.throws(() => createAuthService({ publicOrigin: SERVER, secureCookies: false }));
  assert.doesNotThrow(() => createAuthService({ publicOrigin: 'http://localhost:3000', secureCookies: false }));
});
