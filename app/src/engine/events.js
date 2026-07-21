/**
 * Review events — the atom of sync (§5.5).
 *
 * Events are immutable and append-only. Card state is a pure function of the log
 * (`replay.js`), which is why merging two devices is a set union and conflicts cannot
 * exist. Nothing here ever mutates or deletes an event.
 */

/** @typedef {{ id: string, cardId: string, rating: 1|2|3|4, ts: number, durMs?: number }} ReviewEvent */

/**
 * A v4 UUID (§5.5).
 *
 * `crypto.randomUUID` is only exposed in a secure context, so it is missing whenever the
 * app is served over plain HTTP from anything other than localhost — testing on a phone
 * against a dev machine's LAN address, for instance. `crypto.getRandomValues` carries no
 * such restriction, so we build the v4 ourselves when the shortcut is unavailable.
 */
export function uuidv4() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto?.getRandomValues !== 'function') {
    throw new Error('no secure random source available');
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Build a review event. `synced` is storage bookkeeping, not part of the synced payload.
 * @returns {ReviewEvent & { synced: 0 }}
 */
export function createEvent({ cardId, rating, ts = Date.now(), durMs }) {
  if (!cardId) throw new Error('event: cardId is required');
  if (!Number.isInteger(rating) || rating < 1 || rating > 4) {
    throw new Error(`event: rating must be 1-4, got ${rating}`);
  }
  const event = { id: uuidv4(), cardId, rating, ts, synced: 0 };
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
