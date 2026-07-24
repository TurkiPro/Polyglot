/**
 * Application state: the one place that owns the database handle, the deck and the
 * in-memory card states.
 *
 * Views read from here and call its methods; they never touch `db.js` directly. Reviews
 * go through `applyEvent`, the same function `rebuildFromEvents` folds, so the live
 * session and a replay can never disagree (§8).
 */
import { config } from '../../config/app.config.js';
import * as db from './engine/db.js';
import { createDeck, loadPack } from './engine/deck.js';
import { createEvent, mergeEvents, toWire } from './engine/events.js';
import { computeGamify } from './engine/gamify.js';
import { buildQueue } from './engine/queue.js';
import { applyEvent, localDayKey, rebuildFromEvents, stateHash } from './engine/replay.js';

const LANG = config.pack.langPackV1;
const SETTINGS_KEY = 'settings';
const GAMIFY_KEY = 'gamifyCache';
const CURSOR_KEY = 'syncCursor';
const WORD_CURSOR_KEY = 'syncWordCursor';
const LAST_SYNC_KEY = 'lastSyncAt';
const PRIORITIES_KEY = 'studyNext';

/** Settings a user can change; defaults come from config (§0). */
export const DEFAULT_SETTINGS = Object.freeze({
  newPerDay: config.study.newCardsPerDay,
  maxPerDay: config.study.maxReviewsPerDay,
  theme: 'light',
  /** Chosen zh voice, by voiceURI; null lets tts pick (§3.4.4). */
  voiceUri: null,
  audioBannerDismissed: false,
});

export const store = {
  db: null,
  deck: null,
  pack: null,
  /** @type {Map<string, object>} */
  states: new Map(),
  /** @type {object[]} */
  events: [],
  settings: { ...DEFAULT_SETTINGS },
  /** Derived from the log by engine/gamify.js; the meta row is only a cache (§10). */
  gamify: null,
  /** Set once /api/me answers; null means guest (§1.3). */
  account: null,
  lastSyncAt: null,
  /** wordId → when "Study next" was pressed (§3.4.1). Local intent, not synced. */
  priorities: new Map(),
  listeners: new Set(),
};

/** Subscribe to state changes; returns an unsubscribe function. */
export function subscribe(fn) {
  store.listeners.add(fn);
  return () => store.listeners.delete(fn);
}

function notify() {
  for (const fn of store.listeners) fn(store);
}

/** Open storage, load the pack, replay the log. Safe to call once at boot. */
export async function init() {
  store.db = await db.openDb();
  store.settings = { ...DEFAULT_SETTINGS, ...(await db.getMeta(store.db, SETTINGS_KEY, {})) };

  const [pack, customWords, events] = await Promise.all([
    loadPack(LANG),
    db.getAll(store.db, db.STORES.customWords),
    db.getAll(store.db, db.STORES.events),
  ]);

  store.pack = pack;
  store.deck = createDeck(pack, customWords);
  store.events = events;
  store.states = rebuildFromEvents(store.deck, events).states;
  store.lastSyncAt = await db.getMeta(store.db, LAST_SYNC_KEY, null);
  store.priorities = new Map(Object.entries(await db.getMeta(store.db, PRIORITIES_KEY, {})));
  await refreshGamify();

  notify();
  return store;
}

/**
 * Recompute XP, level, streak and badges from the log, and cache the result.
 *
 * The cache exists so Home can paint without a full pass on every render; it is never the
 * source. Anything that changes the log or the deck calls this, which is why importing a
 * file or syncing a device cannot leave XP disagreeing with history (§10).
 */
export async function refreshGamify(now = Date.now()) {
  if (!store.deck) return null;
  store.gamify = computeGamify(store.deck, store.events, store.states, now);
  if (store.db) await db.setMeta(store.db, GAMIFY_KEY, store.gamify);
  return store.gamify;
}

/** Today's queue, honouring the user's own daily limits. */
export function queue(now = Date.now()) {
  return buildQueue(store.deck, store.states, {
    now,
    maxNew: store.settings.newPerDay,
    maxReviews: store.settings.maxPerDay,
    reviewsDoneToday: countReviewsToday(now),
    newDoneToday: countNewToday(now),
    priorities: store.priorities,
  });
}

/** Reviews already recorded during the current local day. */
export function countReviewsToday(now = Date.now()) {
  const today = localDayKey(now);
  return store.events.filter((e) => localDayKey(e.ts) === today).length;
}

/** Words met for the first time during the current local day. */
export function countNewToday(now = Date.now()) {
  const today = localDayKey(now);
  const firstSeen = new Map();
  for (const event of store.events) {
    if (!firstSeen.has(event.cardId) || event.ts < firstSeen.get(event.cardId)) {
      firstSeen.set(event.cardId, event.ts);
    }
  }
  let count = 0;
  for (const [cardId, ts] of firstSeen) {
    if (cardId.endsWith('#REC') && localDayKey(ts) === today) count++;
  }
  return count;
}

/**
 * Record a review: append the event, apply it to live state, persist both.
 * The event is the durable fact; card state is derived and could be rebuilt from it.
 */
export async function recordReview({ cardId, rating, durMs, now = Date.now() }) {
  const event = createEvent({ cardId, rating, ts: now, durMs });
  applyEvent(store.deck, store.states, event);
  store.events.push(event);

  const touched = [...store.states.values()].filter((s) => s.wordId === wordIdOf(cardId));
  await db.tx(store.db, [db.STORES.events, db.STORES.cards], 'readwrite', (t) => {
    t.objectStore(db.STORES.events).put(event);
    const cards = t.objectStore(db.STORES.cards);
    for (const state of touched) cards.put(state);
  });

  await refreshGamify(now);
  notify();
  return event;
}

const wordIdOf = (cardId) => cardId.slice(0, cardId.lastIndexOf('#'));

/**
 * Move a curriculum word to the front of the new-card queue (§3.4.1).
 *
 * The same lane a word you added yourself uses — "Add" is refused for words already in
 * the curriculum, and being told no is not an answer to "I want to learn this now".
 * Local intent rather than synced data: which device you asked on is where it applies.
 */
export async function studyNext(wordId, now = Date.now()) {
  if (!store.deck?.has(wordId)) return false;
  store.priorities.set(wordId, now);
  await db.setMeta(store.db, PRIORITIES_KEY, Object.fromEntries(store.priorities));
  notify();
  return true;
}

/** Whether a word is already queued to lead. */
export const isPrioritized = (wordId) => store.priorities.has(wordId);

/** Undo a "Study next". */
export async function unstudyNext(wordId) {
  if (!store.priorities.delete(wordId)) return false;
  await db.setMeta(store.db, PRIORITIES_KEY, Object.fromEntries(store.priorities));
  notify();
  return true;
}

/** Add a word of the user's own, from Browse. */
export async function addCustomWord(word) {
  const record = { ...word, band: 0, custom: true, updatedAt: Date.now(), deleted: false };
  await db.put(store.db, db.STORES.customWords, record);
  await refreshDeck();
  return record;
}

/**
 * Remove a word of the user's own.
 *
 * The customWord becomes a tombstone rather than disappearing, so Phase 6 can propagate
 * the removal to other devices. Its cards go, but its events stay: the log is immutable
 * (§2), and `rebuildFromEvents` simply skips events whose word the deck no longer has.
 */
export async function removeCustomWord(wordId) {
  const existing = await db.getOne(store.db, db.STORES.customWords, wordId);
  if (!existing) return false;

  const doomed = [...store.states.keys()].filter((id) => wordIdOf(id) === wordId);
  await db.tx(store.db, [db.STORES.customWords, db.STORES.cards], 'readwrite', (t) => {
    t.objectStore(db.STORES.customWords).put({
      id: wordId,
      deleted: 1,
      updatedAt: Date.now(),
    });
    const cards = t.objectStore(db.STORES.cards);
    for (const cardId of doomed) cards.delete(cardId);
  });

  for (const cardId of doomed) store.states.delete(cardId);
  await refreshDeck();
  return true;
}

/** Rebuild the deck from the pack plus whatever custom words storage now holds. */
async function refreshDeck() {
  store.deck = createDeck(store.pack, await db.getAll(store.db, db.STORES.customWords));
  // Band totals move when the deck does, so the derived numbers move with it.
  await refreshGamify();
  notify();
  return store.deck;
}

/** Persist changed settings. */
export async function updateSettings(patch) {
  store.settings = { ...store.settings, ...patch };
  await db.setMeta(store.db, SETTINGS_KEY, store.settings);
  notify();
  return store.settings;
}

/** The export payload (§1.5) — guest mode included. */
export async function exportData() {
  const customWords = await db.getAll(store.db, db.STORES.customWords);
  return {
    app: config.identity.projectName,
    version: 1,
    exportedAt: new Date().toISOString(),
    language: LANG,
    packVersion: store.pack?.packVersion,
    settings: store.settings,
    events: store.events.map(toWire),
    customWords,
    stateHash: stateHash(store.states),
  };
}

/**
 * Import an export file. Events are merged by id — importing the same file twice is a
 * no-op, and importing another device's file is exactly the sync merge.
 * @returns {Promise<{ imported: number, total: number }>}
 */
export async function importData(payload) {
  if (!payload || !Array.isArray(payload.events)) throw new Error('not a polyglot export');

  const before = store.events.length;
  const merged = mergeEvents(store.events, payload.events);
  const customWords = payload.customWords ?? [];

  await db.tx(store.db, [db.STORES.events, db.STORES.customWords], 'readwrite', (t) => {
    const events = t.objectStore(db.STORES.events);
    for (const event of merged) events.put({ ...event, synced: event.synced ?? 0 });
    const words = t.objectStore(db.STORES.customWords);
    for (const word of customWords) words.put(word);
  });

  store.events = merged;
  store.deck = createDeck(store.pack, await db.getAll(store.db, db.STORES.customWords));
  store.states = rebuildFromEvents(store.deck, merged).states;
  await persistAllCards();
  await refreshGamify();

  notify();
  return { imported: merged.length - before, total: merged.length };
}

/** Write every card state, after a rebuild. */
export async function persistAllCards() {
  await db.putAll(store.db, db.STORES.cards, [...store.states.values()]);
}

/** Danger Zone: erase everything local (§9). */
export async function wipeLocal() {
  await db.clearStores(store.db, [
    db.STORES.cards,
    db.STORES.events,
    db.STORES.customWords,
    db.STORES.meta,
  ]);
  store.events = [];
  store.states = new Map();
  store.settings = { ...DEFAULT_SETTINGS };
  store.priorities = new Map();
  store.deck = createDeck(store.pack, []);
  store.gamify = null;
  await refreshGamify();
  notify();
}

/**
 * The storage half of sync (§12).
 *
 * Everything the sync client needs from this device, and nothing about the network. Kept
 * here rather than in `sync/client.js` so the client stays free of IndexedDB.
 */
export function syncPort() {
  return {
    unsyncedEvents: async () => {
      const rows = await db.getAllByIndex(store.db, db.STORES.events, 'synced', 0);
      return rows.map(toWire);
    },

    markSynced: async (ids) => {
      const known = new Set(ids);
      const rows = store.events.filter((event) => known.has(event.id));
      for (const row of rows) row.synced = 1;
      await db.putAll(store.db, db.STORES.events, rows);
    },

    /** Merge remote events in; returns how many were genuinely new. */
    addRemoteEvents: async (incoming) => {
      const known = new Set(store.events.map((event) => event.id));
      const fresh = incoming.filter((event) => !known.has(event.id));
      if (fresh.length === 0) return 0;

      // Anything that came back from the server is by definition already synced.
      const rows = fresh.map((event) => ({ ...event, synced: 1 }));
      await db.putAll(store.db, db.STORES.events, rows);
      store.events = mergeEvents(store.events, rows);
      return fresh.length;
    },

    cursor: () => db.getMeta(store.db, CURSOR_KEY, 0),
    setCursor: (value) => db.setMeta(store.db, CURSOR_KEY, value),
    wordCursor: () => db.getMeta(store.db, WORD_CURSOR_KEY, 0),
    setWordCursor: (value) => db.setMeta(store.db, WORD_CURSOR_KEY, value),

    localWords: () => db.getAll(store.db, db.STORES.customWords),

    /** Last write wins on updatedAt; a tombstone is just another write. */
    mergeWords: async (incoming) => {
      const mine = new Map(
        (await db.getAll(store.db, db.STORES.customWords)).map((word) => [word.id, word]),
      );
      const winners = incoming.filter(
        (word) => (word.updatedAt ?? 0) > (mine.get(word.id)?.updatedAt ?? -1),
      );
      if (winners.length === 0) return 0;
      await db.putAll(store.db, db.STORES.customWords, winners);
      return winners.length;
    },

    rebuild: async () => {
      store.deck = createDeck(store.pack, await db.getAll(store.db, db.STORES.customWords));
      store.states = rebuildFromEvents(store.deck, store.events).states;
      await persistAllCards();
      await refreshGamify();
      notify();
    },
  };
}

/** Record when a sync last completed, for the settings screen. */
export async function noteSync(at, account) {
  store.lastSyncAt = at;
  store.account = account ?? store.account;
  await db.setMeta(store.db, LAST_SYNC_KEY, at);
  notify();
}

/** Forget the signed-in account without touching local data (§12 sign out). */
export async function forgetAccount() {
  store.account = null;
  await db.setMeta(store.db, CURSOR_KEY, 0);
  await db.setMeta(store.db, WORD_CURSOR_KEY, 0);
  notify();
}

/** Fingerprint of current state, for the export→wipe→import check (§9). */
export const currentHash = () => stateHash(store.states);
