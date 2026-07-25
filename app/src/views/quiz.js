/**
 * The checkpoint (Phase 9 §4): `#quiz/:unit`.
 *
 * QUIZ_LENGTH mixed items weighted toward the unit's weakest words, no timer. Clearing it
 * (≥ QUIZ_PASS) ignites the unit's sign; a gold run (≥ QUIZ_GOLD) earns its medallion.
 * Retakes are unlimited and regenerate from the seed + attempt count, so you cannot memorise
 * one paper. Nothing is stored: the outcome is an append-only practice event, and mastery —
 * like everything — is replayed from the streams (§4).
 */
import { config } from '../../../config/app.config.js';
import { courseView, recordCheckpoint, recordPractice, store } from '../store.js';
import { buildQuizItems, hashSeed, makeRng, prepareExercises } from '../engine/exercises.js';
import { attemptCount, introducedSet, unintroduced } from '../engine/coursestate.js';
import { weakestFirst } from '../engine/practice.js';
import { button, div, featureButton, h, p, progressBar, replace, sealMark } from '../ui/components.js';
import { stage } from '../ui/arcade.js';
import { strings } from '../ui/strings.js';
import { neonIgnite } from '../zh/writer.js';
import { renderExercise } from './exercise.js';
import { syllabusRail, stepStrip } from './syllabus.js';
import { renderSoundsCheckpoint } from './sounds.js';

const s = strings.quiz;
const { quizLength, quizPass } = config.course;

export function renderQuiz(root, ctx, unitArg) {
  const unit = store.course?.units.find((u) => u.id === unitArg);
  if (!unit) return void ctx.navigate('#course');

  // Unit 0 "The Sounds" has no deck words — its checkpoint is a scored tone drill (§B).
  if (unit.sounds || unit.wordIds.length === 0) return renderSoundsCheckpoint(root, ctx, unit);

  const introduced = introducedSet(store.states);
  if (unintroduced(unit, introduced).length > 0) {
    // The path only offers a checkpoint once the unit is fully introduced; a direct link
    // here early is sent back to the lesson rather than quizzing unmet words.
    return notReady(root, ctx, unit);
  }

  const attempt = attemptCount(store.practice, unit.id);
  const rng = makeRng(hashSeed(`${unit.id}:${attempt}`));
  const exerciseCtx = prepareExercises(store.deck.words);
  const known = new Set([...introduced].map((id) => store.deck.word(id)?.simp).filter(Boolean));
  const weak = weakestFirst(unit.wordIds, store.practiceState)
    .slice(0, quizLength)
    .map((id) => store.deck.word(id))
    .filter(Boolean);

  const items = buildQuizItems({ words: weak, ctx: exerciseCtx, rng, known, length: quizLength });
  if (items.length === 0) return notReady(root, ctx, unit);

  runQuiz(root, ctx, unit, items);
}

/** One item at a time; each answer logs a practice event and moves on. */
function runQuiz(root, ctx, unit, items) {
  const host = div({ class: 'quiz' });
  const progress = div({ class: 'quiz-progress' });
  const checkpointStep = Math.max(0, unit.steps.length - 1);
  replace(root, stage('quiz', [
    div({ class: 'lesson-layout' }, [
      syllabusRail(ctx, unit.id),
      div({ class: 'lesson-main' }, [
        stepStrip(ctx, unit, checkpointStep),
        div({ class: 'lesson-head' }, [
          featureButton(s.leave, () => ctx.navigate('#course'), 'btn-quiet lesson-leave'),
          h(1, s.title(unit.title), 'lesson-title'),
        ]),
        progress,
        host,
      ]),
    ]),
  ]));

  let index = 0;
  let correctCount = 0;

  const next = () => {
    if (index >= items.length) return finish(root, ctx, unit, correctCount, items.length);
    replace(progress, p(s.progress(index + 1, items.length), 'muted'));
    const item = items[index++];
    replace(host, renderExercise(item, async (correct) => {
      if (correct) correctCount += 1;
      await recordPractice({ unitId: unit.id, type: item.type, wordId: item.wordId ?? item.answer?.[0] ?? unit.id, correct });
      next();
    }));
  };
  next();
}

/** The result: the score, the outcome, and the sign lighting up when it is earned. */
async function finish(root, ctx, unit, correct, total) {
  const fraction = total ? correct / total : 0;
  const bandBefore = bandCleared(unit.band);
  const { cleared, gold } = await recordCheckpoint(unit.id, fraction);
  const bandNow = bandCleared(unit.band);
  const bandJustCleared = !bandBefore && bandNow;

  const host = div({ class: 'quiz-result' });
  replace(root, stage('quiz', [host]));

  // The sign ignites only when the unit is cleared — the flourish is earned, not automatic.
  const signHost = div({ class: 'quiz-sign' });
  if (cleared) neonIgnite(signHost, '过', { color: gold ? 'var(--neon-yellow)' : 'var(--accent)', size: 120 });
  else signHost.append(div({ class: 'quiz-sign-flat', text: '·' }));

  replace(host,
    signHost,
    h(1, cleared ? (gold ? s.goldTitle : s.clearedTitle) : s.tryAgainTitle, 'lesson-title'),
    div({ class: 'quiz-score' }, [
      progressBar(fraction, s.score(Math.round(fraction * 100), correct, total)),
    ]),
    p(cleared ? (gold ? s.goldBody : s.clearedBody) : s.tryAgainBody(Math.round(quizPass * 100)), 'welcome-lead'),
    bandJustCleared ? bandBanner(unit.band) : null,
    div({ class: 'welcome-choices' }, [
      button(s.retake, () => ctx.navigate(`#quiz/${unit.id}`), { variant: cleared ? 'btn-quiet' : 'btn-primary btn-cta' }),
      button(s.backToPath, () => ctx.navigate('#course'), { variant: cleared ? 'btn-primary btn-cta' : 'btn-quiet' }),
    ]),
  );
}

/** Whether every unit of a band is cleared, from the live course view. */
function bandCleared(band) {
  const rows = courseView().rows.filter((r) => r.band === band);
  return rows.length > 0 && rows.every((r) => r.status === 'cleared' || r.status === 'gold');
}

/** The band-completion moment — the existing band badge, with the arcade flourish (§4). */
function bandBanner(band) {
  return div({ class: 'quiz-band-clear combo-lit' }, [
    sealMark(64),
    h(2, s.bandCleared(band), 'course-hero-title'),
    p(s.bandClearedBody, 'muted'),
  ]);
}

/** A checkpoint reached before the unit is fully taught: back to the lesson. */
function notReady(root, ctx, unit) {
  replace(root, stage('quiz', [
    div({ class: 'lesson-done' }, [
      sealMark(80),
      h(1, s.notReadyTitle, 'lesson-title'),
      p(s.notReadyBody, 'welcome-lead'),
      div({ class: 'welcome-choices' }, [
        button(s.finishUnit, () => ctx.navigate(`#lesson/${unit.id}`), { variant: 'btn-primary btn-cta' }),
        button(s.backToPath, () => ctx.navigate('#course'), { variant: 'btn-quiet' }),
      ]),
    ]),
  ]));
}
