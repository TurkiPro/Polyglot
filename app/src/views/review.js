/**
 * The review session: one card at a time, front then back, then a rating.
 *
 * Space or tap flips; 1-4 grade (§9). Every mode's front and back follow the §9 table.
 */
import { parseCardId } from '../engine/deck.js';
import { hardestWordToday } from '../engine/gamify.js';
import { RATING, newCard, previewSchedules } from '../engine/srs.js';
import { noteSync, queue, recordReview, store, syncPort, updateSettings } from '../store.js';
import { localDayKey } from '../engine/replay.js';
import { httpApi, syncNow } from '../sync/client.js';
import { banner, button, div, el, emptyState, formatInterval, h, p, replace } from '../ui/components.js';
import { strings } from '../ui/strings.js';
import { renderBack, renderFront } from './card.js';
import { renderTeach } from './teach.js';
import { neonIgnite } from '../zh/writer.js';
import { odometer, stage } from '../ui/arcade.js';
import * as tts from '../zh/audio.js';

const s = strings.review;

/** Honour the OS setting: no rotation, no height animation, just the answer. */
const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Half the flip: --dur from the stylesheet, so motion stays in one place. */
function durationMs() {
  if (typeof getComputedStyle !== 'function') return 160;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur').trim();
  const ms = raw.endsWith('ms') ? Number.parseFloat(raw) : Number.parseFloat(raw) * 1000;
  return Number.isFinite(ms) && ms > 0 ? ms : 160;
}

/** Rating buttons, in Anki's familiar order. */
const RATING_BUTTONS = [
  { rating: RATING.AGAIN, label: s.again, variant: 'btn-again', key: '1' },
  { rating: RATING.HARD, label: s.hard, variant: 'btn-hard', key: '2' },
  { rating: RATING.GOOD, label: s.good, variant: 'btn-good', key: '3' },
  { rating: RATING.EASY, label: s.easy, variant: 'btn-easy', key: '4' },
];

/**
 * @param {HTMLElement} root
 * @param {{ navigate: (hash: string) => void }} ctx
 */
export function renderReview(root, ctx) {
  const session = {
    cards: queue().cards,
    index: 0,
    reviewed: 0,
    shownAt: Date.now(),
    flipped: false,
    /** Set by PROD/LIS/WRITE fronts to preselect a rating. */
    suggested: null,
    /** What the learner typed, shown on the back when it was wrong. */
    typed: null,
    /** True while the reveal animation is running; grading waits for it. */
    flipping: false,
    /** Cleanup for whatever the current front mounted (writer, audio). */
    teardown: null,
    /** Words already taught this session, so the screen shows once per word. */
    taught: new Set(),
  };

  // The sheet: everything the card is lives inside it, including the grade bar on
  // desktop. Only the progress line sits outside (§3.2.5).
  const flipStage = div({ class: 'stage' });
  const controls = div({ class: 'controls' });
  // §4 sanctioned accent 1: the progress line is neon.
  const sessionFill = div({ class: 'session-bar-fill neon-line' });
  const sessionBar = div({ class: 'session-bar' }, [sessionFill]);
  const counter = div({ class: 'session-count' });
  const progress = div({ class: 'session-progress' }, [sessionBar, counter]);
  // The card area is a perspective container so the reveal is a real flip (§3.3.3).
  flipStage.classList.add('flip-flipStage');
  const sheet = div({ class: 'sheet' }, [flipStage, controls]);
  const view = div({ class: 'review' }, [progress, sheet]);

  replace(root, view);
  maybeWarnNoAudio(root);

  const currentCardId = () => session.cards[session.index];

  function cleanup() {
    session.teardown?.();
    session.teardown = null;
    tts.stop();
  }

  function finish() {
    cleanup();
    // End of a session is the other automatic trigger (§12). Best effort, never blocking.
    syncNow(syncPort(), httpApi())
      .then((result) => (result.ok ? noteSync(result.at, store.account) : null))
      .catch(() => {});
    /*
     * The day's sign-lighting moment (§2.2): the word that fought hardest today is lit
     * stroke by stroke. It is the one piece of theatre that has to be earned — you only
     * see it because you struggled with that character and finished anyway.
     */
    const hardestId = hardestWordToday(store.events);
    const hardest = hardestId ? store.deck.word(hardestId) : null;
    const sign = div({ class: 'done-sign' });

    replace(
      root,
      stage('review-done', [
        hardest ? div({ class: 'done-sign-wrap' }, [sign, p(s.hardestToday, 'muted')]) : null,
        emptyState(
          'seal',
          s.sessionDone,
          button(s.backHome, () => ctx.navigate('#home'), { variant: 'btn-primary' }),
          { note: s.reviewed(session.reviewed) },
        ),
      ].filter(Boolean)),
    );

    if (hardest) neonIgnite(sign, [...hardest.simp][0], { color: 'var(--accent)', size: 160 });
  }

  function showFront() {
    cleanup();
    const cardId = currentCardId();
    if (!cardId) return finish();

    const { mode } = parseCardId(cardId);
    const word = store.deck.wordOfCard(cardId);
    if (!word) {
      // The deck no longer has this word; skip rather than strand the session.
      session.index += 1;
      return showFront();
    }

    /*
     * A word the learner has never met gets its teach screen first (Phase 7 §3) — the
     * card is a retrieval attempt, and there is nothing yet to retrieve. Shown once, in
     * the same session as the card, so encoding stays blocked (§4).
     */
    if (mode === 'REC' && !store.states.has(cardId) && !session.taught.has(word.id)) {
      session.taught.add(word.id);
      replace(flipStage, renderTeach(word, () => showFront()));
      replace(controls, div({ class: 'teach-controls' }));
      return;
    }

    session.flipped = false;
    session.flipping = false;
    session.suggested = null;
    session.typed = null;
    session.shownAt = Date.now();
    flipStage.style.removeProperty('height');
    controls.classList.remove('controls-hidden');

    // "7 of 30" reads as progress; "23 left" reads as a chore.
    counter.textContent = s.progress(session.index + 1, session.cards.length);
    // Width comes through CSSOM, which CSP allows; an inline style attribute would not.
    sessionFill.style.setProperty(
      '--ratio',
      String(session.cards.length ? session.index / session.cards.length : 0),
    );

    const front = renderFront({
      mode,
      word,
      onReady: (teardown) => {
        session.teardown = teardown;
      },
      onSuggest: (rating, typed) => {
        session.suggested = rating;
        if (typed !== undefined) session.typed = typed;
      },
      onFlip: () => flip(),
    });

    replace(flipStage, front);
    replace(controls, button(s.show, () => flip(), { variant: 'btn-primary btn-wide' }));
  }

  /**
   * Reveal: one orchestrated motion (§3.3.3).
   *
   * The front rotates away, content swaps at the halfway point, the back completes the
   * turn, and the sheet's height is animated in parallel so it grows rather than snaps.
   * The grade bar fades in only once the flip finishes, so intervals are never readable
   * mid-turn and a fast "Space, 3" cannot grade a card nobody has seen.
   */
  function flip() {
    if (session.flipped || session.flipping) return;
    session.flipped = true;

    const cardId = currentCardId();
    const { mode } = parseCardId(cardId);
    const word = store.deck.wordOfCard(cardId);
    const back = renderBack({ mode, word, typed: session.typed });

    if (reducedMotion()) {
      replace(flipStage, back);
      replace(controls, ratingRow());
      return;
    }

    session.flipping = true;
    controls.classList.add('controls-hidden');

    // Measure the back off-screen so the height can be transitioned to it.
    const startHeight = flipStage.offsetHeight;
    const endHeight = measure(back, flipStage);
    flipStage.style.height = `${startHeight}px`;

    const face = flipStage.firstElementChild;
    face?.classList.add('flip-out');
    requestAnimationFrame(() => {
      flipStage.style.height = `${endHeight}px`;
    });

    const half = durationMs();
    setTimeout(() => {
      replace(flipStage, back);
      back.classList.add('flip-in');
      replace(controls, ratingRow());

      setTimeout(() => {
        session.flipping = false;
        flipStage.style.removeProperty('height');
        back.classList.remove('flip-in');
        controls.classList.remove('controls-hidden');
      }, half);
    }, half);
  }

  /** Height of a node if it were rendered in this flip stage, without showing it. */
  function measure(node, host) {
    const ghost = node.cloneNode(true);
    ghost.classList.add('measuring');
    host.append(ghost);
    const height = ghost.offsetHeight;
    ghost.remove();
    return height || host.offsetHeight;
  }

  /**
   * The four grade buttons, each showing what it would actually schedule.
   * Previews come from ts-fsrs's own four-way computation, so they are the same numbers
   * grading will produce rather than an estimate of them.
   */
  function ratingRow() {
    const row = div({ class: 'ratings' });
    const now = Date.now();
    // A card being introduced has no stored state yet — most of a beginner's session.
    // Grading would create a fresh card and schedule from that, so preview the same way.
    const state = store.states.get(currentCardId()) ?? newCard(new Date(now));
    const preview = previewSchedules(state, now);

    for (const spec of RATING_BUTTONS) {
      const isSuggested = session.suggested === spec.rating;
      const node = button(spec.label, () => grade(spec.rating), {
        variant: `${spec.variant}${isSuggested ? ' suggested' : ''}`,
      });
      node.append(el('span', { class: 'interval', text: formatInterval(preview[spec.rating].due, now) }));
      row.append(node);
    }
    return row;
  }

  async function grade(rating) {
    // Never grade a card whose answer is still turning into view (§3.3.3).
    if (session.flipping || !session.flipped) return;
    const cardId = currentCardId();
    if (!cardId) return;
    cleanup();
    await recordReview({ cardId, rating, durMs: Date.now() - session.shownAt });
    session.reviewed += 1;
    session.index += 1;
    showFront();
  }

  function onKey(event) {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (!session.flipped) flip();
      else if (session.suggested) grade(session.suggested);
      return;
    }
    if (!session.flipped || session.flipping) return;
    const spec = RATING_BUTTONS.find((b) => b.key === event.key);
    if (spec) {
      event.preventDefault();
      grade(spec.rating);
    }
  }

  /*
   * There is deliberately no tap-to-flip listener here (§3.4.3).
   *
   * Tapping the card body used to reveal it, which was redundant with Show answer and
   * fired by accident constantly — reaching for the audio button, or just resting a
   * thumb. Revealing is now Show answer or Space, and a tap on the hanzi speaks it.
   */
  addEventListener('keydown', onKey);

  if (session.cards.length === 0) {
    replace(
      root,
      emptyState(
        'seal',
        strings.home.allDone,
        button(s.backHome, () => ctx.navigate('#home'), { variant: 'btn-primary' }),
      ),
    );
  } else {
    showFront();
  }

  // Router teardown.
  return () => {
    removeEventListener('keydown', onKey);
    cleanup();
  };
}

/** Tell the user once if their device has no Chinese voice (§9). */
async function maybeWarnNoAudio(root) {
  if (store.settings.audioBannerDismissed) return;
  await tts.ready();
  if (tts.isAvailable()) return;
  root.prepend(
    banner(s.noAudioTitle, s.noAudioBody, s.dismiss, () =>
      updateSettings({ audioBannerDismissed: true }),
    ),
  );
}
