/**
 * db.js against a real IndexedDB implementation.
 *
 * `fake-indexeddb` is a dev-only dependency, approved by the human per §4.3. It never
 * ships: the runtime dependency list is unchanged. This module holds every user's entire
 * review history, so a manual checklist was thinner coverage than it deserves.
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DB_NAME,
  DB_VERSION,
  STORES,
  clearStores,
  getAll,
  getAllByIndex,
  getMeta,
  getOne,
  openDb,
  put,
  putAll,
  remove,
  setMeta,
  tx,
} from '../app/src/engine/db.js';
import { createDeck } from '../app/src/engine/deck.js';
import { rebuildFromEvents, stateHash } from '../app/src/engine/replay.js';

/** A fresh, isolated IndexedDB per test — no state leaks between cases. */
let indexedDB;
let db;

beforeEach(async () => {
  indexedDB = new IDBFactory();
  db = await openDb(indexedDB);
});

const event = (id, ts, synced = 0) => ({ id, cardId: 'a#REC', rating: 3, ts, synced });

describe('schema', () => {
  it('creates the five §5.6 stores at version 1', () => {
    expect(db.name).toBe(DB_NAME);
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(
      ['cards', 'customWords', 'dict', 'events', 'meta'].sort(),
    );
  });

  it('keys each store on the documented key path', () => {
    const transaction = db.transaction([...db.objectStoreNames], 'readonly');
    expect(transaction.objectStore(STORES.cards).keyPath).toBe('cardId');
    expect(transaction.objectStore(STORES.events).keyPath).toBe('id');
    expect(transaction.objectStore(STORES.customWords).keyPath).toBe('id');
    expect(transaction.objectStore(STORES.dict).keyPath).toBe('simp');
    expect(transaction.objectStore(STORES.meta).keyPath).toBe('k');
    expect([...transaction.objectStore(STORES.events).indexNames].sort()).toEqual(['synced', 'ts']);
  });

  it('reopens an existing database without clobbering its data', async () => {
    await put(db, STORES.cards, { cardId: 'a#REC', reps: 7 });
    db.close();

    const reopened = await openDb(indexedDB);
    expect(reopened.version).toBe(DB_VERSION);
    expect(await getOne(reopened, STORES.cards, 'a#REC')).toMatchObject({ reps: 7 });
  });

  it('refuses to open when IndexedDB is unavailable', () => {
    expect(() => openDb(undefined)).toThrow(/unavailable/);
  });
});

describe('reads and writes', () => {
  it('round-trips a record and overwrites by key', async () => {
    await put(db, STORES.cards, { cardId: 'a#REC', reps: 1, suspended: false });
    expect(await getOne(db, STORES.cards, 'a#REC')).toMatchObject({ reps: 1 });

    await put(db, STORES.cards, { cardId: 'a#REC', reps: 2, suspended: false });
    expect(await getOne(db, STORES.cards, 'a#REC')).toMatchObject({ reps: 2 });
    expect(await getAll(db, STORES.cards)).toHaveLength(1);
  });

  it('returns undefined for a missing key rather than throwing', async () => {
    expect(await getOne(db, STORES.cards, 'nope#REC')).toBeUndefined();
    expect(await getAll(db, STORES.events)).toEqual([]);
  });

  it('preserves Date objects, so ts-fsrs state survives storage verbatim', async () => {
    const due = new Date('2026-08-03T09:00:00.000Z');
    await put(db, STORES.cards, { cardId: 'a#REC', due, stability: 2.3065 });

    const read = await getOne(db, STORES.cards, 'a#REC');
    expect(read.due).toBeInstanceOf(Date);
    expect(read.due.getTime()).toBe(due.getTime());
    expect(read.stability).toBe(2.3065);
  });

  it('writes many records in one transaction', async () => {
    await putAll(db, STORES.events, [event('e1', 10), event('e2', 20), event('e3', 30)]);
    expect(await getAll(db, STORES.events)).toHaveLength(3);
  });

  it('deletes a record', async () => {
    await putAll(db, STORES.cards, [{ cardId: 'a#REC' }, { cardId: 'b#REC' }]);
    await remove(db, STORES.cards, 'a#REC');
    expect(await getOne(db, STORES.cards, 'a#REC')).toBeUndefined();
    expect(await getAll(db, STORES.cards)).toHaveLength(1);
  });
});

describe('index queries', () => {
  it('finds unsynced events — the sync push hot path', async () => {
    await putAll(db, STORES.events, [
      event('e1', 10, 0),
      event('e2', 20, 1),
      event('e3', 30, 0),
    ]);

    const unsynced = await getAllByIndex(db, STORES.events, 'synced', 0);
    expect(unsynced.map((e) => e.id).sort()).toEqual(['e1', 'e3']);
    expect(await getAllByIndex(db, STORES.events, 'synced', 1)).toHaveLength(1);
  });

  it('queries a ts range', async () => {
    await putAll(db, STORES.events, [event('e1', 10), event('e2', 20), event('e3', 30)]);
    const range = IDBKeyRange.bound(15, 30);
    expect((await getAllByIndex(db, STORES.events, 'ts', range)).map((e) => e.id)).toEqual([
      'e2',
      'e3',
    ]);
  });
});

describe('transactions', () => {
  it('commits only after every write in the transaction lands', async () => {
    await tx(db, [STORES.cards, STORES.meta], 'readwrite', (t) => {
      t.objectStore(STORES.cards).put({ cardId: 'a#REC', reps: 1 });
      t.objectStore(STORES.meta).put({ k: 'cursor', v: 42 });
    });
    expect(await getOne(db, STORES.cards, 'a#REC')).toBeDefined();
    expect(await getMeta(db, 'cursor')).toBe(42);
  });

  it('aborts the whole transaction when the body throws — no partial write', async () => {
    await expect(
      tx(db, [STORES.cards, STORES.meta], 'readwrite', (t) => {
        t.objectStore(STORES.cards).put({ cardId: 'a#REC', reps: 1 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // The earlier put in the same transaction must not have survived.
    expect(await getOne(db, STORES.cards, 'a#REC')).toBeUndefined();
  });

  it('rejects when a write is invalid, leaving the store untouched', async () => {
    // No key path value — IndexedDB rejects this record.
    await expect(put(db, STORES.cards, { notTheKey: 'x' })).rejects.toBeTruthy();
    expect(await getAll(db, STORES.cards)).toEqual([]);
  });
});

describe('meta helpers', () => {
  it('reads, writes and defaults', async () => {
    expect(await getMeta(db, 'cursor')).toBeUndefined();
    expect(await getMeta(db, 'cursor', 0)).toBe(0);

    await setMeta(db, 'cursor', 1721556000000);
    expect(await getMeta(db, 'cursor', 0)).toBe(1721556000000);

    // Falsy values must not fall back to the default.
    await setMeta(db, 'cursor', 0);
    expect(await getMeta(db, 'cursor', 99)).toBe(0);
  });

  it('stores structured values', async () => {
    await setMeta(db, 'settings', { theme: 'dark', newPerDay: 15 });
    expect(await getMeta(db, 'settings')).toEqual({ theme: 'dark', newPerDay: 15 });
  });
});

describe('engine state survives storage', () => {
  /**
   * The point of the module: real card state, written and read back, must replay to the
   * same fingerprint. This is the export→wipe→import path (§9) and the sync merge (§12).
   */
  const word = (id) => ({
    id,
    simp: id,
    pinyinNum: 'hao3',
    pinyin: 'hǎo',
    defs: ['good'],
    band: 1,
    sentences: [{ zh: '好。', pinyin: 'hǎo.', pinyinAuto: true, en: 'Good.', src: 'tatoeba#1' }],
  });

  it('round-trips replayed cards and events without drift', async () => {
    const deck = createDeck({ words: [word('a'), word('b')] });
    const log = [
      { id: 'e1', cardId: 'a#REC', rating: 3, ts: Date.UTC(2026, 6, 21, 9) },
      { id: 'e2', cardId: 'b#REC', rating: 1, ts: Date.UTC(2026, 6, 21, 10) },
      { id: 'e3', cardId: 'a#REC', rating: 4, ts: Date.UTC(2026, 6, 24, 9) },
    ];
    const { states } = rebuildFromEvents(deck, log);
    const before = stateHash(states);

    await putAll(db, STORES.cards, [...states.values()]);
    await putAll(db, STORES.events, log.map((e) => ({ ...e, synced: 0 })));

    // Read back exactly what a cold app start would.
    const storedCards = await getAll(db, STORES.cards);
    const restored = new Map(storedCards.map((c) => [c.cardId, c]));
    expect(stateHash(restored)).toBe(before);

    // And replaying the stored log from scratch must agree with the stored cards.
    const storedEvents = await getAll(db, STORES.events);
    expect(stateHash(rebuildFromEvents(deck, storedEvents).states)).toBe(before);
  });

  it('keeps due as a Date after storage, so scheduling comparisons still work', async () => {
    const deck = createDeck({ words: [word('a')] });
    const { states } = rebuildFromEvents(deck, [
      { id: 'e1', cardId: 'a#REC', rating: 3, ts: Date.UTC(2026, 6, 21, 9) },
    ]);
    await putAll(db, STORES.cards, [...states.values()]);

    const stored = await getOne(db, STORES.cards, 'a#REC');
    expect(stored.due).toBeInstanceOf(Date);
    expect(Number.isNaN(new Date(stored.due).getTime())).toBe(false);
  });
});

describe('danger zone', () => {
  it('clears the named stores and leaves the others alone', async () => {
    await putAll(db, STORES.cards, [{ cardId: 'a#REC' }]);
    await putAll(db, STORES.events, [event('e1', 10)]);
    await setMeta(db, 'cursor', 5);

    await clearStores(db, [STORES.cards, STORES.events]);

    expect(await getAll(db, STORES.cards)).toEqual([]);
    expect(await getAll(db, STORES.events)).toEqual([]);
    // meta was not named, so it survives.
    expect(await getMeta(db, 'cursor')).toBe(5);

    await clearStores(db, STORES.meta);
    expect(await getMeta(db, 'cursor')).toBeUndefined();
  });
});
