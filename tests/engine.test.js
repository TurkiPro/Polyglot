import { describe, expect, it } from 'vitest';
import { config } from '../config/app.config.js';
import { cardId, cardIdsForWord, createDeck, modesForWord, parseCardId } from '../app/src/engine/deck.js';
import { createEvent, mergeEvents, sortEvents, toWire, uuidv4 } from '../app/src/engine/events.js';
import { buildQueue, interleave, isDue, newCardCandidates } from '../app/src/engine/queue.js';
import {
  HASHED_FIELDS,
  applyEvent,
  nextLocalMidnight,
  rebuildFromEvents,
  startOfLocalDay,
  stateHash,
} from '../app/src/engine/replay.js';
import { RATING, gradeCard, gradeProduction, gradeWriting, intervalDays, newCard, normalizePinyin } from '../app/src/engine/srs.js';

const { newCardsPerDay, maxReviewsPerDay, staggerUnlockDays } = config.study;

/** A pack word; defaults give all five modes. */
const word = (id, band = 1, extra = {}) => ({
  id,
  simp: id,
  pinyinNum: 'hao3',
  pinyin: 'hǎo',
  defs: ['good'],
  band,
  sentences: [{ zh: '好。', pinyin: 'hǎo.', pinyinAuto: true, en: 'Good.', src: 'tatoeba#1' }],
  ...extra,
});

const deckOf = (...words) => createDeck({ words });

/** Grade a card at a moment, appending to a log. */
const review = (log, id, rating, ts) => {
  const event = { id: `e${String(log.length).padStart(4, '0')}`, cardId: id, rating, ts };
  log.push(event);
  return event;
};

const DAY = 86400000;
const T0 = Date.UTC(2026, 6, 21, 9, 0, 0);

describe('deck', () => {
  it('builds card ids and parses them back', () => {
    expect(cardId('zh:好:hao3', 'REC')).toBe('zh:好:hao3#REC');
    expect(parseCardId('zh:好:hao3#REC')).toEqual({ wordId: 'zh:好:hao3', mode: 'REC' });
  });

  it('drops modes a word cannot support', () => {
    expect(modesForWord(word('a'))).toEqual(['REC', 'LIS', 'PROD', 'SENT', 'WRITE']);
    expect(modesForWord(word('b', 1, { sentences: [] }))).not.toContain('SENT');
    expect(modesForWord(word('c', 1, { noWrite: true }))).not.toContain('WRITE');
    // §5.4: a non-primary split member gets no LIS card.
    expect(modesForWord(word('d', 1, { splitPrimary: false }))).not.toContain('LIS');
    expect(modesForWord(word('e', 1, { splitPrimary: true }))).toContain('LIS');
    expect(cardIdsForWord(word('f', 1, { sentences: [], noWrite: true }))).toEqual([
      'f#REC',
      'f#LIS',
      'f#PROD',
    ]);
  });

  it('merges custom words over pack words and honours tombstones', () => {
    const deck = createDeck({ words: [word('a'), word('b')] }, [
      { ...word('a'), defs: ['mine'] },
      { id: 'b', deleted: true },
      word('c'),
    ]);
    expect(deck.word('a').defs).toEqual(['mine']);
    expect(deck.has('b')).toBe(false);
    expect(deck.size).toBe(2);
    expect(deck.wordOfCard('c#REC').id).toBe('c');
  });
});

describe('events', () => {
  it('creates a valid event and rejects a bad rating', () => {
    const event = createEvent({ cardId: 'a#REC', rating: 3, ts: T0, durMs: 4200.6 });
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event).toMatchObject({ cardId: 'a#REC', rating: 3, ts: T0, durMs: 4201, synced: 0 });
    expect(toWire(event).synced).toBeUndefined();
    expect(() => createEvent({ cardId: 'a#REC', rating: 5 })).toThrow();
    expect(() => createEvent({ rating: 3 })).toThrow();
  });

  it('mints v4 ids without crypto.randomUUID (non-secure context)', () => {
    // Served over plain HTTP from a LAN address, `crypto.randomUUID` does not exist.
    // Node and localhost both have it, which is exactly why this needs forcing.
    const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
    try {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
      expect(typeof crypto.randomUUID).not.toBe('function');

      const ids = new Set();
      for (let i = 0; i < 500; i++) {
        const id = uuidv4();
        // Canonical v4: version nibble 4, variant nibble 8/9/a/b.
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        ids.add(id);
      }
      expect(ids.size).toBe(500);

      // And the event path itself works, which is what actually broke.
      const event = createEvent({ cardId: 'a#REC', rating: 3, ts: T0 });
      expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      if (original) Object.defineProperty(globalThis.crypto, 'randomUUID', original);
    }
  });

  it('uses crypto.randomUUID when it is available', () => {
    expect(uuidv4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('orders by ts then id, and merges logs by id', () => {
    const a = { id: 'b', cardId: 'x#REC', rating: 3, ts: 2 };
    const b = { id: 'a', cardId: 'x#REC', rating: 3, ts: 2 };
    const c = { id: 'c', cardId: 'x#REC', rating: 3, ts: 1 };
    expect(sortEvents([a, b, c]).map((e) => e.id)).toEqual(['c', 'a', 'b']);
    expect(mergeEvents([a, b], [b, c]).map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('srs grading adapters', () => {
  it('normalizes typed pinyin per §8', () => {
    for (const typed of ['chuan2tong3', ' CHUAN2 TONG3 ', 'chuan2  tong3']) {
      expect(gradeProduction(typed, 'chuan2 tong3').correct).toBe(true);
    }
    expect(gradeProduction('lv4', 'lu:4').correct).toBe(true);
    expect(gradeProduction('lu:4', 'lv4').correct).toBe(true);
    expect(normalizePinyin('LV4')).toBe('lü4');
  });

  it('suggests Good on a match and Again on a miss, without grading outright', () => {
    expect(gradeProduction('hao3', 'hao3')).toEqual({ correct: true, suggested: RATING.GOOD });
    expect(gradeProduction('hao2', 'hao3')).toEqual({ correct: false, suggested: RATING.AGAIN });
    expect(gradeProduction('', 'hao3').correct).toBe(false);
  });

  it('maps handwriting mistakes to a rating', () => {
    expect(gradeWriting([0, 0])).toBe(RATING.GOOD);
    expect(gradeWriting([1])).toBe(RATING.HARD);
    expect(gradeWriting([2, 1])).toBe(RATING.HARD);
    expect(gradeWriting([3, 1])).toBe(RATING.AGAIN);
    expect(gradeWriting([0], { revealed: true })).toBe(RATING.AGAIN);
  });
});

describe('replay', () => {
  it('introduces all cards with only REC active', () => {
    const deck = deckOf(word('a'));
    const log = [];
    review(log, 'a#REC', RATING.GOOD, T0);
    const { states } = rebuildFromEvents(deck, log);

    expect([...states.keys()].sort()).toEqual(['a#LIS', 'a#PROD', 'a#REC', 'a#SENT', 'a#WRITE']);
    expect(states.get('a#REC').suspended).toBe(false);
    for (const mode of ['LIS', 'PROD', 'SENT', 'WRITE']) {
      expect(states.get(`a#${mode}`).suspended, mode).toBe(true);
    }
  });

  it('buries siblings until the next local midnight (§8)', () => {
    const deck = deckOf(word('a'));
    const log = [];
    review(log, 'a#REC', RATING.GOOD, T0);
    const { states } = rebuildFromEvents(deck, log);

    const prod = states.get('a#PROD');
    expect(prod.buriedUntil).toBe(nextLocalMidnight(T0));
    // Same local day: buried, so absent from the queue even once unsuspended.
    prod.suspended = false;
    expect(isDue(prod, T0 + 3600000)).toBe(false);
    expect(isDue(prod, prod.buriedUntil)).toBe(true);
  });

  it('unlocks non-REC cards only once the REC interval reaches the threshold (§8)', () => {
    const deck = deckOf(word('a'));
    const log = [];
    let ts = T0;

    // Grade REC repeatedly at its due time until the interval crosses the threshold.
    let states = new Map();
    for (let i = 0; i < 6; i++) {
      review(log, 'a#REC', RATING.GOOD, ts);
      states = rebuildFromEvents(deck, log).states;
      const rec = states.get('a#REC');
      const unlocked = !states.get('a#PROD').suspended;
      expect(unlocked).toBe(intervalDays(rec) >= staggerUnlockDays);
      if (unlocked) break;
      ts = new Date(rec.due).getTime();
    }
    expect(intervalDays(states.get('a#REC'))).toBeGreaterThanOrEqual(staggerUnlockDays);
    expect(states.get('a#PROD').suspended).toBe(false);
  });

  it('skips events for words the deck no longer has, without failing', () => {
    const deck = deckOf(word('a'));
    const log = [];
    review(log, 'gone#REC', RATING.GOOD, T0);
    review(log, 'a#REC', RATING.GOOD, T0 + 1000);
    const { states, skipped } = rebuildFromEvents(deck, log);
    expect(skipped).toBe(1);
    expect(states.has('a#REC')).toBe(true);
  });

  it('is deterministic: 150 reviews applied live match a rebuild from scratch (§8)', () => {
    const words = Array.from({ length: 12 }, (_, i) => word(`w${i}`, (i % 7) + 1));
    const deck = createDeck({ words });

    // Deterministic PRNG so a failure is reproducible.
    let seed = 20260721;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    // "Live" is the real session path: each answer applied to accumulated state,
    // never rebuilt. If this diverged from replay, sync and import would corrupt state.
    const live = new Map();
    const log = [];
    let ts = T0;

    for (let i = 0; i < 150; i++) {
      ts += Math.floor(rand() * 6 * 3600000) + 60000;
      const w = words[Math.floor(rand() * words.length)];
      const modes = modesForWord(w);
      const mode = modes[Math.floor(rand() * modes.length)];
      const event = review(log, cardId(w.id, mode), Math.floor(rand() * 4) + 1, ts);
      expect(applyEvent(deck, live, event)).toBe(true);
    }

    expect(log).toHaveLength(150);
    expect(live.size).toBeGreaterThan(0);

    const fromScratch = rebuildFromEvents(deck, log).states;
    expect(stateHash(fromScratch)).toBe(stateHash(live));

    // Arriving in a different order (two devices syncing) must not change the outcome.
    const shuffled = [...log];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    expect(shuffled.map((e) => e.id)).not.toEqual(log.map((e) => e.id));
    expect(stateHash(rebuildFromEvents(deck, shuffled).states)).toBe(stateHash(fromScratch));

    // And a round trip through JSON (the export/import path) must agree too.
    const viaJson = rebuildFromEvents(deck, JSON.parse(JSON.stringify(log))).states;
    expect(stateHash(viaJson)).toBe(stateHash(fromScratch));
  });

  it('detects drift — the hash is not vacuously equal', () => {
    const deck = deckOf(word('a'));
    const log = [];
    review(log, 'a#REC', RATING.GOOD, T0);
    const base = rebuildFromEvents(deck, log).states;

    const extra = [...log];
    review(extra, 'a#REC', RATING.AGAIN, T0 + DAY);
    expect(stateHash(rebuildFromEvents(deck, extra).states)).not.toBe(stateHash(base));
  });
});

describe('queue', () => {
  const manyWords = Array.from({ length: 40 }, (_, i) => word(`w${i}`, (i % 5) + 1));

  it('caps new cards at NEW_CARDS_PER_DAY (§8)', () => {
    const deck = createDeck({ words: manyWords });
    const { cards, newCount } = buildQueue(deck, new Map(), { now: T0 });
    expect(newCount).toBe(newCardsPerDay);
    expect(cards).toHaveLength(newCardsPerDay);
  });

  it('orders new cards by band, then deck order', () => {
    const deck = createDeck({ words: [word('c', 3), word('a', 1), word('b', 1)] });
    expect(newCardCandidates(deck, new Map()).map((c) => c.cardId)).toEqual([
      'a#REC',
      'b#REC',
      'c#REC',
    ]);
  });

  it('caps reviews at MAX_REVIEWS_PER_DAY and orders by due date (§8)', () => {
    const states = new Map();
    for (let i = 0; i < maxReviewsPerDay + 25; i++) {
      const id = `w${i}#REC`;
      states.set(id, {
        cardId: id,
        wordId: `w${i}`,
        mode: 'REC',
        ...newCard(new Date(T0 - DAY)),
        due: new Date(T0 - i * 1000),
        suspended: false,
        buriedUntil: null,
      });
    }
    const { cards, dueCount } = buildQueue(createDeck({ words: [] }), states, { now: T0 });
    expect(dueCount).toBe(maxReviewsPerDay);
    expect(cards).toHaveLength(maxReviewsPerDay);
    // Oldest due first.
    expect(cards[0]).toBe(`w${maxReviewsPerDay + 24}#REC`);
  });

  it('respects work already done today', () => {
    const deck = createDeck({ words: manyWords });
    const { newCount } = buildQueue(deck, new Map(), { now: T0, newDoneToday: newCardsPerDay - 2 });
    expect(newCount).toBe(2);
    const { newCount: none } = buildQueue(deck, new Map(), { now: T0, newDoneToday: 999 });
    expect(none).toBe(0);
  });

  it('honours the settings overrides', () => {
    const deck = createDeck({ words: manyWords });
    expect(buildQueue(deck, new Map(), { now: T0, maxNew: 3 }).newCount).toBe(3);
  });

  it('excludes suspended and buried cards', () => {
    const base = { ...newCard(new Date(T0 - DAY)), due: new Date(T0 - 1000) };
    expect(isDue({ ...base, suspended: true, buriedUntil: null }, T0)).toBe(false);
    expect(isDue({ ...base, suspended: false, buriedUntil: T0 + DAY }, T0)).toBe(false);
    expect(isDue({ ...base, suspended: false, buriedUntil: T0 - 1 }, T0)).toBe(true);
    expect(isDue({ ...base, suspended: false, due: new Date(T0 + 1000) }, T0)).toBe(false);
  });

  it('interleaves new cards through the review stream', () => {
    const due = Array.from({ length: 20 }, (_, i) => `d${i}`);
    const fresh = ['n0', 'n1', 'n2', 'n3'];
    const woven = interleave(due, fresh);

    expect(woven).toHaveLength(24);
    expect(woven.filter((c) => c.startsWith('n'))).toEqual(fresh);
    // A new card is never first, and they are spread rather than clumped.
    expect(woven[0]).toBe('d0');
    const positions = fresh.map((n) => woven.indexOf(n));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(Math.min(...positions)).toBeGreaterThan(0);

    expect(interleave([], fresh)).toEqual(fresh);
    expect(interleave(due, [])).toEqual(due);
  });
});

describe('stateHash covers durable state only', () => {
  const seeded = () => {
    const deck = deckOf(word('a'));
    const log = [];
    review(log, 'a#REC', RATING.GOOD, T0);
    review(log, 'a#REC', RATING.GOOD, T0 + 3 * DAY);
    return { deck, log, states: rebuildFromEvents(deck, log).states };
  };

  it('hashes exactly the durable FSRS fields plus suspended', () => {
    expect(HASHED_FIELDS).toEqual([
      'due',
      'stability',
      'difficulty',
      'elapsed_days',
      'scheduled_days',
      'learning_steps',
      'reps',
      'lapses',
      'state',
      'suspended',
    ]);
    expect(HASHED_FIELDS).not.toContain('buriedUntil');
  });

  it('ignores buriedUntil — it is timezone-derived and ephemeral', () => {
    const { states } = seeded();
    const before = stateHash(states);
    for (const s of states.values()) s.buriedUntil = (s.buriedUntil ?? 0) + 12 * 3600000;
    expect(stateHash(states)).toBe(before);
    for (const s of states.values()) s.buriedUntil = null;
    expect(stateHash(states)).toBe(before);
  });

  it('reacts to every field it claims to cover', () => {
    for (const field of HASHED_FIELDS) {
      const { states } = seeded();
      const before = stateHash(states);
      const card = states.get('a#REC');
      if (field === 'due') card.due = new Date(new Date(card.due).getTime() + DAY);
      else if (field === 'suspended') card.suspended = !card.suspended;
      else card[field] = (card[field] ?? 0) + 1;
      expect(stateHash(states), `${field} must affect the hash`).not.toBe(before);
    }
  });

  it('agrees across timezones — the same log replayed in Kiritimati and LA', () => {
    const original = process.env.TZ;
    try {
      const hashes = ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles'].map((tz) => {
        process.env.TZ = tz;
        const { states } = seeded();
        // Bury really does differ per timezone — that is the point.
        return { tz, hash: stateHash(states), buried: states.get('a#PROD').buriedUntil };
      });

      const [utc, kiritimati, la] = hashes;
      expect(kiritimati.hash).toBe(utc.hash);
      expect(la.hash).toBe(utc.hash);
      // Guard against the test being vacuous: local midnight must genuinely differ.
      expect(new Set(hashes.map((h) => h.buried)).size).toBeGreaterThan(1);
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('§8 acceptance, end to end through the queue', () => {
  it('bury: after answering W#REC, W#PROD is absent from the same local day', () => {
    const deck = deckOf(word('a'));
    const log = [];
    review(log, 'a#REC', RATING.GOOD, T0);
    const { states } = rebuildFromEvents(deck, log);

    // Unsuspend the siblings so bury is the only thing that could exclude them.
    for (const mode of ['LIS', 'PROD', 'SENT', 'WRITE']) states.get(`a#${mode}`).suspended = false;

    const sameDay = buildQueue(deck, states, { now: T0 + 6 * 3600000 }).cards;
    expect(sameDay).not.toContain('a#PROD');

    const nextDay = buildQueue(deck, states, { now: nextLocalMidnight(T0) + 1000 }).cards;
    expect(nextDay).toContain('a#PROD');
  });

  it('stagger: non-REC cards reach the queue only once REC matures', () => {
    const deck = deckOf(word('a'));
    const log = [];
    let ts = T0;
    let states = new Map();

    for (let i = 0; i < 8; i++) {
      review(log, 'a#REC', RATING.GOOD, ts);
      states = rebuildFromEvents(deck, log).states;
      const rec = states.get('a#REC');
      // Look at the day after, so the bury from answering REC has expired.
      const tomorrow = nextLocalMidnight(ts) + 1000;
      const queued = buildQueue(deck, states, { now: tomorrow }).cards;
      if (intervalDays(rec) < staggerUnlockDays) {
        expect(queued).not.toContain('a#PROD');
      } else {
        expect(queued).toContain('a#PROD');
        return;
      }
      ts = new Date(rec.due).getTime();
    }
    throw new Error('REC never reached the unlock threshold');
  });
});

describe('local day', () => {
  it('rolls over at local midnight', () => {
    const ts = new Date(2026, 6, 21, 23, 30).getTime();
    expect(startOfLocalDay(ts)).toBe(new Date(2026, 6, 21, 0, 0, 0, 0).getTime());
    expect(nextLocalMidnight(ts)).toBe(new Date(2026, 6, 22, 0, 0, 0, 0).getTime());
    // A session crossing midnight lands in the following day.
    expect(startOfLocalDay(nextLocalMidnight(ts) + 1000)).toBe(nextLocalMidnight(ts));
  });
});
