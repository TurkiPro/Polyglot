/**
 * Turnstile verification (§11) — login page only.
 *
 * Fails closed: with no secret configured, verification fails rather than passes, so a
 * misconfigured deploy cannot silently drop the check. DEV_MODE is the one exception,
 * because a local machine has no Turnstile widget to solve.
 */
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function verifyTurnstile(env, token, remoteIp, fetchImpl = fetch) {
  if (env.DEV_MODE === '1') return { ok: true, reason: 'dev' };
  if (!env.TURNSTILE_SECRET) return { ok: false, reason: 'not_configured' };
  if (!token) return { ok: false, reason: 'missing_token' };

  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET);
  body.append('response', token);
  if (remoteIp) body.append('remoteip', remoteIp);

  try {
    const res = await fetchImpl(VERIFY_URL, { method: 'POST', body });
    const result = await res.json();
    return result.success ? { ok: true } : { ok: false, reason: 'rejected' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}
