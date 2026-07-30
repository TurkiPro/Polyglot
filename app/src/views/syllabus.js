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
import { lessonHref } from '../engine/lessons.js';
import { div, el, h, p, progressBar, span } from '../ui/components.js';
import { stage } from '../ui/arcade.js';
import { strings } from '../ui/strings.js';

const s = strings.syllabus;

/** The hanzi a lesson teaches, for the row's preview line. */
const lessonWords = (lesson) =>
  lesson.wordIds.map((id) => store.deck?.word(id)?.simp ?? '').filter(Boolean);

/**
 * One row per link, shared by lessons and the unit's checkpoint.
 *
 * A real `<a href>` — middle-click and "copy link" work — with the click intercepted for hash
 * routing, the same pattern the nav uses. A `locked` row gets no href and no handler: it was
 * clickable before, and landing on a "not ready" screen is not navigation. The `.syllabus-step`
 * base class is kept so the sanctioned-glow entry `.syllabus-step.state-current` (§D3) still
 * covers the current row without the registry drifting.
 */
function linkRow(href, { kind, state, label, detail, aria }, ctx) {
  const locked = state === 'locked';
  const link = el(locked ? 'span' : 'a', {
    class: `syllabus-step kind-${kind} state-${state}`,
    attrs: {
      href: locked ? undefined : href,
      'aria-current': state === 'current' ? 'step' : undefined,
      'aria-disabled': locked ? 'true' : undefined,
      'aria-label': aria,
    },
    on: locked ? {} : {
      click: (event) => { event.preventDefault(); ctx.navigate(href); },
    },
  });
  link.append(
    span({ class: 'step-marker', attrs: { 'aria-hidden': 'true' } }),
    span({ class: 'step-label', text: label }),
    detail ? span({ class: 'step-kind', text: detail }) : null,
  );
  return el('li', {}, [link]);
}

/**
 * One lesson — a sitting, not a card. This is what replaced the old per-step rows: the tree
 * listed all 16,002 steps, so a 22-word unit was ~29 rows and every "lesson" was a single card.
 * A named lesson shows its authored title ("Counting to ten"); an unnamed one shows the words it
 * teaches, so a row is never a meaningless "Lesson 3".
 */
function lessonRow(unit, lesson, ctx) {
  const words = lessonWords(lesson);
  const label = lesson.title ?? words.slice(0, 6).join(' ');
  const detail = lesson.total ? s.lessonProgress(lesson.done, lesson.total) : '';
  return linkRow(lessonHref(unit.id, lesson.index), {
    kind: 'lesson',
    state: lesson.state,
    label: label || s.lessonN(lesson.index + 1),
    detail,
    aria: `${s.lessonLabel} ${lesson.index + 1}: ${label} — ${s.states[lesson.state]}`,
  }, ctx);
}

/** The unit's checkpoint, always the last row and always its own. */
function checkpointRow(unit, ctx) {
  const step = unit.steps.at(-1);
  if (!step || step.kind !== 'CHECKPOINT') return null;
  return linkRow(`#quiz/${unit.id}`, {
    kind: 'checkpoint',
    state: step.state,
    label: s.checkpointStep,
    detail: s.kinds.CHECKPOINT,
    aria: `${s.kinds.CHECKPOINT} — ${s.states[step.state]}`,
  }, ctx);
}

/**
 * A unit as a collapsible section — native `<details>`, so it is keyboard-operable and needs
 * no JS. The unit that holds the current step opens by default; the rest fold to their header.
 */
function unitSection(row, ctx, { openId, title = row.title }) {
  const details = el('details', { class: `syllabus-unit status-${row.status}` });
  const summary = el('summary', { class: 'syllabus-unit-head' }, [
    span({ class: 'unit-title', text: title }),
    span({ class: 'unit-pct', text: s.unitProgress(row.percent) }),
  ]);
  const steps = el('ol', { class: 'syllabus-steps' });

  // The course has hundreds of units; build a unit's rows only when it is open, so the tree
  // stays light no matter how long the course grows.
  const fill = () => {
    if (steps.childElementCount) return;
    steps.append(...row.lessons.map((lesson) => lessonRow(row, lesson, ctx)));
    const checkpoint = checkpointRow(row, ctx);
    if (checkpoint) steps.append(checkpoint);
  };
  if (row.id === openId) { details.open = true; fill(); }
  details.addEventListener('toggle', () => { if (details.open) fill(); });

  details.append(summary, steps);
  return details;
}

/**
 * All units of a band, gathered into one section — the outer grouping.
 *
 * The n+1 intro order weaves difficulty, so a band is NOT one contiguous run: HSK 1 units are
 * sprinkled through the whole spine as easy words keep arriving. Grouping by contiguous run
 * therefore listed "HSK 1", "HSK 2" … many times over. Gathering every unit of a band into a
 * single section — bands ordered by first appearance (0,1,2,…7), units kept in course order
 * within — gives one section per band, which is how a learner thinks about the course anyway.
 */
function bandGroups(rows) {
  const order = [];
  const byBand = new Map();
  for (const row of rows) {
    if (!byBand.has(row.band)) { byBand.set(row.band, []); order.push(row.band); }
    byBand.get(row.band).push(row);
  }
  return order.map((band) => ({ band, rows: byBand.get(band) }));
}

/**
 * One band as a collapsible section holding its units (Phase 10 A2). The course is the whole
 * HSK vocabulary — hundreds of units — so a flat list scrolls forever; grouping by band keeps
 * the top level to a handful of sections, each drilling into its units and then their steps.
 * The band in play opens by default and builds its units lazily; the rest stay a single line.
 */
function bandSection(group, ctx, { openBand, openId }) {
  const done = group.rows.reduce((n, r) => n + r.stepDone, 0);
  const total = group.rows.reduce((n, r) => n + r.stepTotal, 0);
  const percent = total ? Math.round((done / total) * 100) : 0;

  const details = el('details', { class: `syllabus-band band-${group.band}` });
  const summary = el('summary', { class: 'syllabus-band-head' }, [
    span({ class: 'band-title', text: s.bandTitle(group.band) }),
    span({ class: 'band-meta' }, [
      span({ class: 'band-count', text: s.unitCount(group.rows.length) }),
      span({ class: 'band-pct', text: s.unitProgress(percent) }),
    ]),
  ]);
  const units = div({ class: 'syllabus-band-units' });

  const fill = () => {
    if (units.childElementCount) return;
    // A theme spans several units, so a topic title recurs within a band. Number the recurrences
    // as a series ("People & family 1/2/3") so no two rows read the same; unique titles stay clean.
    const counts = new Map();
    for (const row of group.rows) counts.set(row.title, (counts.get(row.title) ?? 0) + 1);
    const seen = new Map();
    units.append(...group.rows.map((row) => {
      let title = row.title;
      if (counts.get(row.title) > 1) {
        const n = (seen.get(row.title) ?? 0) + 1;
        seen.set(row.title, n);
        title = s.unitSeries(row.title, n);
      }
      return unitSection(row, ctx, { openId, title });
    }));
  };
  if (group.band === openBand) { details.open = true; fill(); }
  details.addEventListener('toggle', () => { if (details.open) fill(); });

  details.append(summary, units);
  return details;
}

/**
 * The whole course as a Band → Unit → Step tree, overall progress on top. `openId` is the unit
 * to expand (the current one by default); its band opens with it. Reused by the page, the rail,
 * and the mobile sheet.
 */
export function syllabusTree(ctx, { openId, view = courseView() } = {}) {
  const open = openId ?? view.currentId;
  const openBand = view.rows.find((r) => r.id === open)?.band ?? view.rows[0]?.band;

  const tree = div({ class: 'syllabus' }, [
    div({ class: 'syllabus-overall' }, [
      span({ class: 'syllabus-overall-label', text: s.overall(view.overall.percent) }),
      progressBar(view.overall.total ? view.overall.done / view.overall.total : 0),
    ]),
    div({ class: 'syllabus-units' },
      bandGroups(view.rows).map((group) => bandSection(group, ctx, { openBand, openId: open }))),
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
 * The mobile "where am I" strip, tappable to open the full tree. It names the LESSON in play —
 * "Numbers · Counting to ten · 3 of 11" — because that is the sitting the learner is inside;
 * the raw step index across a whole unit meant nothing to them.
 * Shown only on the narrow layout (CSS); on desktop the rail answers the same question.
 */
export function stepStrip(ctx, unit, stepIndex, lesson = null) {
  const within = lesson ? stepIndex - lesson.from + 1 : stepIndex + 1;
  const of = lesson ? lesson.to - lesson.from : unit.steps.length;
  const title = lesson?.title ?? s.lessonN((lesson?.index ?? 0) + 1);
  return el('button', {
    class: 'syllabus-strip',
    attrs: { type: 'button', 'aria-label': s.openTree },
    on: { click: () => ctx.navigate('#course') },
  }, [
    span({ class: 'strip-text', text: s.lessonOf(unit.title, title, within, of) }),
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
