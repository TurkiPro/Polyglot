/**
 * Home: what is due, and a way in (§9).
 *
 * Streak, XP and level are read from the gamification cache when it exists; Phase 4
 * fills it in. Until then the tiles simply do not appear.
 */
import { queue, store } from '../store.js';
import { MODES, modesForWord } from '../engine/deck.js';
import { button, div, h, p, replace, sealMark, stat } from '../ui/components.js';
import { strings } from '../ui/strings.js';

const s = strings.home;

/**
 * One line explaining why only recognition shows up at first (§3.4.6).
 *
 * WRITE, LIS, PROD and SENT unlock per word once its REC interval matures (§5.4), so a
 * new learner sees one mode and reasonably concludes the others are missing. Shown only
 * while something is actually still locked.
 */
function lockedNote() {
  const started = [...store.states.values()].filter((state) => state.mode === 'REC' && state.reps > 0);
  if (started.length === 0) return null;

  const anyLocked = started.some((rec) => {
    const word = store.deck?.word(rec.wordId);
    if (!word) return false;
    return modesForWord(word).some(
      (mode) => mode !== 'REC' && store.states.get(`${word.id}#${mode}`)?.suspended,
    );
  });

  return anyLocked ? p(s.locked, 'muted locked-note') : null;
}

export function renderHome(root, ctx) {
  const { cards, dueCount, newCount } = queue();
  const gamify = store.gamify;

  const tiles = div({ class: 'tiles' }, [
    stat(dueCount, s.due),
    stat(newCount, s.newWords),
    gamify ? stat(gamify.streak, s.streak) : null,
    gamify ? stat(gamify.level, s.level) : null,
  ].filter(Boolean));

  const total = cards.length;

  if (total > 0) {
    // One primary action, above everything else.
    const cta = div({ class: 'home-cta' }, [
      button(s.startWith(total), () => ctx.navigate('#review'), {
        variant: 'btn-primary btn-cta',
      }),
    ]);
    replace(
      root,
      div({ class: 'home' }, [
        h(1, s.greeting, 'greeting'),
        cta,
        tiles,
        lockedNote(),
      ].filter(Boolean)),
    );
    return;
  }

  // Nothing due: the stamp is the reward, not another box.
  const started = store.events.length > 0;
  const done = div({ class: 'done-stamp' }, [
    sealMark(96, { title: strings.appName }),
    h(2, started ? s.doneToday : s.nothingYet, 'done-title'),
    gamify?.streak ? p(s.streakDays(gamify.streak), 'muted') : null,
    started ? p(s.allDone, 'muted') : null,
    button(strings.browse.title, () => ctx.navigate('#browse'), { variant: 'btn-quiet' }),
  ].filter(Boolean));

  replace(root, div({ class: 'home' }, [tiles, done]));
}
