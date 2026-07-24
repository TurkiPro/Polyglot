/**
 * Phase 7 — Learn mode.
 *
 * The machine half of §8's acceptance: id stability, introRank ordering, the ramp, the
 * writing-track toggle, and the pipeline's n+1 pass.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { config } from '../config/app.config.js';
import { cardIdsForWord, createDeck, modesForWord } from '../app/src/engine/deck.js';
import { buildQueue, newCardCandidates, rampedNewCards } from '../app/src/engine/queue.js';
import { rebuildFromEvents } from '../app/src/engine/replay.js';
import { earlyBandMetrics, orderByIntroduction, segment } from '../packs/zh/lib/intro.js';
import { attachComponents, componentsOf, parseDecomposition } from '../packs/zh/lib/decomp.js';
import { buildDrillSet, isCorrect, toneWeights, weightedTone } from '../app/src/zh/tones-drill.js';

const packDir = new URL('../app/assets/packs/zh/', import.meta.url);
const deck = JSON.parse(readFileSync(new URL('deck.zh.json', packDir), 'utf8'));
const overrides = JSON.parse(
  readFileSync(new URL('../packs/zh/overrides.json', import.meta.url), 'utf8'),
);

/* ── §2. Dependency-ordered introduction ────────────────── */

describe('the shipped deck is v2 and dependency-ordered (§7.2)', () => {
  it('declares schemaVersion 2', () => {
    expect(deck.schemaVersion).toBe(2);
    expect(config.pack.deckSchemaVersion).toBe(2);
  });

  it('gives every word a unique, contiguous introRank', () => {
    const ranks = deck.words.map((word) => word.introRank);
    expect(ranks.every((rank) => Number.isInteger(rank) && rank > 0)).toBe(true);
    expect(new Set(ranks).size).toBe(deck.words.length);
    expect(Math.min(...ranks)).toBe(1);
    expect(Math.max(...ranks)).toBe(deck.words.length);
  });

  it('opens with the curated seed words, in their curated order', () => {
    const seeds = overrides.seedOrder;
    expect(seeds.length).toBeGreaterThan(0);

    const opening = [...deck.words]
      .sort((a, b) => a.introRank - b.introRank)
      .slice(0, seeds.length)
      .map((word) => word.simp);
    expect(opening).toEqual(seeds);
  });

  it('introduces most early words inside a sentence the learner can already read', () => {
    const metrics = earlyBandMetrics(deck.words);
    // The whole point of the pass: bands 1-3 are where a beginner lives.
    expect(metrics.cleanPct).toBeGreaterThan(80);
    expect(metrics.nonePct).toBeLessThan(10);
  });

  it('points introSentence at a sentence the word actually has', () => {
    const withSentence = deck.words.filter((word) => word.introSentence);
    expect(withSentence.length).toBeGreaterThan(1000);
    for (const word of withSentence.slice(0, 400)) {
      expect(word.sentences.some((s) => s.src === word.introSentence), word.simp).toBe(true);
    }
  });
});

describe('the n+1 pass itself', () => {
  const word = (simp, band, sentences = []) => ({
    id: `zh:${simp}`,
    simp,
    band,
    pinyinNum: 'x',
    defs: ['x'],
    sentences: sentences.map((zh, i) => ({ zh, src: `t#${simp}${i}`, en: 'x', pinyin: 'x' })),
  });

  it('segments a sentence by longest match against known vocabulary', () => {
    const vocabulary = new Set(['我', '喜欢', '这', '本书']);
    expect(segment('我喜欢这本书。', vocabulary)).toEqual(['我', '喜欢', '这', '本书']);
    // An unknown character is its own token, so it still counts as unknown.
    expect(segment('我吃饭', new Set(['我']))).toEqual(['我', '吃', '饭']);
  });

  it('only introduces a word once its sentence is fully readable', () => {
    const words = [
      word('我', 1, []),
      word('好', 1, []),
      // 很 needs 我 and 好 first; 猫 needs 很.
      word('很', 1, ['我很好']),
      word('猫', 2, ['猫很好']),
    ];
    const { ranked } = orderByIntroduction(words, ['我', '好']);

    expect(ranked.map((w) => w.simp)).toEqual(['我', '好', '很', '猫']);
    expect(ranked[2].introQuality).toBe('clean');
    expect(ranked[2].introSentence).toBe('t#很0');
  });

  it('relaxes to one extra unknown before giving up, and flags what it did', () => {
    const words = [
      word('我', 1, []),
      // Never fully readable: 天 and 气 are not deck words at all.
      word('喜欢', 1, ['我喜欢天气']),
    ];
    const { ranked, stats } = orderByIntroduction(words, ['我']);
    expect(ranked.map((w) => w.simp)).toEqual(['我', '喜欢']);
    expect(stats.seeded).toBe(1);
    // Two unknown characters is past the relaxed threshold, so it goes in bare.
    expect(ranked[1].introQuality).toBe('none');
  });

  it('never leaves a word unranked, even with no sentences at all', () => {
    const words = [word('a', 1), word('b', 2), word('c', 3)];
    const { ranked, stats } = orderByIntroduction(words, []);
    expect(ranked).toHaveLength(3);
    expect(stats.none).toBe(3);
    expect(ranked.map((w) => w.introRank)).toEqual([1, 2, 3]);
  });
});

/* ── §2. Card ids are immutable ─────────────────────────── */

describe('card ids survived the reordering (§7 preamble)', () => {
  it('keeps every id the v1 pack minted', () => {
    // The build refuses to write a deck that loses an id; this asserts the shipped result.
    const ids = deck.words.map((word) => word.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Spot-check ids that existed long before Phase 7.
    for (const id of ['zh:好:hao3', 'zh:学习:xue2_xi2', 'zh:传统:chuan2_tong3', 'zh:别:bie4']) {
      expect(ids, id).toContain(id);
    }
  });

  it('did not change what a card id is made of', () => {
    for (const word of deck.words.slice(0, 200)) {
      expect(word.id).toBe(`zh:${word.simp}:${word.pinyinNum.replace(/\s+/g, '_')}`);
    }
  });
});

/* ── §2. Queue ordering ─────────────────────────────────── */

describe('the new-card queue follows introRank (§7.2)', () => {
  const w = (id, band, introRank, extra = {}) => ({
    id,
    simp: id,
    band,
    introRank,
    pinyinNum: 'yi1',
    pinyin: 'yī',
    defs: ['x'],
    sentences: [],
    ...extra,
  });

  it('orders by introRank rather than band', () => {
    // Band order would put b1 first; intro order says otherwise.
    const testDeck = createDeck({ words: [w('b1', 1, 40), w('b7', 7, 2), w('b3', 3, 9)] });
    expect(newCardCandidates(testDeck, new Map()).map((c) => c.wordId)).toEqual([
      'b7',
      'b3',
      'b1',
    ]);
  });

  it('still lets a prioritized word jump the queue — autonomy outranks curriculum', () => {
    const testDeck = createDeck({ words: [w('first', 1, 1), w('later', 7, 900)] });
    const priorities = new Map([['later', Date.now()]]);
    expect(newCardCandidates(testDeck, new Map(), priorities).map((c) => c.wordId)).toEqual([
      'later',
      'first',
    ]);
  });

  it('falls back to band order for a pack with no introRank', () => {
    const legacy = createDeck({
      words: [
        { id: 'b3', simp: 'b3', band: 3, pinyinNum: 'x', defs: [], sentences: [] },
        { id: 'b1', simp: 'b1', band: 1, pinyinNum: 'x', defs: [], sentences: [] },
      ],
    });
    expect(newCardCandidates(legacy, new Map()).map((c) => c.wordId)).toEqual(['b1', 'b3']);
  });

  it('gives a fresh account the seed words first, in order', () => {
    const testDeck = createDeck({ words: deck.words });
    const first = newCardCandidates(testDeck, new Map())
      .slice(0, overrides.seedOrder.length)
      .map((candidate) => testDeck.word(candidate.wordId).simp);
    expect(first).toEqual(overrides.seedOrder);
  });
});

/* ── §1.5. The ramp ─────────────────────────────────────── */

describe('new-card ramp (§7.1.5)', () => {
  const configured = config.study.newCardsPerDay;

  it('caps the first week at 5 and the second at 7', () => {
    for (const day of [1, 2, 5, 7]) expect(rampedNewCards(day, configured)).toBe(5);
    for (const day of [8, 10, 14]) expect(rampedNewCards(day, configured)).toBe(7);
    expect(rampedNewCards(15, configured)).toBe(configured);
    expect(rampedNewCards(400, configured)).toBe(configured);
  });

  it('counts active days, not calendar days', () => {
    // Someone who studies twice in a fortnight is still on day 2 of learning.
    expect(rampedNewCards(2, configured)).toBe(5);
  });

  it('never raises a lower setting', () => {
    expect(rampedNewCards(1, 3)).toBe(3);
    expect(rampedNewCards(10, 4)).toBe(4);
  });

  it('steps aside the moment the learner sets a number themselves', () => {
    expect(rampedNewCards(1, 20, true)).toBe(20);
    expect(rampedNewCards(1, 1, true)).toBe(1);
  });

  it('limits an actual queue on day one', () => {
    const words = Array.from({ length: 40 }, (_, i) => ({
      id: `w${i}`,
      simp: `w${i}`,
      band: 1,
      introRank: i + 1,
      pinyinNum: 'x',
      defs: [],
      sentences: [],
    }));
    const { newCount } = buildQueue(createDeck({ words }), new Map(), {
      now: Date.now(),
      maxNew: rampedNewCards(1, configured),
    });
    expect(newCount).toBe(5);
  });
});

/* ── §1.4. The writing track ────────────────────────────── */

describe('writing track (§7.1.4)', () => {
  const word = {
    id: 'w1',
    simp: '好',
    band: 1,
    pinyinNum: 'hao3',
    defs: ['good'],
    sentences: [{ zh: '好。', pinyin: 'hǎo.', en: 'Good.', src: 't#1' }],
  };

  it('creates no WRITE card when the track is off', () => {
    expect(modesForWord(word, { writingTrack: false })).not.toContain('WRITE');
    expect(cardIdsForWord(word, { writingTrack: false })).not.toContain('w1#WRITE');
    // Everything else is untouched.
    expect(modesForWord(word, { writingTrack: false })).toEqual(['REC', 'LIS', 'PROD', 'SENT']);
  });

  it('creates one when the track is on, which is the default for any existing caller', () => {
    expect(modesForWord(word)).toContain('WRITE');
    expect(modesForWord(word, { writingTrack: true })).toContain('WRITE');
  });

  it('still respects a word with no stroke data either way', () => {
    const noStrokes = { ...word, noWrite: true };
    expect(modesForWord(noStrokes, { writingTrack: true })).not.toContain('WRITE');
  });

  it('replay creates and drops the sibling as the toggle moves, keeping the log intact', () => {
    const testDeck = createDeck({ words: [word] });
    const log = [{ id: 'e1', cardId: 'w1#REC', rating: 3, ts: Date.UTC(2026, 6, 21, 9) }];

    const withWriting = rebuildFromEvents(testDeck, log, { writingTrack: true });
    expect(withWriting.states.has('w1#WRITE')).toBe(true);

    const without = rebuildFromEvents(testDeck, log, { writingTrack: false });
    expect(without.states.has('w1#WRITE')).toBe(false);
    // The REC card is identical either way — the log is what it is.
    expect(without.states.get('w1#REC').reps).toBe(withWriting.states.get('w1#REC').reps);
    expect(without.skipped).toBe(0);
  });
});

/* ── §3. Components ─────────────────────────────────────── */

describe('component breakdowns (§7.3)', () => {
  const SAMPLE = [
    '{"character":"好","definition":"good","decomposition":"⿰女子","radical":"女"}',
    '{"character":"女","definition":"woman, female","decomposition":"？","radical":"女"}',
    '{"character":"子","definition":"son, child","decomposition":"？","radical":"子"}',
  ].join('\n');

  it('parses the source and strips layout operators', () => {
    const byChar = parseDecomposition(SAMPLE);
    expect(byChar.size).toBe(3);
    expect(componentsOf('好', byChar)).toEqual([
      { char: '女', meaning: 'woman', radical: true },
      { char: '子', meaning: 'son' },
    ]);
  });

  it('survives a malformed line rather than failing the build', () => {
    const byChar = parseDecomposition(`not json\n${SAMPLE}\n{"broken":`);
    expect(byChar.size).toBe(3);
  });

  it('returns nothing for a character it does not know', () => {
    expect(componentsOf('X', parseDecomposition(SAMPLE))).toEqual([]);
  });

  it('attaches one entry per character of a word', () => {
    const words = [{ simp: '好', defs: [] }];
    const stats = attachComponents(words, parseDecomposition(SAMPLE));
    expect(stats.withComponents).toBe(1);
    expect(words[0].components[0].parts).toHaveLength(2);
  });

  it('ships breakdowns in the real pack, including 好 = 女 + 子', () => {
    const hao = deck.words.find((word) => word.id === 'zh:好:hao3');
    expect(hao.components?.[0]?.parts?.map((p) => p.char)).toEqual(['女', '子']);
  });
});

/* ── §1.2. Tone drills ──────────────────────────────────── */

describe('tone drills (§7.1.2)', () => {
  it('over-samples the 2/3 pair, which is the one adults confuse', () => {
    const weights = toneWeights(null);
    expect(weights.get(2)).toBeGreaterThan(weights.get(1));
    expect(weights.get(3)).toBeGreaterThan(weights.get(4));
  });

  it('leans further into whatever this learner keeps missing', () => {
    const struggling = { byTone: { 4: { attempts: 10, correct: 2 } } };
    const confident = { byTone: { 4: { attempts: 10, correct: 10 } } };
    expect(toneWeights(struggling).get(4)).toBeGreaterThan(toneWeights(confident).get(4));
  });

  it('ignores a sample too small to mean anything', () => {
    const noisy = { byTone: { 1: { attempts: 2, correct: 0 } } };
    expect(toneWeights(noisy).get(1)).toBe(toneWeights(null).get(1));
  });

  it('builds sets of the configured size, singles or pairs', () => {
    const singles = buildDrillSet({ size: 10, random: () => 0.5 });
    expect(singles).toHaveLength(10);
    expect(singles[0].answer).toHaveLength(1);

    const pairs = buildDrillSet({ size: 10, pairs: true, random: () => 0.5 });
    expect(pairs[0].answer).toHaveLength(2);
    expect(pairs[0].syllables).toHaveLength(2);
  });

  it('marks a pair correct only when both tones match', () => {
    const drill = { answer: [2, 3] };
    expect(isCorrect(drill, [2, 3])).toBe(true);
    expect(isCorrect(drill, [3, 2])).toBe(false);
    expect(isCorrect(drill, [2])).toBe(false);
  });

  it('picks a tone deterministically for a given roll', () => {
    const weights = new Map([[1, 1], [2, 1]]);
    expect(weightedTone(weights, () => 0)).toBe(1);
    expect(weightedTone(weights, () => 0.99)).toBe(2);
  });
});
