import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const MINUTE = 60_000;
const hash = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const equal = (left, right) => typeof left === 'string' && typeof right === 'string'
  && Buffer.byteLength(left) === Buffer.byteLength(right)
  && timingSafeEqual(Buffer.from(left), Buffer.from(right));

export class AuthError extends Error {
  constructor(code, message, status = 401) {
    super(message); this.name = 'AuthError'; this.code = code; this.status = status;
  }
}

export function normalizeOrigin(value) {
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return null;
    return url.origin;
  } catch { return null; }
}

/** The official Google library verifies the token signature using rotating Google keys. */
export function createGoogleVerifier(clientId) {
  let client;
  return async credential => {
    if (!client) {
      const { OAuth2Client } = await import('google-auth-library');
      client = new OAuth2Client(clientId);
    }
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    return ticket.getPayload();
  };
}

function userFromClaims(claims) {
  let picture = null;
  try {
    const url = new URL(claims.picture);
    if (url.protocol === 'https:' && !url.username && !url.password
      && (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com'))) picture = url.href;
  } catch { /* An avatar is optional; never return an arbitrary profile URL. */ }
  return {
    id: `google:${claims.sub}`, sub: claims.sub,
    name: typeof claims.name === 'string' ? claims.name.slice(0, 120) : 'Google 用户',
    email: typeof claims.email === 'string' ? claims.email.slice(0, 320) : null,
    picture,
  };
}

/**
 * Single-process authentication store. Deploy one process, or replace these maps
 * with a shared TTL store before running multiple instances. Raw ID tokens are
 * never retained; bearer grants contain only SHA-256 digests.
 */
export function createAuthService({
  googleClientId = '', publicOrigin = 'http://localhost:3000', allowedOrigins = [],
  secureCookies = true, verifyIdToken, now = Date.now,
  challengeTTL = 5 * MINUTE, sessionTTL = 60 * MINUTE, bearerTTL = 15 * MINUTE,
  maxEntries = 10_000,
} = {}) {
  const origin = normalizeOrigin(publicOrigin);
  if (!origin) throw new TypeError('CENTRAL_PUBLIC_ORIGIN 必须是 HTTPS 来源或本地回环来源，不得包含路径。');
  if (!secureCookies && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname))
    throw new TypeError('仅本地回环开发环境可以关闭 Secure Cookie。');
  const clientId = String(googleClientId).trim();
  if (clientId && !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId))
    throw new TypeError('GOOGLE_CLIENT_ID 不是有效的 Google Web OAuth 客户端 ID。');
  const origins = new Set([origin]);
  for (const item of allowedOrigins) {
    const normalized = normalizeOrigin(item);
    if (!normalized) throw new TypeError('CENTRAL_ALLOWED_ORIGINS 中的来源无效，不得包含通配符或路径。');
    origins.add(normalized);
  }
  const verify = verifyIdToken || createGoogleVerifier(clientId);
  const challenges = new Map(), sessions = new Map(), grants = new Map();
  const cookieName = secureCookies ? '__Host-central_session' : 'central_session_dev';
  const configured = Boolean(clientId);

  function requireConfigured() {
    if (!configured) throw new AuthError('not_configured', 'Google 登录尚未配置，请先设置 Google Web OAuth 客户端 ID。', 503);
  }
  function assertOrigin(requestOrigin, required = false) {
    if (!requestOrigin) {
      if (required) throw new AuthError('origin_required', '此操作需要有效的网页来源。', 403);
      return;
    }
    if (!origins.has(requestOrigin)) throw new AuthError('origin_not_allowed', '此网页来源未被允许访问登录服务。', 403);
  }
  function isSameOrigin(requestOrigin) { return requestOrigin === origin; }
  function prune() {
    const current = now();
    for (const map of [challenges, sessions, grants]) {
      for (const [key, record] of map) if (record.expiresAt <= current) map.delete(key);
    }
  }
  function capacity(map) {
    prune();
    if (map.size >= maxEntries) throw new AuthError('auth_capacity', '登录服务繁忙，请稍后重试。', 503);
  }
  function validateClaims(claims, expectedNonce) {
    if (!claims || typeof claims !== 'object') throw new AuthError('invalid_credential', 'Google 身份凭证无效。');
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audience.includes(clientId) || (claims.azp && claims.azp !== clientId)
      || (audience.length > 1 && claims.azp !== clientId))
      throw new AuthError('invalid_audience', '此 Google 凭证不是签发给 Central.ai 的。');
    if (!GOOGLE_ISSUERS.has(claims.iss)) throw new AuthError('invalid_issuer', 'Google 凭证签发方无效。');
    if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= now())
      throw new AuthError('credential_expired', 'Google 登录凭证已过期，请重新登录。');
    if (claims.iat !== undefined && (!Number.isFinite(claims.iat) || claims.iat * 1000 > now() + MINUTE))
      throw new AuthError('invalid_issued_at', 'Google 登录凭证时间无效。');
    if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255)
      throw new AuthError('invalid_subject', 'Google 用户标识无效。');
    if (expectedNonce !== undefined && !equal(claims.nonce, expectedNonce))
      throw new AuthError('invalid_nonce', '登录校验未通过，请重新开始 Google 登录。');
    return claims;
  }
  async function verified(credential) {
    if (typeof credential !== 'string' || !credential || credential.length > 16_384)
      throw new AuthError('invalid_credential', 'Google 身份凭证无效。');
    try { return await verify(credential); }
    catch { throw new AuthError('invalid_credential', 'Google 身份验证失败，请重新登录。'); }
  }
  function makeCookie(value, maxAge) {
    return `${cookieName}=${value}; Path=/; HttpOnly; ${secureCookies ? 'Secure; ' : ''}SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
  }
  function getCookie(header = '') {
    const entries = String(header).split(';');
    for (const entry of entries) {
      const index = entry.indexOf('=');
      if (entry.slice(0, index).trim() === cookieName) return entry.slice(index + 1).trim();
    }
    return null;
  }
  function bearerFromHeader(authorization) {
    if (!authorization) return null;
    const match = /^Bearer ([A-Za-z0-9_.-]+)$/i.exec(authorization);
    if (!match || match[1].length > 16_384) throw new AuthError('invalid_authorization', '身份验证请求头无效。');
    return match[1];
  }

  return {
    configured, publicOrigin: origin,
    config() {
      return {
        apiVersion: '1', google: { configured, clientId: configured ? clientId : '' },
        authentication: { mode: 'google', cookieSupported: true, bearerSupported: true },
        services: { creative: false, image: false, video: false },
      };
    },
    assertOrigin, isSameOrigin,
    challenge(requestOrigin) {
      requireConfigured(); assertOrigin(requestOrigin, true); capacity(challenges);
      const challengeId = token(), nonce = token(), expiresAt = now() + challengeTTL;
      challenges.set(challengeId, { nonce, origin: requestOrigin, expiresAt });
      return { challengeId, nonce, expiresAt };
    },
    async exchange({ credential, challengeId }, requestOrigin) {
      requireConfigured(); assertOrigin(requestOrigin, true); prune();
      const record = typeof challengeId === 'string' ? challenges.get(challengeId) : undefined;
      if (!record || record.expiresAt <= now() || record.origin !== requestOrigin)
        throw new AuthError('invalid_challenge', '登录请求已过期或已使用，请重新开始 Google 登录。');
      // Consume before awaiting the SDK so parallel requests cannot reuse a nonce.
      challenges.delete(challengeId);
      const claims = validateClaims(await verified(credential), record.nonce);
      const user = userFromClaims(claims);
      const expiresAt = Math.min(claims.exp * 1000, now() + bearerTTL);
      capacity(grants);
      const digest = hash(credential);
      grants.set(digest, { user, origin: requestOrigin, expiresAt, nonce: record.nonce });
      let cookie = null, sessionExpiresAt = expiresAt;
      if (isSameOrigin(requestOrigin)) {
        capacity(sessions);
        const sessionToken = token();
        sessionExpiresAt = Math.min(claims.exp * 1000, now() + sessionTTL);
        sessions.set(hash(sessionToken), { user, origin, expiresAt: sessionExpiresAt, grantDigest: digest });
        cookie = makeCookie(sessionToken, (sessionExpiresAt - now()) / 1000);
      }
      return {
        body: { user, expiresAt: sessionExpiresAt, bearerExpiresAt: expiresAt, authentication: 'google' },
        cookie,
      };
    },
    async authenticate({ authorization, cookie, origin: requestOrigin } = {}) {
      requireConfigured(); assertOrigin(requestOrigin); prune();
      const bearer = bearerFromHeader(authorization);
      if (bearer) {
        // Cross-origin browser sessions require the exact allowed Origin. An ID
        // token is usable only after this service consumed its login challenge.
        assertOrigin(requestOrigin, true);
        const grant = grants.get(hash(bearer));
        if (!grant || grant.origin !== requestOrigin || grant.expiresAt <= now())
          throw new AuthError('unauthenticated', '登录已失效，请重新登录。');
        const claims = validateClaims(await verified(bearer), grant.nonce);
        if (claims.sub !== grant.user.sub) throw new AuthError('unauthenticated', '登录状态无效。');
        return { authenticated: true, user: grant.user, expiresAt: grant.expiresAt };
      }
      // Cookies are accepted only by the same-origin deployment. Cross-origin
      // GitHub Pages callers use the in-memory bearer credential instead.
      if (requestOrigin && !isSameOrigin(requestOrigin))
        throw new AuthError('unauthenticated', '跨域登录需要重新通过 Google 验证。');
      const sessionToken = getCookie(cookie);
      const session = sessionToken && sessions.get(hash(sessionToken));
      if (!session || session.expiresAt <= now()) throw new AuthError('unauthenticated', '尚未登录或登录已过期。');
      return { authenticated: true, user: session.user, expiresAt: session.expiresAt };
    },
    logout({ authorization, cookie, origin: requestOrigin } = {}) {
      requireConfigured(); assertOrigin(requestOrigin, true); prune();
      const bearer = bearerFromHeader(authorization);
      if (bearer) {
        const digest = hash(bearer), grant = grants.get(digest);
        if (grant?.origin === requestOrigin) {
          grants.delete(digest);
          for (const [key, session] of sessions) if (session.grantDigest === digest) sessions.delete(key);
        }
      }
      if (!isSameOrigin(requestOrigin)) return { cookie: null };
      const sessionToken = getCookie(cookie), session = sessionToken && sessions.get(hash(sessionToken));
      if (session) {
        sessions.delete(hash(sessionToken));
        grants.delete(session.grantDigest);
      }
      return { cookie: makeCookie('', 0) };
    },
  };
}
