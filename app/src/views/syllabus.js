/**
 * The syllabus (Phase 10 A2): the whole course as one legible tree.
 *
 * A 0-to-100 walkthrough where every step of the journey is visible, not just the next one.
 * The same component is the full-page view at `#course`, the persistent rail beside a lesson
 * or checkpoint on desktop, and — folded to one line — the "where am I" strip on a phone. It
 * reads only `courseView()` (the one progress truth, §A3); it never computes position itself.
 *
 * Navigation is free: every step is a link. Jumping ahead past undone steps simply leaves them
 * `skipped` in the derived view — a quiet state, never a gate (the daily new-card cap still
 * holds in the runner, so the syllabus is a map, not a cap bypass).
 */
import { store, courseView } from '../store.js';
import { div, el, h, p, progressBar, span } from '../ui/components.js';
import { stage } from '../ui/arcade.js';
import { strings } from '../ui/strings.js';

const s = strings.syllabus;

/** Where a step leads: a checkpoint to its quiz, anything else into the lesson at that step. */
function stepHref(unitId, index, step) {
  return step.kind === 'CHECKPOINT' ? `#quiz/${unitId}` : `#lesson/${unitId}/${index}`;
}

/** The label a step shows — a word's hanzi, or the kind's name. */
function stepLabel(step) {
  if (step.kind === 'WORD') return store.deck?.word(step.wordId)?.simp ?? step.wordId;
  if (step.kind === 'PHRASE') return s.phraseStep;
  if (step.kind === 'PRACTICE') return s.practiceStep;
  return s.checkpointStep;
}

/** One step as a link, carrying its kind and state for styling and assistive tech. */
function stepRow(unit, index, step, ctx) {
  const label = stepLabel(step);
  const link = el('button', {
    class: `syllabus-step kind-${step.kind.toLowerCase()} state-${step.state}`,
    attrs: {
      type: 'button',
      'aria-current': step.state === 'current' ? 'step' : undefined,
      'aria-label': `${s.kinds[step.kind]}: ${label} — ${s.states[step.state]}`,
    },
    on: { click: () => ctx.navigate(stepHref(unit.id, index, step)) },
  });
  link.append(
    span({ class: 'step-marker', attrs: { 'aria-hidden': 'true' } }),
    span({ class: 'step-label', text: label }),
    span({ class: 'step-kind', text: s.kinds[step.kind] }),
  );
  return el('li', {}, [link]);
}

/**
 * A unit as a collapsible section — native `<details>`, so it is keyboard-operable and needs
 * no JS. The unit that holds the current step opens by default; the rest fold to their header.
 */
function unitSection(row, ctx, { openId }) {
  const details = el('details', { class: `syllabus-unit status-${row.status}` });
  const summary = el('summary', { class: 'syllabus-unit-head' }, [
    span({ class: 'unit-title', text: row.title }),
    span({ class: 'unit-pct', text: s.unitProgress(row.percent) }),
  ]);
  const steps = el('ol', { class: 'syllabus-steps' });

  // The course has hundreds of units; build a unit's step rows only when it is open, so the
  // tree stays light no matter how long the course grows.
  const fill = () => {
    if (!steps.childElementCount) steps.append(...row.steps.map((step, i) => stepRow(row, i, step, ctx)));
  };
  if (row.id === openId) { details.open = true; fill(); }
  details.addEventListener('toggle', () => { if (details.open) fill(); });

  details.append(summary, steps);
  return details;
}

/**
 * The tree of every unit, overall progress on top. `openId` is the unit to expand (the current
 * one by default). Reused by the page, the rail, and the mobile sheet.
 */
export function syllabusTree(ctx, { openId, view = courseView() } = {}) {
  const tree = div({ class: 'syllabus' }, [
    div({ class: 'syllabus-overall' }, [
      span({ class: 'syllabus-overall-label', text: s.overall(view.overall.percent) }),
      progressBar(view.overall.total ? view.overall.done / view.overall.total : 0),
    ]),
    div({ class: 'syllabus-units' },
      view.rows.map((row) => unitSection(row, ctx, { openId: openId ?? view.currentId }))),
  ]);
  return tree;
}

/**
 * The desktop rail beside a lesson or checkpoint: the same tree, opened on the unit in play.
 * CSS hides it below the two-column breakpoint, where the compact strip takes over.
 */
export function syllabusRail(ctx, unitId) {
  return el('aside', { class: 'syllabus-rail', attrs: { 'aria-label': s.title } },
    [syllabusTree(ctx, { openId: unitId })]);
}

/**
 * The mobile "where am I" strip — "Unit 4 · step 7 of 18", tappable to open the full tree.
 * Shown only on the narrow layout (CSS); on desktop the rail answers the same question.
 */
export function stepStrip(ctx, unit, stepIndex) {
  return el('button', {
    class: 'syllabus-strip',
    attrs: { type: 'button', 'aria-label': s.openTree },
    on: { click: () => ctx.navigate('#course') },
  }, [
    span({ class: 'strip-text', text: s.stepOf(unit.title, stepIndex + 1, unit.steps.length) }),
    span({ class: 'strip-cue', attrs: { 'aria-hidden': 'true' } }),
  ]);
}

/** The full-page syllabus at `#course`. */
export function renderSyllabusPage(root, ctx) {
  if (!store.course) {
    root.replaceChildren(stage('course', [
      div({ class: 'syllabus-page' }, [h(1, s.title, 'title'), p(strings.course.unavailable, 'muted')]),
    ]));
    return;
  }
  root.replaceChildren(stage('course', [
    div({ class: 'syllabus-page' }, [h(1, s.title, 'title'), syllabusTree(ctx, { view: courseView() })]),
  ]));
}
