/**
 * A lesson sitting (Phase 9 §3): `#lesson/:unit`.
 *
 * Teach screens for the unit's next few unintroduced words (the unchanged Phase 7 flow),
 * interleaved with a couple of exercises over words already met. Introducing a word is a
 * real REC review, so it counts against the daily new-card cap and ramp — the course paces
 * THROUGH the evidence-based limits, never around them. When the cap is spent the sitting
 * says so warmly and offers practice or review instead.
 */
import { config } from '../../../config/app.config.js';
import {
  countNewToday, activeDays, recordPractice, recordReview, store,
} from '../store.js';
import { rampedNewCards } from '../engine/queue.js';
import { generate, hashSeed, makeRng, prepareExercises } from '../engine/exercises.js';
import { introducedSet, metWords, unintroduced } from '../engine/coursestate.js';
import { button, div, h, p, replace, sealMark, span } from '../ui/components.js';
import { stage } from '../ui/arcade.js';
import { glossify } from '../ui/tooltip.js';
import { strings } from '../ui/strings.js';
import { renderBack } from './card.js';
import { renderTeach } from './teach.js';
import { renderExercise } from './exercise.js';

const s = strings.lesson;
const EXERCISE_TYPES = ['MCQ_MEANING', 'MCQ_AUDIO', 'TYPE_PINYIN', 'CLOZE', 'REORDER', 'MATCH'];

/** New cards still allowed today, after the ramp and what has already been introduced. */
function remainingNewToday(now = Date.now()) {
  const cap = rampedNewCards(activeDays(), store.settings.newPerDay, store.settings.newPerDayExplicit === true);
  return Math.max(0, cap - countNewToday(now));
}

export function renderLesson(root, ctx, unitArg) {
  const unit = store.course?.units.find((u) => u.id === unitArg);
  if (!unit) return void ctx.navigate('#course');

  const introduced = introducedSet(store.states);
  const pending = unintroduced(unit, introduced);
  const met = metWords(unit, introduced).map((id) => store.deck.word(id)).filter(Boolean);
  const remaining = remainingNewToday();
  const take = Math.min(config.course.lessonWords, pending.length, remaining);

  // Nothing left to teach in this unit: it is ready for its checkpoint.
  if (pending.length === 0) {
    return finishScreen(root, ctx, unit, 'ready');
  }
  // The daily new-card budget is spent: pace through the limit, not around it.
  if (take === 0) {
    return cappedScreen(root, ctx, unit, met);
  }

  const words = pending.slice(0, take).map((id) => store.deck.word(id)).filter(Boolean);
  runSitting(root, ctx, unit, words, met);
}

/** Build and run the interleaved sequence of teach → intro card, with exercises between. */
function runSitting(root, ctx, unit, words, met) {
  const host = div({ class: 'lesson' });
  replace(root, stage('lesson', [
    div({ class: 'lesson-head' }, [
      button(s.leave, () => ctx.navigate('#course'), { variant: 'btn-quiet lesson-leave' }),
      h(1, unit.title, 'lesson-title'),
      unit.note ? noteBlock(unit.note) : null,
    ].filter(Boolean)),
    host,
  ].filter(Boolean)));

  // Exercises draw distractors from the whole deck (same-band confusables) and only test
  // words already met; a seed per unit + sitting keeps a given sitting reproducible.
  const exerciseCtx = prepareExercises(store.deck.words);
  const known = new Set([...introducedSet(store.states)].map((id) => store.deck.word(id)?.simp).filter(Boolean));
  const rng = makeRng(hashSeed(`${unit.id}:${store.events.length}`));
  const metPool = met.length ? met : [];

  // Sequence: teach, intro, [exercise every couple of words], … then done. Each step is a
  // function taking the `next` callback (async ones await their own work before calling it).
  const steps = [];
  words.forEach((word, i) => {
    steps.push(teachStep(host, word));
    steps.push(introStep(host, word));
    if (metPool.length && (i % 2 === 1 || i === words.length - 1)) {
      steps.push(exerciseStep(host, unit, metPool, exerciseCtx, known, rng));
    }
  });

  let index = 0;
  const next = () => {
    if (index >= steps.length) return finishScreen(root, ctx, unit, 'done', words.length);
    steps[index++](next);
  };
  next();
}

/**
 * The unit's pattern note (feedback #4): labelled so it reads as an observation about this
 * unit's sentences, not a stray line, and its characters are hoverable for pinyin + meaning.
 */
function noteBlock(note) {
  const body = p('', 'lesson-note-text');
  body.append(glossify(note));
  return div({ class: 'lesson-note' }, [span({ class: 'lesson-note-label', text: s.patternLabel }), body]);
}

/** The teach screen — unchanged Phase 7 flow, its "Got it" advances the sitting. */
function teachStep(host, word) {
  return (done) => replace(host, renderTeach(word, done));
}

/** Introducing the word: a real REC review, so it counts against the cap. */
function introStep(host, word) {
  return async (done) => {
    const card = div({ class: 'lesson-card' });
    const front = div({ class: 'lesson-front' }, [
      div({ class: 'hanzi lesson-hanzi', text: word.simp }),
      button(strings.review.show, reveal, { variant: 'btn-primary btn-wide' }),
    ]);
    replace(host, div({ class: 'lesson-intro' }, [p(s.recall, 'muted'), card]));
    replace(card, front);

    function reveal() {
      const back = renderBack({ mode: 'REC', word });
      const grades = div({ class: 'lesson-grades' },
        [['again', 1], ['hard', 2], ['good', 3], ['easy', 4]].map(([key, rating]) =>
          button(strings.review[key], () => grade(rating), { variant: `btn-${key}` })));
      replace(card, div({ class: 'lesson-back' }, [back, grades]));
    }
    async function grade(rating) {
      await recordReview({ cardId: `${word.id}#REC`, rating });
      done();
    }
  };
}

/** One interleaved exercise over already-met words; the result logs a practice event. */
function exerciseStep(host, unit, metPool, ctx, known, rng) {
  return async (done) => {
    let item = null;
    for (const type of shuffleTypes(rng)) {
      item = generate(type, { candidates: metPool, ctx, rng, known });
      if (item) break;
    }
    if (!item) return done(); // nothing buildable from the met pool yet
    replace(host, renderExercise(item, async (correct) => {
      await recordPractice({ unitId: unit.id, type: item.type, wordId: item.wordId ?? item.answer?.[0] ?? unit.id, correct });
      done();
    }));
  };
}

const shuffleTypes = (rng) => [...EXERCISE_TYPES].sort(() => rng() - 0.5);

/** The cap-spent screen: warm, and it points at what the learner CAN still do. */
function cappedScreen(root, ctx, unit, met) {
  const actions = div({ class: 'welcome-choices' }, [
    met.length ? button(s.practiceUnit, () => practiceOnly(root, ctx, unit, met), { variant: 'btn-primary btn-cta' }) : null,
    button(s.doReviews, () => ctx.navigate('#review'), { variant: 'btn-quiet' }),
    button(s.backToPath, () => ctx.navigate('#course'), { variant: 'btn-quiet' }),
  ].filter(Boolean));
  replace(root, stage('lesson', [
    div({ class: 'lesson-done' }, [
      sealMark(80),
      h(1, s.cappedTitle, 'lesson-title'),
      p(s.cappedBody, 'welcome-lead'),
      actions,
    ]),
  ]));
}

/** Pure practice (no new words): a short run of exercises over met words. */
function practiceOnly(root, ctx, unit, met) {
  const host = div({ class: 'lesson' });
  replace(root, stage('lesson', [
    div({ class: 'lesson-head' }, [
      button(s.leave, () => ctx.navigate('#course'), { variant: 'btn-quiet lesson-leave' }),
      h(1, unit.title, 'lesson-title'),
    ]),
    host,
  ]));
  const exerciseCtx = prepareExercises(store.deck.words);
  const known = new Set([...introducedSet(store.states)].map((id) => store.deck.word(id)?.simp).filter(Boolean));
  const rng = makeRng(hashSeed(`${unit.id}:practice:${store.practice.length}`));
  let n = 0;
  const next = () => {
    if (n >= 6) return finishScreen(root, ctx, unit, 'practice');
    n += 1;
    exerciseStep(host, unit, met, exerciseCtx, known, rng)(next);
  };
  next();
}

/** The end of a sitting: what happened, and the two ways onward. */
function finishScreen(root, ctx, unit, kind, taught = 0) {
  const introduced = introducedSet(store.states);
  const left = unintroduced(unit, introduced).length;
  const allIn = left === 0;

  const lines = {
    done: taught ? s.taught(taught) : s.nothingNew,
    practice: s.practiceDone,
    ready: s.unitReady,
  }[kind] ?? '';

  const actions = div({ class: 'welcome-choices' }, [
    allIn
      ? button(s.checkpoint, () => ctx.navigate(`#quiz/${unit.id}`), { variant: 'btn-primary btn-cta' })
      : button(s.keepGoing, () => ctx.navigate(`#lesson/${unit.id}`), { variant: 'btn-primary btn-cta' }),
    button(s.backToPath, () => ctx.navigate('#course'), { variant: 'btn-quiet' }),
  ]);

  replace(root, stage('lesson', [
    div({ class: 'lesson-done' }, [
      sealMark(96),
      h(1, allIn ? s.unitReady : s.sittingDone, 'lesson-title'),
      p(lines, 'welcome-lead'),
      allIn ? p(s.checkpointHint, 'muted') : p(s.leftToGo(left), 'muted'),
      actions,
    ]),
  ]));
}
