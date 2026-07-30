/**
 * The theme-first scheduler (Phase 11 §2).
 *
 * The Phase-9 slicer produced a "Numbers" unit opening with 好玩儿. These pin the fix: unit
 * membership is literal (every word in a topic unit is that topic), function words ride "core"
 * units by demand, dependency order is respected, and the whole thing is deterministic.
 */
import { describe, expect, it } from 'vitest';
import { mergeTiny, scheduleUnits } from '../packs/zh/lib/schedule.js';

/** A word with an intro sentence built from the given simps (so readiness is real). */
const w = (id, simp, band, sentenceSimps) => ({
  id, simp, band, introRank: id.length + simp.charCodeAt(0),
  sentences: sentenceSimps ? [{ zh: sentenceSimps.join(''), src: `s:${id}` }] : [],
});

describe('scheduleUnits (§2)', () => {
  it('opens a topic unit whose every word is that topic (literal membership)', () => {
    const words = [
      w('n1', '一', 1), w('n2', '二', 1), w('n3', '三', 1), w('n4', '四', 1),
      w('a1', '猫', 1), w('a2', '狗', 1), w('a3', '鸟', 1), w('a4', '鱼', 1),
    ];
    const home = { n1: 'numbers', n2: 'numbers', n3: 'numbers', n4: 'numbers', a1: 'animals', a2: 'animals', a3: 'animals', a4: 'animals' };
    const { units } = scheduleUnits(words, words, { home, core: [], seedOrder: [], unitSize: 22, cohesion: 3 });

    const numbers = units.find((u) => u.topic === 'numbers');
    const animals = units.find((u) => u.topic === 'animals');
    expect(numbers.wordIds.sort()).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(animals.wordIds.sort()).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  it('introduces high-demand function words in a "core" unit to unblock topics', () => {
    // Four number words all need 有; 有 is core. It must be introduced before they are ready.
    const words = [
      w('c', '有', 1), // core, appears in every number sentence
      w('n1', '一', 1, ['我', '有', '一']),
      w('n2', '二', 1, ['我', '有', '二']),
      w('n3', '三', 1, ['我', '有', '三']),
    ];
    const home = { n1: 'numbers', n2: 'numbers', n3: 'numbers' };
    const { units } = scheduleUnits(words, words, {
      home, core: ['c'], seedOrder: ['我'], unitSize: 22, cohesion: 2,
    });
    const coreUnit = units.find((u) => u.topic === 'core' && u.wordIds.includes('c'));
    const numbersUnit = units.find((u) => u.topic === 'numbers');
    expect(coreUnit).toBeTruthy();
    // 有 (core) is introduced before the numbers unit that depends on it.
    expect(units.indexOf(coreUnit)).toBeLessThan(units.indexOf(numbersUnit));
    expect(numbersUnit.wordIds.sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('places every scope word exactly once', () => {
    const words = Array.from({ length: 30 }, (_, i) => w(`w${i}`, String.fromCharCode(0x4e00 + i), 1));
    const home = Object.fromEntries(words.map((x, i) => [x.id, i % 2 ? 'food' : 'verbs']));
    const { units, order } = scheduleUnits(words, words, { home, core: [], seedOrder: [], unitSize: 22, cohesion: 3 });
    const placed = units.flatMap((u) => u.wordIds);
    expect(new Set(placed).size).toBe(words.length);
    expect(new Set(placed)).toEqual(new Set(words.map((x) => x.id)));
    expect(order).toHaveLength(words.length);
  });

  it('is deterministic — same inputs, identical schedule', () => {
    const words = Array.from({ length: 20 }, (_, i) => w(`w${i}`, String.fromCharCode(0x4e00 + i), (i % 3) + 1));
    const home = Object.fromEntries(words.map((x, i) => [x.id, ['numbers', 'food', 'verbs'][i % 3]]));
    const opts = { home, core: [], seedOrder: [], unitSize: 22, cohesion: 3 };
    expect(JSON.stringify(scheduleUnits(words, words, opts))).toBe(JSON.stringify(scheduleUnits(words, words, opts)));
  });

  it('teaches an ordered topic as one whole sequence, not a readiness-shuffled subset', () => {
    // Numbers, in value order, but 三/四 are gated behind a core word so they are NOT "ready"
    // when the topic opens. An ordered topic must still teach the WHOLE sequence, in order.
    const words = [
      w('n0', '零', 1), w('n1', '一', 1), w('n2', '二', 1),
      w('n3', '三', 1, ['本', '三']), w('n4', '四', 1, ['本', '四']),
      w('n5', '五', 1), w('n6', '六', 1),
    ];
    const orderedTopics = { numbers: ['零', '一', '二', '三', '四', '五', '六'] };
    const home = Object.fromEntries(words.map((x) => [x.id, 'numbers']));
    const { units } = scheduleUnits(words, words, { home, core: [], seedOrder: [], unitSize: 22, cohesion: 3, orderedTopics });

    const numberUnits = units.filter((u) => u.topic === 'numbers');
    expect(numberUnits).toHaveLength(1); // one unit, not split by readiness
    expect(numberUnits[0].wordIds).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6']); // full sequence, in order
  });

  it('returns to a topic in a later unit ("Numbers 2" means more numbers)', () => {
    // Eight numbers; four are ready immediately, four gated behind a later core word.
    const words = [
      w('n1', '一', 1), w('n2', '二', 1), w('n3', '三', 1), w('n4', '四', 1),
      w('gate', '本', 1), // core, gates the next four
      w('n5', '五', 1, ['本', '五']), w('n6', '六', 1, ['本', '六']),
      w('n7', '七', 1, ['本', '七']), w('n8', '八', 1, ['本', '八']),
    ];
    const home = { n1: 'numbers', n2: 'numbers', n3: 'numbers', n4: 'numbers', n5: 'numbers', n6: 'numbers', n7: 'numbers', n8: 'numbers' };
    const { units } = scheduleUnits(words, words, { home, core: ['gate'], seedOrder: [], unitSize: 4, cohesion: 3 });
    const numberUnits = units.filter((u) => u.topic === 'numbers');
    expect(numberUnits.length).toBeGreaterThanOrEqual(2); // came back for more numbers
    for (const u of numberUnits) for (const id of u.wordIds) expect(id.startsWith('n')).toBe(true);
  });
});

/* ── Tiny-unit merging (Phase 12) ────────────────────────── */

describe('mergeTiny (§12)', () => {
  const unit = (topic, ...wordIds) => ({ topic, wordIds });

  it('preserves the flattened word order EXACTLY — this is what keeps the §3 floors valid', () => {
    // The intro-quality floors are measured over the flattened introduction order. Merging may
    // only move unit BOUNDARIES; if it ever reordered a word the floors would silently shift.
    const units = [
      unit('food', 'a', 'b', 'c', 'd', 'e', 'f'),
      unit('food', 'g'),
      unit('verbs', 'h', 'i'),
      unit('verbs', 'j', 'k', 'l', 'm', 'n', 'o'),
    ];
    const before = units.flatMap((u) => u.wordIds);
    const after = mergeTiny(units, { minSize: 5, unitSize: 22 }).flatMap((u) => u.wordIds);
    expect(after).toEqual(before);
  });

  it('folds a straggler into its same-topic neighbour', () => {
    const merged = mergeTiny([
      unit('food', 'a', 'b', 'c', 'd', 'e'),
      unit('food', 'f'), // the straggler
      unit('verbs', 'g', 'h', 'i', 'j', 'k'),
    ], { minSize: 5, unitSize: 22 });

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ topic: 'food', wordIds: ['a', 'b', 'c', 'd', 'e', 'f'] });
    expect(merged[0].mixed).toBeUndefined(); // same topic, so not a mixed merge
  });

  it('marks a cross-topic merge so it can be titled honestly', () => {
    const merged = mergeTiny([
      unit('food', 'a', 'b', 'c', 'd', 'e'),
      unit('colors', 'f'), // no same-topic neighbour
    ], { minSize: 5, unitSize: 22 });

    expect(merged).toHaveLength(1);
    expect(merged[0].mixed).toBe(true);
    expect(merged[0].topics).toEqual(['food', 'colors']);
  });

  it('never exceeds unitSize, leaving a straggler alone rather than overfilling', () => {
    const merged = mergeTiny([
      unit('food', ...Array.from({ length: 22 }, (_, i) => `a${i}`)),
      unit('food', 'x'),
    ], { minSize: 5, unitSize: 22 });

    expect(merged).toHaveLength(2); // nothing fits, so the small unit survives honestly
    expect(merged[1].wordIds).toEqual(['x']);
  });

  it('never merges into or out of an ordered topic (the whole-sequence rule)', () => {
    const isOrdered = (t) => t === 'numbers';
    const merged = mergeTiny([
      unit('numbers', 'n1', 'n2', 'n3', 'n4', 'n5'),
      unit('food', 'f'),
    ], { minSize: 5, unitSize: 22, isOrdered });

    expect(merged).toHaveLength(2); // the food straggler may not dissolve into Numbers
    expect(merged[0].wordIds).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
  });

  it('is a no-op when minSize is 0 (opt-in), and is deterministic', () => {
    const units = [unit('food', 'a'), unit('verbs', 'b', 'c')];
    expect(mergeTiny(units, { minSize: 0 })).toBe(units);
    const opts = { minSize: 5, unitSize: 22 };
    expect(JSON.stringify(mergeTiny(units, opts))).toBe(JSON.stringify(mergeTiny(units, opts)));
  });
});
