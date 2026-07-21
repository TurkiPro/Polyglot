/**
 * Review events — the atom of sync (§5.5).
 *
 * Events are immutable and append-only. Card state is a pure function of the log
 * (`replay.js`), which is why merging two devices is a set union and conflicts cannot
 * exist. Nothing here ever mutates or deletes an event.
 */

/** @typedef {{ id: string, cardId: string, rating: 1|2|3|4, ts: number, durMs?: number }} ReviewEvent */

/**
 * Build a review event. `synced` is storage bookkeeping, not part of the synced payload.
 * @returns {ReviewEvent & { synced: 0 }}
 */
export function createEvent({ cardId, rating, ts = Date.now(), durMs }) {
  if (!cardId) throw new Error('event: cardId is required');
  if (!Number.isInteger(rating) || rating < 1 || rating > 4) {
    throw new Error(`event: rating must be 1-4, got ${rating}`);
  }
  const event = { id: crypto.randomUUID(), cardId, rating, ts, synced: 0 };
  if (durMs !== undefined) event.durMs = Math.max(0, Math.round(durMs));
  return event;
}

/** The wire shape: bookkeeping stripped, exactly the §5.5 fields. */
export function toWire({ id, cardId, rating, ts, durMs }) {
  const event = { id, cardId, rating, ts };
  if (durMs !== undefined) event.durMs = durMs;
  return event;
}

/**
 * Deterministic order for replay: by timestamp, ties broken by id (§8).
 * Returns a new array; the input is never reordered in place.
 */
export function sortEvents(events) {
  return [...events].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Union two event logs by id. This is the whole of sync merging: an event id is
 * globally unique, so the same event from two devices is one event.
 */
export function mergeEvents(...logs) {
  const byId = new Map();
  for (const log of logs) {
    for (const event of log ?? []) if (!byId.has(event.id)) byId.set(event.id, event);
  }
  return sortEvents([...byId.values()]);
}
