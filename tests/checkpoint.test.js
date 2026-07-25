/**
 * Checkpoints and mastery (Phase 9 §4).
 *
 * The quiz item-builder and attempt counting are pure and proven here; the sign ignition,
 * medallion and band-clear flourish are a manual checklist (§6). The scheduler firewall is
 * re-checked under a checkpoint load in tests/practice.test.js.
 */
import { describe, expect, it } from 'vitest';
import { buildQuizItems, hashSeed, makeRng, prepareExercises } from '../app/src/engine/exercises.js';
import { attemptCount } from '../app/src/engine/coursestate.js';
import { config } from '../config/app.config.js';

const WORDS = [
  { id: 'zh:我:wo3', simp: '我', pinyin: 'wǒ', pinyinNum: 'wo3', defs: ['I'], band: 1 },
  { id: 'zh:你:ni3', simp: '你', pinyin: 'nǐ', pinyinNum: 'ni3', defs: ['you'], band: 1 },
  { id: 'zh:他:ta1', simp: '他', pinyin: 'tā', pinyinNum: 'ta1', defs: ['he'], band: 1 },
  { id: 'zh:是:shi4', simp: '是', pinyin: 'shì', pinyinNum: 'shi4', defs: ['to be'], band: 1 },
  { id: 'zh:好:hao3', simp: '好', pinyin: 'hǎo', pinyinNum: 'hao3', defs: ['good'], band: 1 },
  { id: 'zh:马:ma3', simp: '马', pinyin: 'mǎ', pinyinNum: 'ma3', defs: ['horse'], band: 1 },
];
const ctx = prepareExercises(WORDS);
const LEN = config.course.quizLength;

describe('buildQuizItems (§9.4)', () => {
  it('produces the configured number of gradeable items', () => {
    const items = buildQuizItems({ words: WORDS, ctx, rng: makeRng(1), known: new Set(), length: LEN });
    expect(items).toHaveLength(LEN);
    for (const item of items) expect(item.type).toBeTruthy();
  });

  it('reproduces the same paper for the same seed, and a different one per attempt', () => {
    const seedFor = (attempt) => makeRng(hashSeed(`u001:${attempt}`));
    const a1 = buildQuizItems({ words: WORDS, ctx, rng: seedFor(0), known: new Set(), length: LEN });
    const a1again = buildQuizItems({ words: WORDS, ctx, rng: seedFor(0), known: new Set(), length: LEN });
    const a2 = buildQuizItems({ words: WORDS, ctx, rng: seedFor(1), known: new Set(), length: LEN });
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a1again)); // same seed → same paper
    expect(JSON.stringify(a2)).not.toBe(JSON.stringify(a1)); // a retake regenerates
  });

  it('mixes exercise types rather than asking one thing twelve times', () => {
    const items = buildQuizItems({ words: WORDS, ctx, rng: makeRng(9), known: new Set(), length: LEN });
    expect(new Set(items.map((i) => i.type)).size).toBeGreaterThan(1);
  });
});

describe('attemptCount (§9.4)', () => {
  it('counts every checkpoint outcome for the unit, pass or fail', () => {
    const practice = [
      { unitId: 'u001', type: 'MCQ_MEANING' }, // an item, not a checkpoint
      { unitId: 'u001', type: 'CHECKPOINT_FAIL' },
      { unitId: 'u001', type: 'CHECKPOINT' },
      { unitId: 'u002', type: 'CHECKPOINT_GOLD' }, // a different unit
    ];
    expect(attemptCount(practice, 'u001')).toBe(2);
    expect(attemptCount(practice, 'u002')).toBe(1);
    expect(attemptCount(practice, 'u003')).toBe(0);
  });
});
