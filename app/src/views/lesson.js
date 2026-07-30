/**
 * A lesson sitting (Phase 12): `#lesson/:unit/l3`, or `#lesson/:unit` to resume.
 *
 * The runner walks the unit's generated `steps[]` — the ONE sequence the syllabus also reads
 * (§A1), so there is no second sequencing logic — but only the slice belonging to ONE lesson.
 * Before Phase 12 it chained through every remaining step in the unit and fell into the checkpoint
 * quiz unannounced, while the syllabus listed each step as its own "lesson" of a single card.
 *
 * WORD steps teach a word and take its first REC review (a real review, counted against the daily
 * new-card cap and ramp — the course paces THROUGH the limits, never around them); PHRASE and
 * PRACTICE run exercises over words already met. The sitting ends on its own finish screen, and
 * the CHECKPOINT is only ever entered by choosing it there.
 *
 * Navigation is free: any lesson can be opened directly, and jumping past undone ones just leaves
 * them `skipped` in the derived view.
 */
import {
  activeDays, countNewToday, courseView, recordPractice, recordReview, store,
} from '../store.js';
import { rampedNewCards } from '../engine/queue.js';
import { generate, hashSeed, makeRng, prepareExercises, shuffle } from '../engine/exercises.js';
import { introducedSet } from '../engine/coursestate.js';
import { lessonSpans, resumeLesson } from '../engine/lessons.js';
import { button, div, featureButton, h, p, replace, span } from '../ui/components.js';
import { stage } from '../ui/arcade.js';
import { glossify } from '../ui/tooltip.js';
import { strings } from '../ui/strings.js';
import { renderBack } from './card.js';
import { renderTeach } from './teach.js';
import { renderExercise } from './exercise.js';
import { syllabusRail, stepStrip } from './syllabus.js';
import { renderLessonDone } from './lesson-done.js';
import { renderPinyinStep, renderTonesStep } from './sounds.js';

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

/**
 * Run ONE lesson (Phase 12).
 *
 * `#lesson/:unit/l3` is lesson 3; a bare `#lesson/:unit` resumes the unit's first unfinished
 * lesson; a legacy bare integer is still honoured as a step index and resolves to the lesson
 * containing it, so old links deep-resume instead of silently restarting the unit at step 0.
 */
export function renderLesson(root, ctx, arg) {
  const [unitId, lessonArg] = String(arg ?? '').split('/');
  const unit = store.course?.units.find((u) => u.id === unitId);
  if (!unit) return void ctx.navigate('#course');

  const row = courseView().rows.find((r) => r.id === unitId);
  const lessons = row?.lessons ?? lessonSpans(unit).map((only) => ({ ...only, state: 'upcoming' }));
  if (!lessons.length) return void ctx.navigate('#course');

  const { lesson, index } = resolveStart(lessons, lessonArg);
  const host = div({ class: 'lesson' });
  // The shell is mounted ONCE per sitting. It used to be rebuilt on every card, and rebuilding
  // it re-ran courseProgress over every step in the course — a full recompute per flashcard.
  mountShell(root, ctx, unit, lesson, host);
  runStep(root, ctx, unit, lesson, index, host, { taught: 0, practised: 0 });
}

/** Which lesson to open, and which step inside it to resume at. */
function resolveStart(lessons, arg) {
  if (arg) {
    const asLesson = /^l(\d+)$/.exec(arg);
    if (asLesson) {
      // Clamp rather than restart: an out-of-range deep link lands on the last lesson.
      const i = Math.min(Math.max(Number(asLesson[1]) - 1, 0), lessons.length - 1);
      return { lesson: lessons[i], index: lessons[i].from };
    }
    const step = Number(arg); // legacy `#lesson/:unit/7` — a raw step index
    if (Number.isInteger(step) && step >= 0) {
      const found = lessons.find((l) => step >= l.from && step < l.to);
      if (found) return { lesson: found, index: step };
    }
  }
  const lesson = resumeLesson(lessons) ?? lessons[0];
  // Resume inside the lesson at its first step that is not already done.
  const at = lesson.steps?.findIndex((step) => step.state !== 'done') ?? -1;
  return { lesson, index: at >= 0 ? lesson.from + at : lesson.from };
}

/** Run the step at `index`; the sitting ENDS at the lesson's last step, never chaining onward. */
function runStep(root, ctx, unit, lesson, index, host, tally) {
  if (index >= lesson.to) return finishLesson(root, ctx, unit, lesson, tally);
  const step = unit.steps[index];
  // A checkpoint is never inside a lesson span; this only guards a fallback span.
  if (!step || step.kind === 'CHECKPOINT') return finishLesson(root, ctx, unit, lesson, tally);

  const advance = () => runStep(root, ctx, unit, lesson, index + 1, host, tally);
  const capped = () => finishLesson(root, ctx, unit, lesson, tally, { capped: true });

  if (step.kind === 'WORD') return runWord(host, unit, step, advance, capped, tally);
  if (step.kind === 'PHRASE') return runPhrase(host, unit, step, advance);
  if (step.kind === 'PRACTICE') return runPractice(host, unit, advance, tally);
  // Unit 0 "The Sounds" steps (§B): tone drills and the pinyin crash intro.
  if (step.kind === 'TONES') return renderTonesStep(host, step.set, advance);
  if (step.kind === 'PINYIN') return renderPinyinStep(host, advance);
  advance();
}

/** The two-column shell: the syllabus rail (desktop) / strip (mobile) beside the step. */
function mountShell(root, ctx, unit, lesson, host) {
  const title = lesson.title ?? strings.syllabus.lessonN(lesson.index + 1);
  replace(root, stage('lesson', [
    div({ class: 'lesson-layout' }, [
      syllabusRail(ctx, unit.id),
      div({ class: 'lesson-main' }, [
        stepStrip(ctx, unit, lesson.from, lesson),
        div({ class: 'lesson-head' }, [
          featureButton(s.leave, () => ctx.navigate('#course'), 'btn-quiet lesson-leave'),
          h(1, title, 'lesson-title'),
          span({ class: 'lesson-unit', text: unit.title }),
          unit.note ? noteBlock(unit.note) : null,
          capNote(lesson),
        ].filter(Boolean)),
        host,
      ]),
    ]),
  ]));
}

/**
 * Tell the learner up front when today's budget is smaller than this lesson, instead of letting
 * them hit the wall mid-sitting. A lesson is a unit of meaning; the cap governs pace, so a
 * 10-word lesson simply spans two days for someone on the 5/day beginner ramp.
 */
function capNote(lesson) {
  const unmet = (lesson.steps ?? [])
    .filter((step) => step.kind === 'WORD' && step.state !== 'done').length;
  const left = remainingNewToday();
  if (!unmet || left >= unmet) return null;
  return p(s.capNote(left, unmet), 'muted lesson-cap-note');
}

/**
 * A WORD step. A word already met is a quick recap (no re-grade); an unmet one teaches then
 * takes a real REC review — but only if the daily new-card budget allows, so the syllabus can
 * never bypass the cap (§A2). A spent cap ends the sitting warmly.
 */
function runWord(host, unit, step, advance, capped, tally) {
  const word = store.deck.word(step.wordId);
  if (!word) return advance();

  if (introducedSet(store.states).has(word.id)) {
    replace(host, renderTeach(word, advance)); // recap, ungraded
    return;
  }
  if (remainingNewToday() <= 0) return capped();

  replace(host, renderTeach(word, () => introCard(host, word, () => {
    tally.taught += 1;
    advance();
  })));
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
function runPractice(host, unit, advance, tally) {
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
      tally.practised += 1;
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

/**
 * End the sitting. This is the terminus the runner never had: it used to chain on through the
 * unit and fall straight into the checkpoint quiz. The checkpoint is now only ever entered by
 * choosing it here.
 */
function finishLesson(root, ctx, unit, lesson, tally, options) {
  const host = div({ class: 'lesson' });
  mountShell(root, ctx, unit, lesson, host);
  renderLessonDone(host, ctx, unit, lesson, tally, options);
}
