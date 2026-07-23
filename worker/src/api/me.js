/**
 * Account endpoints (§11): who am I, and delete everything.
 */
import { destroySession } from '../auth/sessions.js';

/** GET /api/me — identity plus the sync cursor, so a client can resume in one call. */
export async function getMe(env, user) {
  const row = await env.DB.prepare(
    'SELECT MAX(received_at) AS max_received FROM review_events WHERE user_id = ?',
  )
    .bind(user.id)
    .first();

  return {
    user: { id: user.id, displayName: user.displayName, provider: user.provider },
    cursor: row?.max_received ?? 0,
  };
}

/**
 * DELETE /api/me — remove the account and everything attached to it (§1.5).
 *
 * The child rows are deleted explicitly: D1 does not enforce ON DELETE CASCADE unless
 * foreign keys are switched on, and leaving a user's history behind would break the
 * promise outright.
 */
export async function deleteMe(env, user) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM review_events WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM custom_words WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  return { deleted: true };
}

/** POST /api/auth/logout — end this session only, leaving the account alone. */
export async function logout(env, user) {
  await destroySession(env, user.tokenHash);
  return { ok: true };
}
