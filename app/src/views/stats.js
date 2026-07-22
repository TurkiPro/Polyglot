/**
 * Statistics (§10): what the event log says about the work so far.
 *
 * Everything shown comes from `store.gamify`, which `engine/gamify.js` derives from the
 * log. Nothing here keeps its own totals.
 */
import { heatmap } from '../engine/gamify.js';
import { store } from '../store.js';
import { div, el, emptyState, h, p, progressBar, replace, span, stat } from '../ui/components.js';
import { strings } from '../ui/strings.js';

const s = strings.stats;
const b = strings.badges;

/** Intensity buckets for the heatmap, so a quiet day still reads as activity. */
export function intensity(count, busiest) {
  if (count <= 0) return 0;
  if (busiest <= 1) return 4;
  const ratio = count / busiest;
  if (ratio > 0.66) return 4;
  if (ratio > 0.33) return 3;
  if (ratio > 0.1) return 2;
  return 1;
}

/** A badge's label, from its kind and value. */
export function badgeLabel(badge) {
  const label = b[badge.kind];
  return typeof label === 'function' ? label(badge.value) : label;
}

export function renderStats(root) {
  const { events, gamify } = store;

  if (!gamify || events.length === 0) {
    replace(root, div({ class: 'stats' }, [h(1, s.title, 'title'), emptyState('grid', s.noReviews)]));
    return;
  }

  replace(
    root,
    div({ class: 'stats' }, [
      h(1, s.title, 'title'),
      tiles(gamify),
      levelPanel(gamify),
      activityPanel(events),
      bandsPanel(gamify),
      badgesPanel(gamify),
      xpPanel(gamify),
    ]),
  );
}

function tiles(g) {
  return div({ class: 'tiles' }, [
    stat(g.totals.reviews, s.totalReviews),
    stat(g.totals.wordsStarted, s.wordsStarted),
    stat(g.passRate === null ? '—' : `${Math.round(g.passRate * 100)}%`, s.passRate),
    stat(g.streak, s.streak),
  ]);
}

/** Level, and how far into it the learner is. */
function levelPanel(g) {
  return el('section', { class: 'panel level-panel' }, [
    div({ class: 'level-head' }, [
      span({ class: 'level-number', text: String(g.level) }),
      div({ class: 'level-text' }, [
        p(`${s.level} ${g.level}`, 'level-label'),
        p(s.toNextLevel(g.xpForNext, g.level + 1), 'muted'),
      ]),
    ]),
    progressBar(g.progress),
  ]);
}

/** Twelve weeks of daily counts, oldest first. */
function activityPanel(events) {
  const cells = heatmap(events);
  const busiest = cells.reduce((max, cell) => Math.max(max, cell.count), 0);

  const grid = div({ class: 'heatmap', attrs: { role: 'img', 'aria-label': s.activity } });
  for (const cell of cells) {
    const day = new Date(cell.day);
    grid.append(
      div({
        class: `heat heat-${intensity(cell.count, busiest)}`,
        attrs: {
          title: `${day.toLocaleDateString()} — ${cell.count ? s.activityLegend(cell.count) : s.noActivity}`,
        },
      }),
    );
  }

  return el('section', { class: 'panel' }, [h(2, s.activity, 'panel-title'), grid]);
}

function bandsPanel(g) {
  const bars = g.bands.map((band) =>
    progressBar(
      band.ratio,
      `${band.band === 0 ? strings.word.custom : strings.word.band(band.band)} — ` +
        `${band.matured}/${band.total}${band.cleared ? ` · ${s.bandCleared}` : ''}`,
    ),
  );
  return el('section', { class: 'panel' }, [
    h(2, s.perBand, 'panel-title'),
    div({ class: 'bars' }, bars),
  ]);
}

/** Earned badges first; the rest show what is still ahead. */
function badgesPanel(g) {
  const sorted = [...g.badges].sort((x, y) => Number(y.earned) - Number(x.earned));
  const items = sorted.map((badge) =>
    div({ class: `badge${badge.earned ? ' badge-earned' : ''}` }, [
      div({ class: 'badge-mark', text: badge.earned ? '✓' : '' }),
      div({ class: 'badge-text' }, [
        p(badgeLabel(badge), 'badge-label'),
        badge.earned ? null : p(`${Math.round(badge.progress * 100)}%`, 'muted'),
      ].filter(Boolean)),
    ]),
  );

  return el('section', { class: 'panel' }, [
    h(2, s.badges, 'panel-title'),
    div({ class: 'badges' }, items),
  ]);
}

/** XP is worth explaining, or the number is just a number. */
function xpPanel(g) {
  const rows = [
    [s.xpShowUp, g.xp.showUp],
    [s.xpReviews, g.xp.reviews],
    [s.xpNewWords, g.xp.newWords],
    [s.xpBands, g.xp.bandBadges],
  ].map(([label, value]) =>
    el('li', {}, [span({ text: label }), span({ class: 'xp-value', text: String(value) })]),
  );

  rows.push(
    el('li', { class: 'xp-total' }, [
      span({ text: s.xpTotal }),
      span({ class: 'xp-value', text: String(g.xp.total) }),
    ]),
  );

  return el('section', { class: 'panel' }, [
    h(2, s.xpBreakdown, 'panel-title'),
    el('ul', { class: 'xp-list' }, rows),
  ]);
}
