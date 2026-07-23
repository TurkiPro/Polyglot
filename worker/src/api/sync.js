/**
 * Sync (§11): an append-only event log and a last-write-wins word list.
 *
 * The server never computes SRS state — it stores facts and hands them back in order.
 * Because events are immutable and identified by a client-generated uuid, pushing the
 * same batch twice is a no-op and merging two devices is a set union (§2).
 */
import { config } from '../../../config/app.config.js';

const BATCH_MAX = config.auth.syncBatchMax;

/**
 * The sync cursor is `received_at`, assigned here and strictly increasing per user.
 *
 * Client clocks are untrusted, so `ts` cannot order anything. Two batches inside the same
 * millisecond would collide, and a device that had already read that millisecond would
 * never see the second batch — hence "always greater than the previous maximum".
 */
async function nextReceivedAt(env, userId, now) {
  const row = await env.DB.prepare(
    'SELECT MAX(received_at) AS max_received FROM review_events WHERE user_id = ?',
  )
    .bind(userId)
    .first();
  const previous = row?.max_received ?? 0;
  return Math.max(now, previous + 1);
}

// Validation invariants, not tunables: a uuid is 36 chars and the longest legitimate
// card id (word id + '#WRITE') is well under 120. Anything larger is storage abuse.
const MAX_ID_LENGTH = 64;
const MAX_CARD_ID_LENGTH = 120;
const MAX_DUR_MS = 3_600_000; // one hour of staring at one card
const MAX_CLOCK_SKEW_MS = 7 * 86_400_000; // a week of client clock error

/** A review event the client is allowed to store. Exported for the unit suite. */
export function validEvent(event, now = Date.now()) {
  return Boolean(
    event &&
    typeof event.id === 'string' &&
    event.id.length > 0 &&
    event.id.length <= MAX_ID_LENGTH &&
    typeof event.cardId === 'string' &&
    event.cardId.length > 0 &&
    event.cardId.length <= MAX_CARD_ID_LENGTH &&
    Number.isInteger(event.rating) &&
    event.rating >= 1 &&
    event.rating <= 4 &&
    Number.isFinite(event.ts) &&
    event.ts > 0 &&
    event.ts <= now + MAX_CLOCK_SKEW_MS &&
    (event.durMs === undefined || event.durMs === null ||
      (Number.isInteger(event.durMs) && event.durMs >= 0 && event.durMs <= MAX_DUR_MS))
  );
}

/**
 * POST /api/sync/events — store a batch, ignoring anything already held.
 * @returns {Promise<{ cursor: number, stored: number, rejected: number }>}
 */
export async function pushEvents(env, userId, events, now = Date.now()) {
  if (!Array.isArray(events)) throw new HttpError(400, 'events must be an array');
  if (events.length > BATCH_MAX) throw new HttpError(413, `batch exceeds ${BATCH_MAX}`);

  const valid = events.filter((event) => validEvent(event, now));
  const rejected = events.length - valid.length;
  if (valid.length === 0) {
    const row = await env.DB.prepare(
      'SELECT MAX(received_at) AS max_received FROM review_events WHERE user_id = ?',
    )
      .bind(userId)
      .first();
    return { cursor: row?.max_received ?? 0, stored: 0, rejected };
  }

  const base = await nextReceivedAt(env, userId, now);
  const statement = env.DB.prepare(
    `INSERT OR IGNORE INTO review_events (id, user_id, card_id, rating, ts, dur_ms, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  // One received_at per row, so the cursor can never skip an event.
  const batch = valid.map((event, index) =>
    statement.bind(
      event.id,
      userId,
      event.cardId,
      event.rating,
      Math.trunc(event.ts),
      event.durMs === undefined || event.durMs === null ? null : Math.trunc(event.durMs),
      base + index,
    ),
  );

  await env.DB.batch(batch);

  const row = await env.DB.prepare(
    'SELECT MAX(received_at) AS max_received FROM review_events WHERE user_id = ?',
  )
    .bind(userId)
    .first();

  return { cursor: row?.max_received ?? base, stored: valid.length, rejected };
}

/** GET /api/sync/events?since= — everything after a cursor, oldest first. */
export async function pullEvents(env, userId, since = 0) {
  const cursor = Number.isFinite(Number(since)) ? Number(since) : 0;

  const { results } = await env.DB.prepare(
    `SELECT id, card_id, rating, ts, dur_ms, received_at
       FROM review_events
      WHERE user_id = ? AND received_at > ?
      ORDER BY received_at ASC
      LIMIT ?`,
  )
    .bind(userId, cursor, BATCH_MAX + 1)
    .all();

  const rows = results ?? [];
  const more = rows.length > BATCH_MAX;
  const page = more ? rows.slice(0, BATCH_MAX) : rows;

  const events = page.map((row) => {
    const event = { id: row.id, cardId: row.card_id, rating: row.rating, ts: row.ts };
    if (row.dur_ms !== null && row.dur_ms !== undefined) event.durMs = row.dur_ms;
    return event;
  });

  return {
    events,
    cursor: page.length ? page.at(-1).received_at : cursor,
    more,
  };
}

/**
 * POST /api/sync/words — last write wins on `updatedAt`.
 * A tombstone is just a word with `deleted: 1`, so removals propagate like any edit.
 */
export async function pushWords(env, userId, words) {
  if (!Array.isArray(words)) throw new HttpError(400, 'words must be an array');
  if (words.length > BATCH_MAX) throw new HttpError(413, `batch exceeds ${BATCH_MAX}`);

  const valid = words.filter((word) => word && typeof word.id === 'string' && word.id.length > 0);
  if (valid.length === 0) return { stored: 0, cursor: await wordCursor(env, userId) };

  const statement = env.DB.prepare(
    `INSERT INTO custom_words (id, user_id, payload, updated_at, deleted)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, id) DO UPDATE SET
       payload = excluded.payload,
       updated_at = excluded.updated_at,
       deleted = excluded.deleted
     WHERE excluded.updated_at > custom_words.updated_at`,
  );

  await env.DB.batch(
    valid.map((word) =>
      statement.bind(
        word.id,
        userId,
        JSON.stringify(word),
        Math.trunc(word.updatedAt ?? 0),
        word.deleted ? 1 : 0,
      ),
    ),
  );

  return { stored: valid.length, cursor: await wordCursor(env, userId) };
}

/** GET /api/sync/words?since= — the same cursor pattern, on `updated_at`. */
export async function pullWords(env, userId, since = 0) {
  const cursor = Number.isFinite(Number(since)) ? Number(since) : 0;

  const { results } = await env.DB.prepare(
    `SELECT payload, updated_at, deleted
       FROM custom_words
      WHERE user_id = ? AND updated_at > ?
      ORDER BY updated_at ASC
      LIMIT ?`,
  )
    .bind(userId, cursor, BATCH_MAX + 1)
    .all();

  const rows = results ?? [];
  const more = rows.length > BATCH_MAX;
  const page = more ? rows.slice(0, BATCH_MAX) : rows;

  const words = page.map((row) => ({
    ...JSON.parse(row.payload),
    updatedAt: row.updated_at,
    deleted: row.deleted === 1,
  }));

  return { words, cursor: page.length ? page.at(-1).updated_at : cursor, more };
}

async function wordCursor(env, userId) {
  const row = await env.DB.prepare(
    'SELECT MAX(updated_at) AS max_updated FROM custom_words WHERE user_id = ?',
  )
    .bind(userId)
    .first();
  return row?.max_updated ?? 0;
}

/** An error carrying the status it should become. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
