/**
 * A lesson sitting (Phase 10 A2): `#lesson/:unit` or `#lesson/:unit/:stepIndex`.
 *
 * The runner walks the unit's generated `steps[]` — the ONE sequence the syllabus also reads
 * (§A1), so there is no second sequencing logic. WORD steps teach a word and take its first REC
 * review (a real review, counted against the daily new-card cap and ramp — the course paces
 * THROUGH the limits, never around them); PHRASE and PRACTICE steps run exercises over words
 * already met; CHECKPOINT hands off to the quiz. Navigation is free: the syllabus can drop you
 * at any step, and jumping past undone ones just leaves them `skipped` in the derived view.
 */
import {
  activeDays, countNewToday, courseView, recordPractice, recordReview, store,
} from '../store.js';
import { rampedNewCards } from '../engine/queue.js';
import { generate, hashSeed, makeRng, prepareExercises, shuffle } from '../engine/exercises.js';
import { introducedSet } from '../engine/coursestate.js';
import { button, div, h, p, replace, sealMark, span } from '../ui/components.js';
import { stage } from '../ui/arcade.js';
import { glossify } from '../ui/tooltip.js';
import { strings } from '../ui/strings.js';
import { renderBack } from './card.js';
import { renderTeach } from './teach.js';
import { renderExercise } from './exercise.js';
import { syllabusRail, stepStrip } from './syllabus.js';

const s = strings.lesson;
const EXERCISE_TYPES = ['MCQ_MEANING', 'MCQ_AUDIO', 'TYPE_PINYIN', 'CLOZE', 'REORDER', 'MATCH'];
const PRACTICE_SET = 3; // exercises in a PRACTICE step

/** New cards still allowed today, after the ramp and what has already been introduced. */
function remainingNewToday(now = Date.now()) {
  const cap = rampedNewCards(activeDays(), store.settings.newPerDay, store.settings.newPerDayExplicit === true);
  return Math.max(0, cap - countNewToday(now));
}

/** The met-word spellings, so exercises only draw sentences the learner can read. */
const knownSimps = () =>
  new Set([...introducedSet(store.states)].map((id) => store.deck.word(id)?.simp).filter(Boolean));

const wordIdOfItem = (item, unit) =>
  item.wordId ?? (Array.isArray(item.answer) ? item.answer[0] : undefined) ?? unit.id;

export function renderLesson(root, ctx, arg) {
  const [unitId, stepArg] = String(arg ?? '').split('/');
  const unit = store.course?.units.find((u) => u.id === unitId);
  if (!unit) return void ctx.navigate('#course');
  runStep(root, ctx, unit, resolveStart(unit, unitId, stepArg));
}

/** Where to begin: an explicit step from the syllabus, else this unit's current step, else 0. */
function resolveStart(unit, unitId, stepArg) {
  if (stepArg !== undefined && stepArg !== '') {
    const n = Number(stepArg);
    if (Number.isInteger(n) && n >= 0 && n < unit.steps.length) return n;
  }
  const row = courseView().rows.find((r) => r.id === unitId);
  const current = row?.steps.findIndex((step) => step.state === 'current') ?? -1;
  return current >= 0 ? current : 0;
}

/** Run the step at `index`, mounting the shell (rail + head + host) around it. */
function runStep(root, ctx, unit, index) {
  if (index >= unit.steps.length) return void ctx.navigate('#course');
  const step = unit.steps[index];
  if (step.kind === 'CHECKPOINT') return void ctx.navigate(`#quiz/${unit.id}`);

  const host = div({ class: 'lesson' });
  mountShell(root, ctx, unit, index, host);
  const advance = () => runStep(root, ctx, unit, index + 1);

  if (step.kind === 'WORD') return runWord(host, ctx, unit, step, advance);
  if (step.kind === 'PHRASE') return runPhrase(host, unit, step, advance);
  if (step.kind === 'PRACTICE') return runPractice(host, unit, advance);
  advance();
}

/** The two-column shell: the syllabus rail (desktop) / strip (mobile) beside the step. */
function mountShell(root, ctx, unit, index, host) {
  replace(root, stage('lesson', [
    div({ class: 'lesson-layout' }, [
      syllabusRail(ctx, unit.id),
      div({ class: 'lesson-main' }, [
        stepStrip(ctx, unit, index),
        div({ class: 'lesson-head' }, [
          button(s.leave, () => ctx.navigate('#course'), { variant: 'btn-quiet lesson-leave' }),
          h(1, unit.title, 'lesson-title'),
          unit.note ? noteBlock(unit.note) : null,
        ].filter(Boolean)),
        host,
      ]),
    ]),
  ]));
}

/**
 * A WORD step. A word already met is a quick recap (no re-grade); an unmet one teaches then
 * takes a real REC review — but only if the daily new-card budget allows, so the syllabus can
 * never bypass the cap (§A2). A spent cap ends the sitting warmly.
 */
function runWord(host, ctx, unit, step, advance) {
  const word = store.deck.word(step.wordId);
  if (!word) return advance();

  if (introducedSet(store.states).has(word.id)) {
    replace(host, renderTeach(word, advance)); // recap, ungraded
    return;
  }
  if (remainingNewToday() <= 0) return cappedScreen(host, ctx, unit);

  replace(host, renderTeach(word, () => introCard(host, word, advance)));
}

/** Introducing the word: a real REC review, so it counts against the cap. */
function introCard(host, word, advance) {
  const card = div({ class: 'lesson-card' });
  replace(host, div({ class: 'lesson-intro' }, [p(s.recall, 'muted'), card]));
  replace(card, div({ class: 'lesson-front' }, [
    div({ class: 'hanzi lesson-hanzi', text: word.simp }),
    button(strings.review.show, reveal, { variant: 'btn-primary btn-wide' }),
  ]));

  function reveal() {
    const grades = div({ class: 'lesson-grades' },
      [['again', 1], ['hard', 2], ['good', 3], ['easy', 4]].map(([key, rating]) =>
        button(strings.review[key], () => grade(rating), { variant: `btn-${key}` })));
    replace(card, div({ class: 'lesson-back' }, [renderBack({ mode: 'REC', word }), grades]));
  }
  async function grade(rating) {
    await recordReview({ cardId: `${word.id}#REC`, rating });
    advance();
  }
}

/** A PHRASE step: a reorder or cloze over the spotlighted sentence; logs a practice event. */
function runPhrase(host, unit, step, advance) {
  const word = store.deck.word(step.wordId);
  if (!word) return advance();
  const exerciseCtx = prepareExercises(store.deck.words);
  const known = knownSimps();
  const rng = makeRng(hashSeed(`${unit.id}:phrase:${step.wordId}:${store.practice.length}`));

  let item = null;
  for (const type of ['REORDER', 'CLOZE']) {
    item = generate(type, { candidates: [word], ctx: exerciseCtx, rng, known });
    if (item) break;
  }
  if (!item) return advance();
  replace(host, renderExercise(item, async (correct) => {
    await recordPractice({ unitId: unit.id, type: item.type, wordId: word.id, correct });
    advance();
  }));
}

/** A PRACTICE step: a short mixed set over the unit's met words; each logs a practice event. */
function runPractice(host, unit, advance) {
  const introduced = introducedSet(store.states);
  const met = unit.wordIds.filter((id) => introduced.has(id)).map((id) => store.deck.word(id)).filter(Boolean);
  if (!met.length) return advance();

  const exerciseCtx = prepareExercises(store.deck.words);
  const known = knownSimps();
  const rng = makeRng(hashSeed(`${unit.id}:practice:${store.practice.length}`));

  let n = 0;
  const nextExercise = () => {
    if (n >= PRACTICE_SET) return advance();
    n += 1;
    let item = null;
    for (const type of shuffle(EXERCISE_TYPES, rng)) {
      item = generate(type, { candidates: met, ctx: exerciseCtx, rng, known });
      if (item) break;
    }
    if (!item) return advance();
    replace(host, renderExercise(item, async (correct) => {
      await recordPractice({ unitId: unit.id, type: item.type, wordId: wordIdOfItem(item, unit), correct });
      nextExercise();
    }));
  };
  nextExercise();
}

/**
 * The unit's pattern note (feedback #4): labelled so it reads as an observation about this
 * unit's sentences, and its characters are hoverable for pinyin + meaning.
 */
function noteBlock(note) {
  const body = p('', 'lesson-note-text');
  body.append(glossify(note));
  return div({ class: 'lesson-note' }, [span({ class: 'lesson-note-label', text: s.patternLabel }), body]);
}

/** The cap-spent screen: warm, and it points at what the learner CAN still do. */
function cappedScreen(host, ctx, unit) {
  const introduced = introducedSet(store.states);
  const met = unit.wordIds.some((id) => introduced.has(id));
  replace(host, div({ class: 'lesson-done' }, [
    sealMark(80),
    h(1, s.cappedTitle, 'lesson-title'),
    p(s.cappedBody, 'welcome-lead'),
    div({ class: 'welcome-choices' }, [
      met ? button(s.practiceUnit, () => runPractice(host, unit, () => ctx.navigate('#course')), { variant: 'btn-primary btn-cta' }) : null,
      button(s.doReviews, () => ctx.navigate('#review'), { variant: 'btn-quiet' }),
      button(s.backToPath, () => ctx.navigate('#course'), { variant: 'btn-quiet' }),
    ].filter(Boolean)),
  ]));
}
