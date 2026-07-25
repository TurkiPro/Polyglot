/**
 * Practice sync (Phase 9 §2): the course's exercise-result stream.
 *
 * Mirrors the review-event endpoints exactly — append-only, uuid-identified, idempotent,
 * `received_at` cursor — but over its own table. It is a separate stream on purpose: these
 * results feed XP and mastery, never FSRS (§2). The server, as ever, only stores facts.
 */
import { config } from '../../../config/app.config.js';
import { HttpError } from './sync.js';

const BATCH_MAX = config.auth.syncBatchMax;

const MAX_ID_LENGTH = 64;
const MAX_UNIT_ID_LENGTH = 16;
const MAX_TYPE_LENGTH = 24;
const MAX_WORD_ID_LENGTH = 120;
const MAX_CLOCK_SKEW_MS = 7 * 86_400_000;

/** A practice event the client is allowed to store. Exported for the unit suite. */
export function validPractice(event, now = Date.now()) {
  return Boolean(
    event &&
    typeof event.id === 'string' && event.id.length > 0 && event.id.length <= MAX_ID_LENGTH &&
    typeof event.unitId === 'string' && event.unitId.length > 0 && event.unitId.length <= MAX_UNIT_ID_LENGTH &&
    typeof event.type === 'string' && event.type.length > 0 && event.type.length <= MAX_TYPE_LENGTH &&
    typeof event.wordId === 'string' && event.wordId.length > 0 && event.wordId.length <= MAX_WORD_ID_LENGTH &&
    (event.correct === 0 || event.correct === 1 || event.correct === true || event.correct === false) &&
    Number.isFinite(event.ts) && event.ts > 0 && event.ts <= now + MAX_CLOCK_SKEW_MS,
  );
}

async function maxReceived(env, userId) {
  const row = await env.DB.prepare(
    'SELECT MAX(received_at) AS max_received FROM practice_events WHERE user_id = ?',
  )
    .bind(userId)
    .first();
  return row?.max_received ?? 0;
}

/** POST /api/sync/practice — store a batch, ignoring anything already held. */
export async function pushPractice(env, userId, events, now = Date.now()) {
  if (!Array.isArray(events)) throw new HttpError(400, 'events must be an array');
  if (events.length > BATCH_MAX) throw new HttpError(413, `batch exceeds ${BATCH_MAX}`);

  const valid = events.filter((event) => validPractice(event, now));
  const rejected = events.length - valid.length;
  if (valid.length === 0) return { cursor: await maxReceived(env, userId), stored: 0, rejected };

  const previous = await maxReceived(env, userId);
  const base = Math.max(now, previous + 1);
  const statement = env.DB.prepare(
    `INSERT OR IGNORE INTO practice_events (id, user_id, unit_id, type, word_id, correct, ts, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const batch = valid.map((event, index) =>
    statement.bind(
      event.id,
      userId,
      event.unitId,
      event.type,
      event.wordId,
      event.correct ? 1 : 0,
      Math.trunc(event.ts),
      base + index,
    ),
  );
  await env.DB.batch(batch);

  return { cursor: await maxReceived(env, userId), stored: valid.length, rejected };
}

/** GET /api/sync/practice?since= — everything after a cursor, oldest first. */
export async function pullPractice(env, userId, since = 0) {
  const cursor = Number.isFinite(Number(since)) ? Number(since) : 0;

  const { results } = await env.DB.prepare(
    `SELECT id, unit_id, type, word_id, correct, ts, received_at
       FROM practice_events
      WHERE user_id = ? AND received_at > ?
      ORDER BY received_at ASC
      LIMIT ?`,
  )
    .bind(userId, cursor, BATCH_MAX + 1)
    .all();

  const rows = results ?? [];
  const more = rows.length > BATCH_MAX;
  const page = more ? rows.slice(0, BATCH_MAX) : rows;

  const events = page.map((row) => ({
    id: row.id,
    unitId: row.unit_id,
    type: row.type,
    wordId: row.word_id,
    correct: row.correct,
    ts: row.ts,
  }));

  return { events, cursor: page.length ? page.at(-1).received_at : cursor, more };
}
