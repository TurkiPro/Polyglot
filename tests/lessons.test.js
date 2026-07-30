/**
 * Lesson cutting (Phase 12): a unit's words become sittings.
 *
 * The defect this fixes: the syllabus listed every step, so a "lesson" was one card and counting
 * split across units — 零 二 两 六 七 in one place, 一 三 四 五 in another. A lesson must be a
 * coherent sitting, and an authored group like "Counting to ten" must survive whole.
 */
import { describe, expect, it } from 'vitest';
import { indexGroups, planLessons } from '../packs/zh/lib/lessons.js';

const ids = (lessons) => lessons.map((l) => l.wordIds);
const titles = (lessons) => lessons.map((l) => l.title);

describe('indexGroups', () => {
  const bySimp = new Map([['一', { id: 'w1' }], ['二', { id: 'w2' }]]);

  it('resolves spellings to word ids and reports the ones the deck lacks', () => {
    const { groups, unresolved } = indexGroups(
      { groups: [{ title: 'Counting', words: ['一', '二', '缺'] }] },
      bySimp,
    );
    expect(groups).toEqual([{ title: 'Counting', wordIds: ['w1', 'w2'] }]);
    expect(unresolved).toEqual(['Counting:缺']); // reported, never thrown
  });

  it('survives a missing or empty file', () => {
    expect(indexGroups(undefined, bySimp).groups).toEqual([]);
    expect(indexGroups({ groups: [] }, bySimp).groups).toEqual([]);
  });
});

describe('planLessons', () => {
  it('chunks unauthored words at the target size', () => {
    const words = Array.from({ length: 25 }, (_, i) => `w${i}`);
    const { lessons } = planLessons(words, [], { target: 10 });
    expect(ids(lessons).map((l) => l.length)).toEqual([10, 10, 5]);
    expect(titles(lessons)).toEqual([undefined, undefined, undefined]); // no invented names
  });

  it('keeps an authored group whole, even past the target', () => {
    // The case the maintainer caught: counting must not split.
    const words = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '百', '千'];
    const groups = [{ title: 'Counting to ten', wordIds: words.slice(0, 11) }];
    const { lessons } = planLessons(words, groups, { target: 10 });

    expect(lessons[0].title).toBe('Counting to ten');
    expect(lessons[0].wordIds).toHaveLength(11); // 11 > target 10, kept whole anyway
    expect(lessons[1].wordIds).toEqual(['百', '千']);
  });

  it('places every word exactly once, never losing or duplicating one', () => {
    const words = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const groups = [{ title: 'Middle', wordIds: ['c', 'd'] }];
    const { lessons } = planLessons(words, groups, { target: 3 });

    const flat = lessons.flatMap((l) => l.wordIds);
    expect(flat).toHaveLength(words.length);
    expect(new Set(flat)).toEqual(new Set(words));
  });

  it('keeps every lesson contiguous instead of stranding one-word fragments', () => {
    // Extracting 'c','e' in place would leave [a,b] [c] [d] [e] [f] — the one-card-per-lesson
    // problem this exists to end. Gathering first yields two whole lessons.
    const words = ['a', 'b', 'c', 'd', 'e', 'f'];
    const groups = [{ title: 'Scattered', wordIds: ['c', 'e'] }];
    const { lessons } = planLessons(words, groups, { target: 10 });

    expect(lessons).toHaveLength(2);
    expect(lessons.every((l) => l.wordIds.length >= 2)).toBe(true);
    expect(lessons.find((l) => l.title === 'Scattered').wordIds).toEqual(['c', 'e']);
  });

  it('applies a group partially when the unit holds only some of it, and reports the split', () => {
    // Units are cut by readiness, so a semantic group often lands across two of them. Half a
    // group here is still worth grouping — refusing it would throw the semantics away entirely.
    const { lessons, split } = planLessons(['a', 'b', 'x'], [{ title: 'Family', wordIds: ['a', 'b', 'z'] }], { target: 10 });
    expect(split).toEqual(['Family']);
    expect(lessons.find((l) => l.title === 'Family').wordIds).toEqual(['a', 'b']);
  });

  it('ignores a group with only one member here, so a stray word never names a lesson', () => {
    const { lessons, split } = planLessons(['a', 'x', 'y'], [{ title: 'Lonely', wordIds: ['a', 'z'] }], { target: 10 });
    expect(split).toEqual([]);
    expect(titles(lessons)).toEqual([undefined]);
  });

  it('refuses a group far past the target rather than making a monster lesson', () => {
    const words = Array.from({ length: 20 }, (_, i) => `w${i}`);
    const { lessons } = planLessons(words, [{ title: 'Huge', wordIds: words }], { target: 10 });
    expect(titles(lessons)).toEqual([undefined, undefined]);
    expect(ids(lessons).map((l) => l.length)).toEqual([10, 10]);
  });

  it('is deterministic', () => {
    const words = ['a', 'b', 'c', 'd', 'e'];
    const groups = [{ title: 'G', wordIds: ['b', 'c'] }];
    const once = JSON.stringify(planLessons(words, groups, { target: 2 }));
    expect(JSON.stringify(planLessons(words, groups, { target: 2 }))).toBe(once);
  });
});
