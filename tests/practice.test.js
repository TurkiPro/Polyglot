/**
 * Practice stream + the scheduler firewall (Phase 9 §2).
 *
 * The binding property: a practice event feeds XP, mastery and adaptivity but NEVER FSRS.
 * Proven two ways — structurally (replay skips an event with no card id) and through a full
 * sync round-trip (practice syncs between devices while card state stays byte-identical).
 */
import { describe, expect, it } from 'vitest';
import { createDeck } from '../app/src/engine/deck.js';
import { rebuildFromEvents, stateHash } from '../app/src/engine/replay.js';
import {
  createPracticeEvent,
  rebuildPractice,
  toWirePractice,
  weakestFirst,
} from '../app/src/engine/practice.js';
import { validPractice } from '../worker/src/api/practice.js';
import { chunk, syncNow } from '../app/src/sync/client.js';

const word = (id) => ({ id, simp: id, pinyin: 'yī', pinyinNum: 'yi1', defs: ['one'], band: 1, sentences: [] });
const pe = (over) => ({ id: 'p1', unitId: 'u001', type: 'MCQ_MEANING', wordId: 'zh:a:a1', correct: 1, ts: 2000, ...over });

/* ── Event shape and validation ─────────────────────────── */

describe('practice events (§9.2)', () => {
  it('creates a normalized event and strips bookkeeping for the wire', () => {
    const event = createPracticeEvent({ unitId: 'u007', type: 'CLOZE', wordId: 'zh:马:ma3', correct: true, ts: 5 });
    expect(event).toMatchObject({ unitId: 'u007', type: 'CLOZE', wordId: 'zh:马:ma3', correct: 1, ts: 5, synced: 0 });
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(toWirePractice(event)).toEqual({ id: event.id, unitId: 'u007', type: 'CLOZE', wordId: 'zh:马:ma3', correct: 1, ts: 5 });
  });

  it('validates the wire shape the way the worker does', () => {
    expect(validPractice(pe())).toBe(true);
    expect(validPractice(pe({ correct: 0 }))).toBe(true);
    expect(validPractice(pe({ unitId: '' }))).toBe(false);
    expect(validPractice(pe({ type: undefined }))).toBe(false);
    expect(validPractice(pe({ wordId: '' }))).toBe(false);
    expect(validPractice(pe({ correct: 2 }))).toBe(false);
    expect(validPractice(pe({ ts: -1 }))).toBe(false);
  });
});

/* ── Mastery reducer ────────────────────────────────────── */

describe('rebuildPractice (§9.4)', () => {
  const events = [
    pe({ id: 'a', wordId: 'w1', correct: 1, unitId: 'u1' }),
    pe({ id: 'b', wordId: 'w1', correct: 0, unitId: 'u1' }),
    pe({ id: 'c', wordId: 'w2', correct: 1, unitId: 'u1' }),
  ];

  it('tallies per word and per unit', () => {
    const { byWord, byUnit } = rebuildPractice(events);
    expect(byWord.get('w1')).toMatchObject({ attempts: 2, correct: 1 });
    expect(byWord.get('w2')).toMatchObject({ attempts: 1, correct: 1 });
    expect(byUnit.get('u1')).toMatchObject({ attempts: 3, correct: 2 });
  });

  it('is order-independent — the log is a set', () => {
    const a = rebuildPractice(events);
    const b = rebuildPractice([...events].reverse());
    expect(a.byWord.get('w1')).toEqual(b.byWord.get('w1'));
    expect(a.byUnit.get('u1')).toEqual(b.byUnit.get('u1'));
  });

  it('ranks a unit weakest-first, unseen words first', () => {
    const practice = rebuildPractice(events);
    // w1: 50%, w2: 100%, w3: never practised → w3, w1, w2
    expect(weakestFirst(['w1', 'w2', 'w3'], practice)).toEqual(['w3', 'w1', 'w2']);
  });
});

/* ── The firewall: structural ───────────────────────────── */

describe('scheduler firewall — structural (§9.2)', () => {
  it('replay ignores a practice-shaped event, leaving FSRS state identical', () => {
    const deck = createDeck({ words: [word('zh:a:a1')] });
    const reviews = [{ id: 'r1', cardId: 'zh:a:a1#REC', rating: 3, ts: 1000 }];
    const leaked = [...reviews, pe({ ts: 1001 })]; // a practice event has no cardId

    const clean = rebuildFromEvents(deck, reviews);
    const withLeak = rebuildFromEvents(deck, leaked);
    expect(stateHash(withLeak.states)).toBe(stateHash(clean.states));
    expect(withLeak.skipped).toBeGreaterThan(clean.skipped); // it was seen, then skipped
  });
});

/* ── The firewall: through a real sync round-trip ───────── */

/** A device with both streams; the practice port mirrors the event port. */
function device(words = []) {
  const deck = createDeck({ words });
  const s = { events: [], practice: [], cursor: 0, wordCursor: 0, pCursor: 0, states: new Map(), rebuilds: 0, pRefresh: 0 };
  const strip = (e) => { const { synced, ...rest } = e; return rest; };
  const local = {
    unsyncedEvents: async () => s.events.filter((e) => e.synced === 0).map(strip),
    markSynced: async (ids) => { const k = new Set(ids); for (const e of s.events) if (k.has(e.id)) e.synced = 1; },
    addRemoteEvents: async (incoming) => {
      const known = new Set(s.events.map((e) => e.id));
      const fresh = incoming.filter((e) => !known.has(e.id));
      s.events.push(...fresh.map((e) => ({ ...e, synced: 1 })));
      return fresh.length;
    },
    cursor: async () => s.cursor, setCursor: async (v) => { s.cursor = v; },
    wordCursor: async () => s.wordCursor, setWordCursor: async (v) => { s.wordCursor = v; },
    localWords: async () => [], mergeWords: async () => 0,
    unsyncedPractice: async () => s.practice.filter((e) => e.synced === 0).map(strip),
    markPracticeSynced: async (ids) => { const k = new Set(ids); for (const e of s.practice) if (k.has(e.id)) e.synced = 1; },
    addRemotePractice: async (incoming) => {
      const known = new Set(s.practice.map((e) => e.id));
      const fresh = incoming.filter((e) => !known.has(e.id));
      s.practice.push(...fresh.map((e) => ({ ...e, synced: 1 })));
      return fresh.length;
    },
    practiceCursor: async () => s.pCursor, setPracticeCursor: async (v) => { s.pCursor = v; },
    refreshPractice: async () => { s.pRefresh += 1; },
    rebuild: async () => { s.rebuilds += 1; s.states = rebuildFromEvents(deck, s.events).states; },
  };
  return { s, local };
}

function fakeServer() {
  const events = [];
  const practice = [];
  let clock = 1000;
  const pull = (log, since) => {
    const after = log.filter((e) => e.received_at > (since ?? 0));
    const page = after.slice(0, 500);
    return { events: page.map(({ received_at, ...e }) => e), cursor: page.at(-1)?.received_at ?? since ?? 0, more: after.length > 500 };
  };
  return {
    events, practice,
    api: {
      me: async () => ({ user: { id: 'u1' } }),
      pushEvents: async (b) => { for (const e of b) if (!events.some((x) => x.id === e.id)) events.push({ ...e, received_at: ++clock }); return {}; },
      pullEvents: async (s) => pull(events, s),
      pushWords: async () => ({}), pullWords: async () => ({ words: [], cursor: 0, more: false }),
      pushPractice: async (b) => { for (const e of b) if (!practice.some((x) => x.id === e.id)) practice.push({ ...e, received_at: ++clock }); return {}; },
      pullPractice: async (s) => pull(practice, s),
    },
  };
}

describe('scheduler firewall — through sync (§9.2 acceptance)', () => {
  it('syncs practice between two devices without touching card state', async () => {
    const server = fakeServer();
    const a = device([word('zh:a:a1')]);
    const b = device([word('zh:a:a1')]);

    // Device A does a real review and a practice answer.
    a.s.events.push({ id: 'r1', cardId: 'zh:a:a1#REC', rating: 3, ts: 1000, synced: 0 });
    await a.local.rebuild();
    a.s.practice.push(createPracticeEvent({ unitId: 'u001', type: 'MCQ_MEANING', wordId: 'zh:a:a1', correct: 1, ts: 1001 }));
    const hashA = stateHash(a.s.states);

    await syncNow(a.local, server.api);
    const result = await syncNow(b.local, server.api);

    // B received both streams.
    expect(result.pulled).toBe(1);
    expect(result.practicePulled).toBe(1);
    expect(server.practice).toHaveLength(1);
    // B's card state came only from the review event; the practice event never entered replay.
    expect(stateHash(b.s.states)).toBe(hashA);
    expect(b.s.practice).toHaveLength(1);
    expect(b.s.pRefresh).toBe(1); // practice pull refreshed mastery, not FSRS
  });

  it('is idempotent — re-syncing pushes nothing new', async () => {
    const server = fakeServer();
    const a = device([word('zh:a:a1')]);
    a.s.practice.push(createPracticeEvent({ unitId: 'u001', type: 'CLOZE', wordId: 'zh:a:a1', correct: 0, ts: 1001 }));
    await syncNow(a.local, server.api);
    const again = await syncNow(a.local, server.api);
    expect(again.practicePushed).toBe(0);
    expect(server.practice).toHaveLength(1);
  });
});

describe('chunking still holds for practice', () => {
  it('splits oversize batches', () => {
    expect(chunk(Array.from({ length: 1200 }, (_, i) => i)).length).toBe(3);
  });
});
