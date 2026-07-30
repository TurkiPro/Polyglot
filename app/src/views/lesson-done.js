/**
 * The end of a lesson (Phase 12).
 *
 * Before this there was no per-sitting ending at all: the runner chained through every remaining
 * step in the unit and dropped the learner into a 12-item checkpoint quiz with no warning. A
 * sitting now closes on its own screen — what you just did, and the one or two things worth doing
 * next — and the checkpoint is never entered without being chosen.
 *
 * One screen, two moods: a finished lesson, or a lesson stopped by the daily new-word cap. The
 * capped mood is the same screen with a different headline, because "you hit the limit" is still
 * a finished sitting and deserves the same summary.
 */
import { courseView, store } from '../store.js';
import { introducedSet } from '../engine/coursestate.js';
import { lessonHref } from '../engine/lessons.js';
import { button, div, h, p, replace, sealMark } from '../ui/components.js';
import { strings } from '../ui/strings.js';

const s = strings.lesson;

/**
 * Render the finish screen into `host`.
 *
 * @param {HTMLElement} host the lesson's content area (the shell stays mounted around it)
 * @param {{ navigate: (hash: string) => void }} ctx
 * @param {object} unit the course unit
 * @param {{ index: number }} lesson the lesson just run
 * @param {{ taught: number, practised: number }} tally what happened this sitting
 * @param {{ capped?: boolean }} [options]
 */
export function renderLessonDone(host, ctx, unit, lesson, tally, { capped = false } = {}) {
  const row = courseView().rows.find((r) => r.id === unit.id);
  const lessons = row?.lessons ?? [];
  const introduced = introducedSet(store.states);
  const left = unit.wordIds.filter((id) => !introduced.has(id)).length;
  const unitReady = left === 0;

  // The next lesson worth opening — the first one after this that is not already finished.
  const next = lessons.find((l) => l.index > lesson.index && l.state !== 'done');

  const lines = [];
  if (tally.taught) lines.push(s.taught(tally.taught));
  else if (tally.practised) lines.push(s.practiceDone);
  else lines.push(s.nothingNew);
  if (unitReady) lines.push(s.checkpointHint);
  else lines.push(s.leftToGo(left));

  const actions = [
    // After a capped sitting the next lesson would just hit the same wall, so it is not offered.
    !capped && next
      ? button(s.keepGoing, () => ctx.navigate(lessonHref(unit.id, next.index)), { variant: 'btn-primary btn-cta' })
      : null,
    unitReady && !capped
      ? button(s.checkpoint, () => ctx.navigate(`#quiz/${unit.id}`), { variant: next ? 'btn-quiet' : 'btn-primary btn-cta' })
      : null,
    capped ? button(s.doReviews, () => ctx.navigate('#review'), { variant: 'btn-primary btn-cta' }) : null,
    button(s.backToPath, () => ctx.navigate('#course'), { variant: 'btn-quiet' }),
  ].filter(Boolean);

  replace(host, div({ class: 'lesson-done' }, [
    sealMark(80),
    h(1, capped ? s.cappedTitle : (unitReady ? s.unitReady : s.sittingDone), 'lesson-title'),
    p(capped ? s.cappedBody : lines[0], 'welcome-lead'),
    p(capped ? lines[0] : lines[1], 'muted'),
    div({ class: 'welcome-choices' }, actions),
  ]));
}
