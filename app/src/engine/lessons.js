/**
 * Lessons at runtime (Phase 12): the sitting a learner actually opens.
 *
 * The pack bakes each unit's `lessons[]` (step ranges), so the syllabus and the runner read ONE
 * sequence and can never disagree about where a sitting ends. This module only reads that data
 * and folds step states up into a lesson state — it computes no boundaries of its own.
 *
 * Language-agnostic; it touches step kinds and states, nothing zh-specific.
 */

/**
 * A unit's lesson spans, normalised.
 *
 * Falls back to a single span over every non-CHECKPOINT step when a unit has no `lessons[]` —
 * an older pack, or a synthetic fixture. The runner and the tree then behave exactly as they did
 * before lessons existed, rather than rendering nothing.
 *
 * @param {{ steps?: object[], lessons?: object[] }} unit
 * @returns {{ index: number, title?: string, from: number, to: number }[]}
 */
export function lessonSpans(unit) {
  const steps = unit?.steps ?? [];
  if (Array.isArray(unit?.lessons) && unit.lessons.length) {
    return unit.lessons.map((lesson, index) => ({ ...lesson, index }));
  }
  const end = steps.findIndex((step) => step.kind === 'CHECKPOINT');
  const to = end === -1 ? steps.length : end;
  return to > 0 ? [{ index: 0, from: 0, to }] : [];
}

/**
 * Fold a lesson's step states into one state, using the same five-state vocabulary the steps use
 * so the syllabus needs no new strings or CSS.
 *
 * `locked` is deliberately absent: only a checkpoint locks, and a checkpoint is never inside a
 * lesson span.
 */
export function lessonState(steps) {
  if (!steps.length) return 'upcoming';
  if (steps.some((step) => step.state === 'current')) return 'current';
  if (steps.every((step) => step.state === 'done')) return 'done';
  if (steps.some((step) => step.state === 'done')) return 'current'; // part-done: resume here
  if (steps.every((step) => step.state === 'skipped')) return 'skipped';
  return 'upcoming';
}

/** The route for a lesson — `l3` is unambiguous against a legacy bare step index. */
export const lessonHref = (unitId, index) => `#lesson/${unitId}/l${index + 1}`;

/** The lesson a learner should resume: the first not-done one, else the last. */
export function resumeLesson(lessons) {
  if (!lessons?.length) return null;
  return lessons.find((lesson) => lesson.state !== 'done') ?? lessons[lessons.length - 1];
}
