/**
 * Sync (§12).
 *
 * Push what this device has not sent, pull what it has not seen, rebuild. Because events
 * are immutable and keyed by a client-generated uuid, merging is a set union and there is
 * no conflict resolution to write (§2).
 *
 * Guest → account migration needs no special case: a guest's log is simply a log with
 * nothing marked synced, so the first sign-in pushes all of it through the same path.
 *
 * Both collaborators are injected — `local` for storage, `api` for the network — so the
 * whole orchestration is testable without IndexedDB or a server.
 */
import { config } from '../../../config/app.config.js';

const CHUNK = config.auth.syncBatchMax;

/** Split a list into batches the API will accept. */
export function chunk(items, size = CHUNK) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Run one sync.
 *
 * @param {object} local storage port
 * @param {object} api network port
 * @returns {Promise<{ ok: boolean, reason?: string, pushed: number, pulled: number,
 *                     wordsPushed: number, wordsPulled: number, at: number }>}
 */
export async function syncNow(local, api, now = Date.now()) {
  const idle = { pushed: 0, pulled: 0, wordsPushed: 0, wordsPulled: 0, at: now };

  const session = await api.me().catch(() => null);
  if (!session?.user) return { ok: false, reason: 'signed_out', ...idle };

  const result = { ok: true, ...idle };

  // ── events ────────────────────────────────────────────────
  // Push first: a device that has been offline should contribute before it consumes,
  // so a second device pulling straight after sees everything.
  const unsynced = await local.unsyncedEvents();
  for (const batch of chunk(unsynced)) {
    await api.pushEvents(batch);
    await local.markSynced(batch.map((event) => event.id));
    result.pushed += batch.length;
  }

  let cursor = await local.cursor();
  for (;;) {
    const page = await api.pullEvents(cursor);
    if (page.events.length) {
      // Already-known ids are dropped by the merge; this is the union, not an append.
      result.pulled += await local.addRemoteEvents(page.events);
    }
    cursor = page.cursor;
    await local.setCursor(cursor);
    if (!page.more) break;
  }

  // ── custom words ──────────────────────────────────────────
  const words = await local.localWords();
  for (const batch of chunk(words)) {
    await api.pushWords(batch);
    result.wordsPushed += batch.length;
  }

  let wordCursor = await local.wordCursor();
  for (;;) {
    const page = await api.pullWords(wordCursor);
    if (page.words.length) result.wordsPulled += await local.mergeWords(page.words);
    wordCursor = page.cursor;
    await local.setWordCursor(wordCursor);
    if (!page.more) break;
  }

  // One rebuild at the end: replaying per page would be wasted work.
  if (result.pulled > 0 || result.wordsPulled > 0) await local.rebuild();

  result.at = now;
  return result;
}

/** The HTTP port. Same origin throughout, so no CORS and no base URL (§2). */
export function httpApi(fetchImpl = fetch) {
  const send = async (path, options = {}) => {
    const res = await fetchImpl(path, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      ...options,
    });
    if (res.status === 401) throw new SyncError('signed_out', 401);
    if (!res.ok) throw new SyncError(`request failed: ${res.status}`, res.status);
    return res.json();
  };

  return {
    me: () => send('/api/me'),
    providers: () => send('/api/auth/providers'),
    startLogin: (provider, turnstileToken) =>
      send(`/api/auth/${provider}/start`, {
        method: 'POST',
        body: JSON.stringify({ turnstileToken }),
      }),
    logout: () => send('/api/auth/logout', { method: 'POST' }),
    deleteAccount: () => send('/api/me', { method: 'DELETE' }),
    pushEvents: (events) =>
      send('/api/sync/events', { method: 'POST', body: JSON.stringify({ events }) }),
    pullEvents: (since) => send(`/api/sync/events?since=${encodeURIComponent(since ?? 0)}`),
    pushWords: (words) =>
      send('/api/sync/words', { method: 'POST', body: JSON.stringify({ words }) }),
    pullWords: (since) => send(`/api/sync/words?since=${encodeURIComponent(since ?? 0)}`),
  };
}

export class SyncError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
