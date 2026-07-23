/**
 * Sessions (§11).
 *
 * The cookie carries a random token; the database stores only its SHA-256. A dump of the
 * sessions table therefore cannot be replayed as a login. There is no password anywhere
 * in this system (§1.4).
 */
import { config } from '../../../config/app.config.js';

export const COOKIE_NAME = 'pg_session';
const TTL_MS = config.auth.sessionTtlDays * 86400000;
const TOKEN_BYTES = 32;

/** base64url, no padding — safe in a cookie without escaping. */
function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh session token. Never stored as-is. */
export function newToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/** SHA-256 of a token, hex — what the database actually holds. */
export async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Read one cookie from a request. */
export function readCookie(request, name = COOKIE_NAME) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/**
 * Build a Set-Cookie value.
 * `Secure` is omitted on http://localhost only, or a dev browser would drop the cookie.
 */
export function cookieHeader(token, { maxAge = TTL_MS / 1000, secure = true, name = COOKIE_NAME } = {}) {
  const parts = [
    `${name}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(maxAge)}`,
  ];
  if (secure) parts.splice(1, 0, 'Secure');
  return parts.join('; ');
}

/** The cookie that clears a session. */
export const clearCookieHeader = (options = {}) => cookieHeader('', { ...options, maxAge: 0 });

/** Whether a request arrived somewhere that allows a non-Secure cookie. */
export const isLocal = (request) => new URL(request.url).hostname === 'localhost' || new URL(request.url).hostname === '127.0.0.1';

/**
 * Create a session for a user.
 * @returns {Promise<{ token: string, expiresAt: number }>}
 */
export async function createSession(env, userId, now = Date.now()) {
  const token = newToken();
  const expiresAt = now + TTL_MS;
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(await hashToken(token), userId, now, expiresAt)
    .run();
  return { token, expiresAt };
}

/**
 * The user behind a request, or null.
 * An expired row is deleted on sight rather than left to rot.
 */
export async function currentUser(request, env, now = Date.now()) {
  const token = readCookie(request);
  if (!token) return null;

  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT s.user_id, s.expires_at, u.display_name, u.provider
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first();

  if (!row) return null;
  if (row.expires_at <= now) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }

  return {
    id: row.user_id,
    displayName: row.display_name,
    provider: row.provider,
    tokenHash,
  };
}

/** End one session. */
export async function destroySession(env, tokenHash) {
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

/**
 * Find or create the user behind a provider identity.
 * The id is derived from provider + provider id, so a repeat login is idempotent.
 */
export async function upsertUser(env, { provider, providerId, displayName }, now = Date.now()) {
  const id = `${provider}:${providerId}`;
  await env.DB.prepare(
    `INSERT INTO users (id, provider, provider_id, display_name, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (provider, provider_id) DO UPDATE SET display_name = excluded.display_name`,
  )
    .bind(id, provider, String(providerId), displayName ?? null, now)
    .run();

  return env.DB.prepare('SELECT id, provider, display_name FROM users WHERE provider = ? AND provider_id = ?')
    .bind(provider, String(providerId))
    .first();
}
