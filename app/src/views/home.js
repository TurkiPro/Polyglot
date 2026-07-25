/**
 * Home: what is due, and a way in (§9).
 *
 * Streak, XP and level are read from the gamification cache when it exists; Phase 4
 * fills it in. Until then the tiles simply do not appear.
 */
import { courseView, queue, store, updateSettings } from '../store.js';
import { MODES, modesForWord } from '../engine/deck.js';
import { banner, button, div, h, icon, p, replace, sealMark, span, stat } from '../ui/components.js';
import { strings } from '../ui/strings.js';
import { comboCounter, odometer, stage } from '../ui/arcade.js';
import { neonIgnite } from '../zh/writer.js';

const s = strings.home;

/** Once per app launch (§2.1), and the last score we showed, for the odometer. */
let heroIgnited = false;
let lastScore = 0;

/**
 * One line explaining why only recognition shows up at first (§3.4.6).
 *
 * WRITE, LIS, PROD and SENT unlock per word once its REC interval matures (§5.4), so a
 * new learner sees one mode and reasonably concludes the others are missing. Shown only
 * while something is actually still locked.
 */
/**
 * Tone gym (Phase 7 §1): the drills stay available forever, not just at onboarding.
 * Tone perception is a skill that keeps repaying practice long after the words land.
 */
/** XP as an arcade SCORE — the number rolls when it changes (§3). */
function scoreTile(gamify) {
  const previous = lastScore;
  lastScore = gamify.xp.total;
  return div({ class: 'stat' }, [
    div({ class: 'stat-value' }, [odometer(gamify.xp.total, { previous })]),
    div({ class: 'stat-label', text: s.score }),
  ]);
}

/** The streak as a combo counter. A break is quiet, deliberately (§3). */
function comboTile(gamify) {
  return div({ class: 'stat' }, [
    div({ class: 'stat-value' }, [comboCounter(gamify.streak)]),
    div({ class: 'stat-label', text: s.streak }),
  ]);
}

/**
 * The 语 mark, lit stroke by stroke — once per app launch (§2.1).
 *
 * Once, not once per visit to Home: a sign that re-ignites every time you glance at it is
 * a flicker, not an arrival.
 */
function heroSign() {
  const host = div({ class: 'home-hero' });
  const mark = div({ class: 'hero-sign' });
  host.append(mark);

  if (heroIgnited) {
    mark.classList.add('neon-sign', 'lit', 'hero-static');
    mark.append(div({ class: 'neon-stage' }, [div({ class: 'neon-fallback', text: '语' })]));
  } else {
    heroIgnited = true;
    neonIgnite(mark, '语', { color: 'var(--accent)', size: 140 });
  }
  return host;
}

function toneGymTile(ctx) {
  const tile = button('', () => ctx.navigate('#tones'), { variant: 'collection tone-gym' });
  tile.append(
    span({ class: 'collection-name', text: s.toneGym }),
    span({ class: 'collection-meta', text: toneGymSubtitle() }),
  );
  return div({ class: 'home-secondary' }, [tile]);
}

function toneGymSubtitle() {
  const stats = store.toneStats;
  if (!stats?.attempts) return s.toneGymNew;
  return s.toneGymScore(Math.round((stats.correct / stats.attempts) * 100));
}

/**
 * Existing accounts are never dropped into onboarding — it is offered once, quietly, and
 * stays dismissed (§7.6).
 */
function welcomeBanner(ctx) {
  const { onboarded, welcomeBannerDismissed } = store.settings;
  if (onboarded || welcomeBannerDismissed || store.events.length === 0) return null;
  return banner(s.welcomeTitle, s.welcomeBody, s.welcomeDismiss, () =>
    updateSettings({ welcomeBannerDismissed: true }),
  );
}

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

/**
 * A big tappable card — icon, what it is, and where it leads. The home's two ways in (the
 * course and reviews) are cards, not stacked pills: a clearer shape, and the primary one
 * carries the accent as a tint rather than a slab of seal red.
 */
function actionCard({ iconName, eyebrow, title, meta, ratio, onClick, primary }) {
  const parts = [
    eyebrow ? span({ class: 'action-eyebrow', text: eyebrow }) : null,
    span({ class: 'action-title', text: title }),
    meta ? span({ class: 'action-meta', text: meta }) : null,
  ].filter(Boolean);

  if (ratio != null) {
    const fill = div({ class: 'action-progress-fill' });
    fill.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
    parts.push(div({ class: 'action-progress' }, [fill]));
  }

  const card = button('', onClick, { variant: `action-card${primary ? ' action-primary' : ''}` });
  card.append(
    div({ class: 'action-icon' }, [icon(iconName, 26)]),
    div({ class: 'action-body' }, parts),
    div({ class: 'action-go' }, [icon('chevron-right', 22)]),
  );
  return card;
}

/** The current course unit, if the account is mid-course. */
function currentUnit() {
  if (!store.course) return null;
  const { rows, currentId } = courseView();
  return rows.find((r) => r.id === currentId) ?? null;
}

/** The course card (primary) and the review card — the review one only when something is due. */
function homeActions(ctx, dueTotal) {
  const cards = [];
  const unit = currentUnit();

  if (unit) {
    const number = Number(String(unit.id).replace(/\D/g, ''));
    cards.push(actionCard({
      iconName: 'book-open',
      eyebrow: s.continueEyebrow,
      title: unit.title,
      meta: s.unitMeta(number, unit.introduced, unit.total),
      ratio: unit.total ? unit.introduced / unit.total : 0,
      onClick: () => ctx.navigate('#course'),
      primary: true,
    }));
  }

  if (dueTotal > 0) {
    cards.push(actionCard({
      iconName: 'rotate-ccw',
      title: s.reviewCard,
      meta: s.dueMeta(dueTotal),
      onClick: () => ctx.navigate('#review'),
      primary: cards.length === 0,
    }));
  }

  return cards.length ? div({ class: 'home-actions' }, cards) : null;
}

export function renderHome(root, ctx) {
  const { cards, dueCount, newCount } = queue();
  const gamify = store.gamify;
  const total = cards.length;

  const tiles = div({ class: 'tiles' }, [
    stat(dueCount, s.due),
    stat(newCount, s.newWords),
    gamify ? scoreTile(gamify) : null,
    gamify ? comboTile(gamify) : null,
  ].filter(Boolean));

  // Reviews cleared, but the course goes on: a quiet stamp, not a whole box that stops you.
  const caughtUp = total === 0 && store.events.length > 0
    ? div({ class: 'home-caught-up' }, [sealMark(36), span({ text: s.allDone })])
    : null;

  replace(root, stage('home', [
    welcomeBanner(ctx),
    heroSign(),
    h(1, s.greeting, 'greeting'),
    homeActions(ctx, total),
    caughtUp,
    tiles,
    toneGymTile(ctx),
    total > 0 ? lockedNote() : null,
  ].filter(Boolean)));
}
