/**
 * @vitest-environment jsdom
 *
 * Course progress derivation (Phase 9 §3–4) and the exercise views (§2). The pure course
 * state is proven here; the lesson/checkpoint orchestration is a manual checklist (§6).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  clearedSets,
  courseProgress,
  introducedSet,
  metWords,
  unintroduced,
} from '../app/src/engine/coursestate.js';
import { generate, prepareExercises } from '../app/src/engine/exercises.js';
import { renderExercise } from '../app/src/views/exercise.js';

const units = [
  { id: 'u001', title: 'One', band: 1, wordIds: ['a', 'b', 'c'] },
  { id: 'u002', title: 'Two', band: 1, wordIds: ['d', 'e'] },
  { id: 'u003', title: 'Three', band: 4, wordIds: ['f', 'g'] },
];

/** A states map like replay produces: cardId → { wordId, reps }. */
function states(recWords) {
  const map = new Map();
  for (const [wordId, reps] of Object.entries(recWords)) {
    map.set(`${wordId}#REC`, { wordId, reps });
  }
  return map;
}

describe('introducedSet (§9.3)', () => {
  it('counts a word met only once its REC card has been graded', () => {
    const set = introducedSet(states({ a: 3, b: 0, c: 1 }));
    expect(set).toEqual(new Set(['a', 'c'])); // b has reps 0 — taught screen but never graded
  });
});

describe('courseProgress (§9.3)', () => {
  it('assigns a status per unit and points at the earliest unfinished one', () => {
    const introduced = new Set(['a', 'b', 'c', 'd']); // u001 all, u002 partial
    const { rows, currentId } = courseProgress(units, { introduced });
    expect(rows[0].status).toBe('checkpoint'); // u001 fully introduced, not yet cleared
    expect(rows[1].status).toBe('started'); // u002 partial
    expect(rows[2].status).toBe('locked'); // u003 untouched
    expect(currentId).toBe('u001'); // earliest not cleared
  });

  it('advances the current unit past cleared ones', () => {
    const introduced = new Set(['a', 'b', 'c', 'd', 'e']);
    const cleared = new Set(['u001']);
    const gold = new Set(['u001']);
    const { rows, currentId } = courseProgress(units, { introduced, cleared, gold });
    expect(rows[0].status).toBe('gold');
    expect(currentId).toBe('u002'); // u001 is cleared, so we move on
  });

  it('reads cleared/gold from checkpoint practice events (§9.4)', () => {
    const events = [
      { type: 'MCQ_MEANING', unitId: 'u001', wordId: 'a', correct: 1 },
      { type: 'CHECKPOINT', unitId: 'u001', wordId: 'u001', correct: 1 },
      { type: 'CHECKPOINT_GOLD', unitId: 'u002', wordId: 'u002', correct: 1 },
    ];
    const { cleared, gold } = clearedSets(events);
    expect(cleared).toEqual(new Set(['u001', 'u002'])); // gold implies cleared
    expect(gold).toEqual(new Set(['u002']));
  });

  it('lists a unit’s unintroduced and met words in order', () => {
    const introduced = new Set(['a', 'c']);
    expect(unintroduced(units[0], introduced)).toEqual(['b']);
    expect(metWords(units[0], introduced)).toEqual(['a', 'c']);
  });
});

/* ── Exercise views ─────────────────────────────────────── */

const WORDS = [
  { id: 'zh:我:wo3', simp: '我', pinyin: 'wǒ', pinyinNum: 'wo3', defs: ['I, me'], band: 1 },
  { id: 'zh:你:ni3', simp: '你', pinyin: 'nǐ', pinyinNum: 'ni3', defs: ['you'], band: 1 },
  { id: 'zh:他:ta1', simp: '他', pinyin: 'tā', pinyinNum: 'ta1', defs: ['he'], band: 1 },
  { id: 'zh:是:shi4', simp: '是', pinyin: 'shì', pinyinNum: 'shi4', defs: ['to be'], band: 1 },
  { id: 'zh:好:hao3', simp: '好', pinyin: 'hǎo', pinyinNum: 'hao3', defs: ['good'], band: 1 },
];
const ctx = prepareExercises(WORDS);

describe('renderExercise (§9.2)', () => {
  it('MCQ: a right pick shows correct feedback and calls back with true', () => {
    const item = generate('MCQ_MEANING', { candidates: [ctx.byId.get('zh:我:wo3')], ctx, rng: () => 0.4 });
    const onDone = vi.fn();
    const node = renderExercise(item, onDone);
    document.body.append(node);

    node.querySelector(`[data-id="${item.answer}"]`).click();
    expect(node.querySelector('.exercise-feedback.ok')).toBeTruthy();
    node.querySelector('.exercise-feedback button').click();
    expect(onDone).toHaveBeenCalledWith(true);
    node.remove();
  });

  it('MCQ: the choices are a labelled group of real buttons (a11y, F7)', () => {
    const item = generate('MCQ_MEANING', { candidates: [ctx.byId.get('zh:我:wo3')], ctx, rng: () => 0.4 });
    const node = renderExercise(item, vi.fn());

    const group = node.querySelector('.exercise-options');
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBeTruthy();
    const choices = [...group.children];
    expect(choices.length).toBeGreaterThan(1);
    // Real <button>s are keyboard-operable natively — no custom key handling to get wrong.
    expect(choices.every((c) => c.tagName === 'BUTTON')).toBe(true);
  });

  it('MCQ: a wrong pick shows the answer and calls back with false', () => {
    const item = generate('MCQ_MEANING', { candidates: [ctx.byId.get('zh:好:hao3')], ctx, rng: () => 0.7 });
    const onDone = vi.fn();
    const node = renderExercise(item, onDone);
    document.body.append(node);

    const wrong = item.options.find((o) => o.id !== item.answer).id;
    node.querySelector(`[data-id="${wrong}"]`).click();
    expect(node.querySelector('.exercise-feedback.bad')).toBeTruthy();
    node.querySelector('.exercise-feedback button').click();
    expect(onDone).toHaveBeenCalledWith(false);
    node.remove();
  });

  it('TYPE_PINYIN accepts the reading through the PROD normalizer', () => {
    const item = generate('TYPE_PINYIN', { candidates: [ctx.byId.get('zh:你:ni3')], ctx, rng: () => 0.1 });
    const onDone = vi.fn();
    const node = renderExercise(item, onDone);
    document.body.append(node);

    const input = node.querySelector('.exercise-input');
    input.value = 'NI3';
    node.querySelector('button').click(); // Check
    expect(node.querySelector('.exercise-feedback.ok')).toBeTruthy();
    node.remove();
  });
});
