/**
 * Fixed-window rate limiting (§11), counted in D1.
 *
 * A fixed window can let through up to 2× the limit across a boundary. That is fine here:
 * this exists to stop abuse and runaway clients, not to meter a paid API, and a fixed
 * window costs one row and one statement instead of a sorted set.
 */
import { config } from '../../../config/app.config.js';

const { rateLimitAuth, rateLimitApi } = config.auth;

/** Rules by scope. */
export const LIMITS = Object.freeze({
  auth: { requests: rateLimitAuth.requests, windowMs: rateLimitAuth.windowMinutes * 60000 },
  api: { requests: rateLimitApi.requests, windowMs: rateLimitApi.windowMinutes * 60000 },
});

/**
 * The caller's IP. On Cloudflare, `cf-connecting-ip` is set by the edge and cannot be
 * forged by the client; `x-forwarded-for` can be, so it is deliberately not consulted —
 * a spoofable limiter key is a limiter bypass. Absent header means local dev.
 */
export const clientIp = (request) => request.headers.get('cf-connecting-ip') ?? 'local';

/**
 * Count one request against a scope.
 * @returns {Promise<{ ok: boolean, remaining: number, retryAfter: number }>}
 */
export async function rateLimit(env, scope, identifier, now = Date.now()) {
  const rule = LIMITS[scope];
  if (!rule) throw new Error(`unknown rate-limit scope: ${scope}`);

  const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
  const key = `${scope}:${identifier}:${windowStart}`;

  // One statement: insert the first hit, or bump an existing one.
  await env.DB.prepare(
    `INSERT INTO rate_limits (k, count, window_start) VALUES (?, 1, ?)
     ON CONFLICT (k) DO UPDATE SET count = count + 1`,
  )
    .bind(key, windowStart)
    .run();

  const row = await env.DB.prepare('SELECT count FROM rate_limits WHERE k = ?').bind(key).first();
  const count = row?.count ?? 1;

  // Opportunistic cleanup: cheap, and keeps the table from growing without bound.
  if (count === 1 && Math.random() < 0.02) {
    await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?')
      .bind(now - Math.max(LIMITS.auth.windowMs, LIMITS.api.windowMs) * 2)
      .run();
  }

  return {
    ok: count <= rule.requests,
    remaining: Math.max(0, rule.requests - count),
    retryAfter: Math.ceil((windowStart + rule.windowMs - now) / 1000),
  };
}
