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
  grandfatheredClears,
  introducedFromEvents,
  introducedSet,
  metWords,
  unintroduced,
} from '../app/src/engine/coursestate.js';
import { generate, prepareExercises } from '../app/src/engine/exercises.js';
import { renderExercise } from '../app/src/views/exercise.js';

/** Units with steps[] like the pipeline emits: a WORD per word, then a CHECKPOINT. */
function unit(id, band, wordIds) {
  return { id, title: id, band, wordIds, steps: [...wordIds.map((w) => ({ kind: 'WORD', wordId: w })), { kind: 'CHECKPOINT' }] };
}
const units = [unit('u001', 1, ['a', 'b', 'c']), unit('u002', 1, ['d', 'e']), unit('u003', 4, ['f', 'g'])];
const course = { units };

/** A states map like replay produces: cardId → { wordId, reps }. */
function states(recWords) {
  const map = new Map();
  for (const [wordId, reps] of Object.entries(recWords)) {
    map.set(`${wordId}#REC`, { wordId, reps });
  }
  return map;
}

/** REC events for a set of words, like the review log holds. */
const recEvents = (...wordIds) => wordIds.map((w) => ({ cardId: `${w}#REC`, rating: 3, ts: 1 }));

describe('introducedSet (§9.3)', () => {
  it('counts a word met only once its REC card has been graded', () => {
    const set = introducedSet(states({ a: 3, b: 0, c: 1 }));
    expect(set).toEqual(new Set(['a', 'c'])); // b has reps 0 — taught screen but never graded
  });

  it('reads the same introductions straight from the event log (A3)', () => {
    expect(introducedFromEvents(recEvents('a', 'c'))).toEqual(new Set(['a', 'c']));
    // A practice event has no cardId, so it can never be mistaken for an introduction.
    expect(introducedFromEvents([{ unitId: 'u001', type: 'MCQ_MEANING' }])).toEqual(new Set());
  });
});

describe('courseProgress (§10 A3)', () => {
  it('assigns a status per unit and makes a fully-taught unit\'s checkpoint current', () => {
    const events = recEvents('a', 'b', 'c'); // all of u001, none beyond
    const { rows, currentId, current } = courseProgress({}, course, events, []);
    expect(rows[0].status).toBe('checkpoint'); // u001 fully introduced, not yet cleared
    expect(rows[1].status).toBe('locked'); // u002 untouched
    expect(rows[2].status).toBe('locked'); // u003 untouched
    expect(currentId).toBe('u001');
    expect(current).toEqual({ unitId: 'u001', index: 3 }); // its checkpoint step
  });

  it('marks a fully-taught but un-taken checkpoint skipped once the next unit is begun', () => {
    // u001 fully introduced, u002 started — the u001 checkpoint was leapfrogged.
    const { rows, currentId } = courseProgress({}, course, recEvents('a', 'b', 'c', 'd'), []);
    expect(rows[0].steps.at(-1).state).toBe('skipped'); // its checkpoint, jumped past
    expect(rows[1].status).toBe('started');
    expect(currentId).toBe('u002'); // focus is where the learner actually is
  });

  it('advances the current unit past cleared ones', () => {
    const events = recEvents('a', 'b', 'c', 'd', 'e');
    const practice = [{ type: 'CHECKPOINT_GOLD', unitId: 'u001', wordId: 'u001', correct: 1 }];
    const { rows, currentId } = courseProgress({}, course, events, practice);
    expect(rows[0].status).toBe('gold');
    expect(currentId).toBe('u002'); // u001 cleared, so its checkpoint moves on
  });

  it('resolves each step to a state, marks jumped-past steps skipped, locks unmet checkpoints', () => {
    // Introduced a and c but not b — b was jumped past, so the frontier is at c.
    const { rows, current } = courseProgress({}, course, recEvents('a', 'c'), []);
    // steps: WORD a, WORD b, WORD c, CHECKPOINT
    expect(rows[0].steps.map((s) => s.state)).toEqual(['done', 'skipped', 'done', 'locked']);
    // The checkpoint can't be current (b unmet ⇒ locked), so current advances to u002's first word.
    expect(current).toEqual({ unitId: 'u002', index: 0 });
    expect(rows[1].steps.map((s) => s.state)).toEqual(['current', 'upcoming', 'locked']);
  });

  it('reports per-unit and overall percentages from the step states', () => {
    // u001 fully introduced + cleared → all 4 steps done; nothing else.
    const events = recEvents('a', 'b', 'c');
    const practice = [{ type: 'CHECKPOINT', unitId: 'u001', wordId: 'u001', correct: 1 }];
    const { rows, overall } = courseProgress({}, course, events, practice);
    expect(rows[0].percent).toBe(100);
    expect(rows[1].percent).toBe(0);
    // 4 of (4 + 3 + 3) steps done.
    expect(overall).toEqual({ percent: Math.round((4 / 10) * 100), done: 4, total: 10 });
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

  // Unit 0 "The Sounds" (Phase 10 B): a wordless unit whose only anchor is its checkpoint.
  const sounds = {
    id: 'u000', title: 'The Sounds', band: 0, sounds: true, wordIds: [],
    steps: [{ kind: 'TONES', set: 'intro' }, { kind: 'PINYIN' }, { kind: 'CHECKPOINT' }],
  };
  const withSounds = { units: [sounds, ...units] };

  it('starts a fresh account at Unit 0, step 0 (the course begins with the sounds)', () => {
    const { current, currentId } = courseProgress({}, withSounds, [], []);
    expect(currentId).toBe('u000');
    expect(current).toEqual({ unitId: 'u000', index: 0 });
  });

  // Phase 11 §4: unit ids/membership changed, so a learner who cleared "old-u07" must still see
  // the NEW unit(s) covering those same words as cleared — grandfathered from word-level practice.
  it('grandfathers a clear onto the new unit covering the old unit\'s words', () => {
    const oldWords = ['a', 'b', 'c', 'd', 'e'];
    // The old checkpoint logged per-item practice over those words (all correct) plus a summary
    // for the OLD unit id — which names no current unit.
    const history = [
      { type: 'CHECKPOINT', unitId: 'u07-OLD', wordId: 'u07-OLD', correct: 1 },
      ...oldWords.map((w, i) => ({ id: `p${i}`, unitId: 'u07-OLD', type: 'MCQ_MEANING', wordId: w, correct: 1, ts: i })),
    ];
    // The new course re-cut those words into a different unit id.
    const newCourse = { units: [unit('u031', 1, oldWords)] };
    const { rows } = courseProgress({}, newCourse, recEvents(...oldWords), history);
    expect(rows[0].status).toBe('gold'); // 100% accuracy ⇒ gold, and therefore cleared
    expect(rows[0].steps.at(-1).state).toBe('done'); // its checkpoint reads as passed
  });

  it('grandfathers only with pass-level coverage and accuracy', () => {
    const words = ['a', 'b', 'c', 'd', 'e'];
    // Two words practised, three untouched → 40% coverage, below QUIZ_PASS. Not cleared.
    const thin = [
      { id: 'p1', unitId: 'x', type: 'CLOZE', wordId: 'a', correct: 1, ts: 1 },
      { id: 'p2', unitId: 'x', type: 'CLOZE', wordId: 'b', correct: 1, ts: 2 },
    ];
    expect(grandfatheredClears([unit('u1', 1, words)], thin).cleared.size).toBe(0);

    // Full coverage but sloppy accuracy (3/5) → below QUIZ_PASS. Not cleared.
    const sloppy = words.map((w, i) => ({ id: `q${i}`, unitId: 'x', type: 'CLOZE', wordId: w, correct: i < 3 ? 1 : 0, ts: i }));
    expect(grandfatheredClears([unit('u1', 1, words)], sloppy).cleared.size).toBe(0);
  });

  /* ── Lessons: the sittings the syllabus lists (Phase 12) ── */

  const lessonUnit = {
    id: 'u050', title: 'Numbers', band: 1, wordIds: ['a', 'b', 'c', 'd'],
    steps: [
      { kind: 'WORD', wordId: 'a' }, { kind: 'WORD', wordId: 'b' }, { kind: 'PRACTICE' },
      { kind: 'WORD', wordId: 'c' }, { kind: 'WORD', wordId: 'd' },
      { kind: 'CHECKPOINT' },
    ],
    lessons: [{ title: 'Counting', from: 0, to: 3 }, { from: 3, to: 5 }],
  };

  it('folds step states into a lesson state, leaving the checkpoint outside every span', () => {
    // a, b and c introduced: lesson 1 (a, b + its closing practice) is behind the frontier.
    const { rows } = courseProgress({}, { units: [lessonUnit] }, recEvents('a', 'b', 'c'), []);
    const [first, second] = rows[0].lessons;

    expect(first.title).toBe('Counting');
    expect(first.state).toBe('done');
    expect(first.done).toBe(2);
    expect(first.total).toBe(2);
    expect(second.state).toBe('current'); // the frontier sits here
    // No lesson contains the checkpoint — it is always its own row.
    expect(rows[0].lessons.flatMap((l) => l.steps).some((s) => s.kind === 'CHECKPOINT')).toBe(false);
  });

  it('keeps a lesson current until its closing practice set is done, not just its words', () => {
    // Both words met, but the PRACTICE that closes the lesson is still ahead.
    const { rows } = courseProgress({}, { units: [lessonUnit] }, recEvents('a', 'b'), []);
    expect(rows[0].lessons[0].state).toBe('current');
    expect(rows[0].lessons[0].done).toBe(2); // its words are done…
    expect(rows[0].lessons[0].steps.at(-1).state).toBe('current'); // …its practice is not
  });

  it('reports a part-done lesson as current, so a capped sitting resumes there', () => {
    // 'a' introduced but not 'b' — the learner's day ran out mid-lesson.
    const { rows, currentLessonIndex } = courseProgress({}, { units: [lessonUnit] }, recEvents('a'), []);
    expect(rows[0].lessons[0].state).toBe('current');
    expect(rows[0].lessons[0].done).toBe(1);
    expect(rows[0].lessons[0].total).toBe(2);
    expect(currentLessonIndex).toBe(0);
  });

  it('keeps `current` exactly {unitId, index} — the lesson is a separate top-level fact', () => {
    const view = courseProgress({}, { units: [lessonUnit] }, recEvents('a'), []);
    expect(view.current).toEqual({ unitId: 'u050', index: 1 });
    expect(view.currentLessonIndex).toBe(0);
  });

  it('falls back to one span for a unit with no lessons[] (older pack, fixtures)', () => {
    const { rows } = courseProgress({}, course, recEvents('a'), []);
    expect(rows[0].lessons).toHaveLength(1);
    expect(rows[0].lessons[0].steps.some((s) => s.kind === 'CHECKPOINT')).toBe(false);
  });

  it('clears Unit 0 from its checkpoint event alone — no words involved', () => {
    const practice = [{ type: 'CHECKPOINT', unitId: 'u000', wordId: 'u000', correct: 1 }];
    const { rows, currentId } = courseProgress({}, withSounds, [], practice);
    expect(rows[0].steps.map((st) => st.state)).toEqual(['done', 'done', 'done']);
    expect(rows[0].percent).toBe(100);
    expect(currentId).toBe('u001'); // the course moves on to the first word unit
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
