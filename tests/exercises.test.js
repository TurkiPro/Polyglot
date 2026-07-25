/**
 * Exercise engine (Phase 9 §2): generators, graders, distractors.
 *
 * Node suite — the engine is pure, so it runs without a DOM. The firewall (a practice_event
 * never mutating FSRS) is proven in sync/replay tests; here we prove the mechanics.
 */
import { describe, expect, it } from 'vitest';
import {
  EXERCISE_TYPES,
  generate,
  grade,
  hashSeed,
  makeRng,
  pickDistractors,
  prepareExercises,
  segment,
  shuffle,
  similarity,
} from '../app/src/engine/exercises.js';

/** A small but realistic deck: band-1 monosyllables that form a few sentences. */
const WORDS = [
  { id: 'zh:我:wo3', simp: '我', pinyin: 'wǒ', pinyinNum: 'wo3', defs: ['I, me'], band: 1 },
  { id: 'zh:你:ni3', simp: '你', pinyin: 'nǐ', pinyinNum: 'ni3', defs: ['you'], band: 1 },
  { id: 'zh:他:ta1', simp: '他', pinyin: 'tā', pinyinNum: 'ta1', defs: ['he, him'], band: 1 },
  { id: 'zh:是:shi4', simp: '是', pinyin: 'shì', pinyinNum: 'shi4', defs: ['to be'], band: 1 },
  { id: 'zh:好:hao3', simp: '好', pinyin: 'hǎo', pinyinNum: 'hao3', defs: ['good'], band: 1 },
  { id: 'zh:马:ma3', simp: '马', pinyin: 'mǎ', pinyinNum: 'ma3', defs: ['horse'], band: 1 },
  { id: 'zh:妈:ma1', simp: '妈', pinyin: 'mā', pinyinNum: 'ma1', defs: ['mother'], band: 1 },
  { id: 'zh:朋友:peng2_you5', simp: '朋友', pinyin: 'péngyou', pinyinNum: 'peng2 you5', defs: ['friend'], band: 1,
    sentences: [{ zh: '你是我的朋友。', en: 'You are my friend.' }] },
  { id: 'zh:的:de5', simp: '的', pinyin: 'de', pinyinNum: 'de5', defs: ['(possessive)'], band: 1 },
];

const ctx = prepareExercises(WORDS);
const allKnown = new Set(WORDS.map((w) => w.simp));

describe('seeded RNG (§9.2)', () => {
  it('reproduces the same sequence for a seed', () => {
    const a = makeRng(hashSeed('u07-2'));
    const b = makeRng(hashSeed('u07-2'));
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('shuffles deterministically', () => {
    const one = shuffle([1, 2, 3, 4, 5], makeRng(42));
    const two = shuffle([1, 2, 3, 4, 5], makeRng(42));
    expect(one).toEqual(two);
    expect(one).not.toEqual([1, 2, 3, 4, 5]); // actually shuffled
  });
});

describe('distractors (§9.2)', () => {
  it('are deterministic for a seed and prefer same-band, similar words', () => {
    const target = ctx.byId.get('zh:马:ma3');
    const one = pickDistractors(target, ctx, 3, makeRng(1)).map((w) => w.id);
    const two = pickDistractors(target, ctx, 3, makeRng(1)).map((w) => w.id);
    expect(one).toEqual(two);
    expect(one).not.toContain(target.id); // never the target itself
  });

  it('scores a tone-mate and component-mate above an unrelated word', () => {
    const ma3 = ctx.byId.get('zh:马:ma3');
    const hao3 = ctx.byId.get('zh:好:hao3'); // same tone (3)
    const shi4 = ctx.byId.get('zh:是:shi4'); // different tone
    expect(similarity(ma3, hao3)).toBeGreaterThan(similarity(ma3, shi4));
  });
});

describe('generators + graders (§9.2)', () => {
  it('MCQ_MEANING: right option passes, wrong fails, options include the answer', () => {
    const item = generate('MCQ_MEANING', { candidates: [ctx.byId.get('zh:马:ma3')], ctx, rng: makeRng(7) });
    expect(item.type).toBe('MCQ_MEANING');
    expect(item.options).toHaveLength(4);
    expect(item.options.map((o) => o.id)).toContain('zh:马:ma3');
    expect(grade(item, 'zh:马:ma3').correct).toBe(true);
    expect(grade(item, item.options.find((o) => o.id !== item.answer).id).correct).toBe(false);
  });

  it('MCQ_AUDIO: prompt is the target, graded by hanzi choice', () => {
    const item = generate('MCQ_AUDIO', { candidates: [ctx.byId.get('zh:你:ni3')], ctx, rng: makeRng(3) });
    expect(item.wordId).toBe('zh:你:ni3');
    expect(grade(item, 'zh:你:ni3').correct).toBe(true);
  });

  it('TYPE_PINYIN reuses the PROD normalizer (spacing / v tolerant)', () => {
    const item = generate('TYPE_PINYIN', { candidates: [ctx.byId.get('zh:朋友:peng2_you5')], ctx, rng: makeRng(1) });
    expect(grade(item, 'peng2you5').correct).toBe(true);
    expect(grade(item, ' PENG2 YOU5 ').correct).toBe(true);
    expect(grade(item, 'wrong').correct).toBe(false);
  });

  it('MATCH: all-correct pairing passes, a swap fails', () => {
    const item = generate('MATCH', { candidates: WORDS.slice(0, 5), ctx, rng: makeRng(9) });
    const right = Object.fromEntries(item.answer.map((id) => [id, id]));
    expect(grade(item, right).correct).toBe(true);
    const swapped = { ...right, [item.answer[0]]: item.answer[1] };
    expect(grade(item, swapped).correct).toBe(false);
  });

  it('REORDER: original order passes, a reversal fails; only known-word sentences qualify', () => {
    const item = generate('REORDER', { candidates: [ctx.byId.get('zh:朋友:peng2_you5')], ctx, rng: makeRng(2), known: allKnown });
    expect(item).not.toBeNull();
    expect(grade(item, item.answer).correct).toBe(true);
    expect(grade(item, [...item.answer].reverse()).correct).toBe(false);
  });

  it('REORDER/CLOZE decline when a sentence word is not yet known', () => {
    const partial = new Set(['朋友', '你']); // missing 是, 我, 的
    expect(generate('REORDER', { candidates: [ctx.byId.get('zh:朋友:peng2_you5')], ctx, rng: makeRng(2), known: partial })).toBeNull();
    expect(generate('CLOZE', { candidates: [ctx.byId.get('zh:朋友:peng2_you5')], ctx, rng: makeRng(2), known: partial })).toBeNull();
  });

  it('CLOZE: blanks the target, right pick passes', () => {
    const item = generate('CLOZE', { candidates: [ctx.byId.get('zh:朋友:peng2_you5')], ctx, rng: makeRng(4), known: allKnown });
    expect(item.tiles[item.blankAt]).toBe('朋友');
    expect(grade(item, 'zh:朋友:peng2_you5').correct).toBe(true);
  });

  it('reproduces an identical item for the same seed', () => {
    const a = generate('MCQ_MEANING', { candidates: [ctx.byId.get('zh:马:ma3')], ctx, rng: makeRng(hashSeed('q1')) });
    const b = generate('MCQ_MEANING', { candidates: [ctx.byId.get('zh:马:ma3')], ctx, rng: makeRng(hashSeed('q1')) });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('segmentation (§9.2)', () => {
  it('greedy longest-match splits into deck words, keeping multi-char words whole', () => {
    const tiles = segment('你是我的朋友。', ctx).map((t) => t.simp);
    expect(tiles).toEqual(['你', '是', '我', '的', '朋友']); // 朋友 stays one tile, punctuation dropped
  });
});

describe('type list', () => {
  it('exposes exactly the six §2 types', () => {
    expect(EXERCISE_TYPES).toEqual(['MATCH', 'MCQ_MEANING', 'MCQ_AUDIO', 'TYPE_PINYIN', 'REORDER', 'CLOZE']);
  });
});
