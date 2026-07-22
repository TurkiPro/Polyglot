/**
 * Statistics.
 *
 * Phase 3 shows what the event log alone can answer. The heatmap, XP, level and streak
 * arrive with gamification (§10), which derives them from the same log.
 */
import { store } from '../store.js';
import { div, emptyState, h, p, panel, progressBar, replace, stat } from '../ui/components.js';
import { strings } from '../ui/strings.js';

const s = strings.stats;
const DAY = 86400000;

/** Pass rate over the last `days` days; a pass is rating ≥ 2 (§10). */
export function passRate(events, now = Date.now(), days = 30) {
  const since = now - days * DAY;
  const recent = events.filter((e) => e.ts >= since);
  if (recent.length === 0) return null;
  return recent.filter((e) => e.rating >= 2).length / recent.length;
}

/** How many words of each band have been started. */
export function bandProgress(deck, states) {
  const totals = new Map();
  const started = new Map();

  for (const word of deck.words) {
    const band = word.band ?? 0;
    totals.set(band, (totals.get(band) ?? 0) + 1);
    if (states.has(`${word.id}#REC`)) started.set(band, (started.get(band) ?? 0) + 1);
  }

  return [...totals.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([band, total]) => ({ band, total, started: started.get(band) ?? 0 }));
}

export function renderStats(root) {
  const { events, deck, states } = store;
  if (events.length === 0) {
    replace(root, div({ class: 'stats' }, [h(1, s.title, 'title'), emptyState('grid', s.noReviews)]));
    return;
  }
  const rate = passRate(events);
  const wordsStarted = [...states.keys()].filter((id) => id.endsWith('#REC')).length;

  const bands = bandProgress(deck, states).map(({ band, total, started }) =>
    progressBar(total === 0 ? 0 : started / total, `${band === 0 ? strings.word.custom : strings.word.band(band)} — ${started}/${total}`),
  );

  replace(
    root,
    div({ class: 'stats' }, [
      h(1, s.title, 'title'),
      div({ class: 'tiles' }, [
        stat(events.length, s.totalReviews),
        stat(wordsStarted, s.wordsStarted),
        stat(rate === null ? '—' : `${Math.round(rate * 100)}%`, s.passRate),
      ]),
      h(2, s.perBand, 'panel-title'),
      div({ class: 'bars' }, bands),
      panel(null, [p(s.comingSoon, 'muted')]),
    ]),
  );
}
