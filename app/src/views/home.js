/**
 * Home: what is due, and a way in (§9).
 *
 * Streak, XP and level are read from the gamification cache when it exists; Phase 4
 * fills it in. Until then the tiles simply do not appear.
 */
import { queue, store } from '../store.js';
import { button, div, h, p, replace, stat } from '../ui/components.js';
import { strings } from '../ui/strings.js';

const s = strings.home;

export function renderHome(root, ctx) {
  const { cards, dueCount, newCount } = queue();
  const gamify = store.settings.gamifyCache ?? null;

  const tiles = div({ class: 'tiles' }, [
    stat(dueCount, s.due),
    stat(newCount, s.newWords),
    gamify ? stat(s.days(gamify.streak ?? 0), s.streak) : null,
    gamify ? stat(gamify.level ?? 1, s.level) : null,
  ].filter(Boolean));

  const total = cards.length;
  const body = total > 0
    ? button(s.start, () => ctx.navigate('#review'), { variant: 'btn-primary btn-wide' })
    : p(store.events.length === 0 ? s.nothingYet : s.allDone, 'empty');

  replace(
    root,
    div({ class: 'home' }, [h(1, strings.appName, 'title'), tiles, body]),
  );
}
