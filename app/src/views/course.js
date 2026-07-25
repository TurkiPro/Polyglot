/**
 * The Course path (Phase 9 §3): `#course`.
 *
 * The units as a run of neon signs — the same signboard language as Browse — lighting up as
 * they clear. The current unit sits prominent at the top with the one action that matters;
 * the road ahead is dimmed until it is reached. This is the Home CTA's destination for an
 * account mid-course.
 */
import { courseView, store } from '../store.js';
import { button, div, h, p, progressBar, replace, span } from '../ui/components.js';
import { stage } from '../ui/arcade.js';
import { glossify } from '../ui/tooltip.js';
import { strings } from '../ui/strings.js';

const s = strings.course;

/** How many units of the road to show on either side of the current one. */
const WINDOW_BACK = 4;
const WINDOW_AHEAD = 16;

export function renderCourse(root, ctx) {
  if (!store.course) {
    replace(root, stage('course', [h(1, s.title, 'title'), p(s.unavailable, 'muted')]));
    return;
  }

  const { rows, currentId } = courseView();
  const currentIndex = Math.max(0, rows.findIndex((r) => r.id === currentId));
  const current = rows[currentIndex];

  const from = Math.max(0, currentIndex - WINDOW_BACK);
  const to = Math.min(rows.length, currentIndex + WINDOW_AHEAD);
  const window = rows.slice(from, to);

  replace(root, stage('course', [
    h(1, s.title, 'title'),
    current ? heroCard(current, ctx) : null,
    div({ class: 'course-path signboard' }, window.map((row) => unitSign(row, row.id === currentId, ctx))),
    to < rows.length ? p(s.moreAhead(rows.length - to), 'muted course-more') : null,
  ].filter(Boolean)));
}

/** The current unit, prominent, with its single next action. */
function heroCard(unit, ctx) {
  const allIn = unit.introduced >= unit.total;
  const action = allIn
    ? button(s.startCheckpoint, () => ctx.navigate(`#quiz/${unit.id}`), { variant: 'btn-primary btn-cta' })
    : button(unit.introduced > 0 ? s.continueLesson : s.startLesson, () => ctx.navigate(`#lesson/${unit.id}`), { variant: 'btn-primary btn-cta' });

  return div({ class: 'course-hero' }, [
    span({ class: 'course-hero-eyebrow', text: s.currentUnit }),
    h(2, unit.title, 'course-hero-title'),
    unit.note ? heroNote(unit.note) : null,
    progressBar(unit.total ? unit.introduced / unit.total : 0, s.introducedOf(unit.introduced, unit.total)),
    action,
  ].filter(Boolean));
}

/** The current unit's pattern note, characters hoverable (feedback #4). */
function heroNote(note) {
  const body = p('', 'course-hero-note');
  body.append(glossify(note));
  return body;
}

/** One unit as a sign; its status decides how it glows and whether it is reachable. */
function unitSign(unit, isCurrent, ctx) {
  const reachable = unit.status !== 'locked' || isCurrent;
  const metaText = {
    gold: s.gold,
    cleared: s.cleared,
    checkpoint: s.checkpointReady,
    started: s.introducedOf(unit.introduced, unit.total),
    locked: s.locked,
  }[unit.status];

  const tile = button('', () => {
    if (!reachable) return;
    ctx.navigate(unit.introduced >= unit.total && unit.status !== 'gold' && unit.status !== 'cleared'
      ? `#quiz/${unit.id}` : `#lesson/${unit.id}`);
  }, { variant: `sign course-sign status-${unit.status}${isCurrent ? ' is-current' : ''}` });
  tile.disabled = !reachable;
  tile.append(
    span({ class: 'sign-name', text: unit.title }),
    span({ class: 'sign-meta', text: metaText }),
    unit.status === 'gold' ? span({ class: 'course-medal', text: '★' }) : null,
  );
  return tile;
}
