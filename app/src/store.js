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
import { buildQueue } from './engine/queue.js';
import { applyEvent, localDayKey, rebuildFromEvents, stateHash } from './engine/replay.js';

const LANG = config.pack.langPackV1;
const SETTINGS_KEY = 'settings';

/** Settings a user can change; defaults come from config (§0). */
export const DEFAULT_SETTINGS = Object.freeze({
  newPerDay: config.study.newCardsPerDay,
  maxPerDay: config.study.maxReviewsPerDay,
  theme: 'dark',
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

  notify();
  return store;
}

/** Today's queue, honouring the user's own daily limits. */
export function queue(now = Date.now()) {
  return buildQueue(store.deck, store.states, {
    now,
    maxNew: store.settings.newPerDay,
    maxReviews: store.settings.maxPerDay,
    reviewsDoneToday: countReviewsToday(now),
    newDoneToday: countNewToday(now),
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

  notify();
  return event;
}

const wordIdOf = (cardId) => cardId.slice(0, cardId.lastIndexOf('#'));

/** Add a word of the user's own, from Browse. */
export async function addCustomWord(word) {
  const record = { ...word, band: 0, updatedAt: Date.now(), deleted: false };
  await db.put(store.db, db.STORES.customWords, record);
  const customWords = await db.getAll(store.db, db.STORES.customWords);
  store.deck = createDeck(store.pack, customWords);
  notify();
  return record;
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
  store.deck = createDeck(store.pack, []);
  notify();
}

/** Fingerprint of current state, for the export→wipe→import check (§9). */
export const currentHash = () => stateHash(store.states);
