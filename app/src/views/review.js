/**
 * The review session: one card at a time, front then back, then a rating.
 *
 * Space or tap flips; 1-4 grade (§9). Every mode's front and back follow the §9 table.
 */
import { parseCardId } from '../engine/deck.js';
import { RATING } from '../engine/srs.js';
import { queue, recordReview, store, updateSettings } from '../store.js';
import { banner, button, div, el, h, p, replace } from '../ui/components.js';
import { strings } from '../ui/strings.js';
import { renderBack, renderFront } from './card.js';
import * as tts from '../zh/tts.js';

const s = strings.review;

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
    /** Set by PROD/WRITE fronts to preselect a rating. */
    suggested: null,
    /** Cleanup for whatever the current front mounted (writer, audio). */
    teardown: null,
  };

  const stage = div({ class: 'stage' });
  const controls = div({ class: 'controls' });
  const progress = div({ class: 'progress' });
  const view = div({ class: 'review' }, [progress, stage, controls]);

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
    replace(
      root,
      div({ class: 'review done' }, [
        h(1, s.sessionDone),
        p(s.reviewed(session.reviewed), 'muted'),
        button(s.backHome, () => ctx.navigate('#home'), { variant: 'btn-primary' }),
      ]),
    );
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

    session.flipped = false;
    session.suggested = null;
    session.shownAt = Date.now();

    replace(
      progress,
      div({ class: 'progress-text', text: s.remaining(session.cards.length - session.index) }),
    );

    const front = renderFront({
      mode,
      word,
      onReady: (teardown) => {
        session.teardown = teardown;
      },
      onSuggest: (rating) => {
        session.suggested = rating;
      },
      onFlip: () => flip(),
    });

    replace(stage, front);
    replace(controls, button(s.show, () => flip(), { variant: 'btn-primary btn-wide' }));
  }

  function flip() {
    if (session.flipped) return;
    session.flipped = true;

    const cardId = currentCardId();
    const { mode } = parseCardId(cardId);
    const word = store.deck.wordOfCard(cardId);

    replace(stage, renderBack({ mode, word }));
    replace(controls, ratingRow());
  }

  function ratingRow() {
    const row = div({ class: 'ratings' });
    for (const spec of RATING_BUTTONS) {
      const isSuggested = session.suggested === spec.rating;
      const node = button(
        spec.label,
        () => grade(spec.rating),
        { variant: `${spec.variant}${isSuggested ? ' suggested' : ''}` },
      );
      node.append(el('kbd', { text: spec.key }));
      row.append(node);
    }
    return row;
  }

  async function grade(rating) {
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
    if (!session.flipped) return;
    const spec = RATING_BUTTONS.find((b) => b.key === event.key);
    if (spec) {
      event.preventDefault();
      grade(spec.rating);
    }
  }

  stage.addEventListener('click', () => {
    if (!session.flipped) flip();
  });
  addEventListener('keydown', onKey);

  if (session.cards.length === 0) {
    replace(root, div({ class: 'review done' }, [
      h(1, strings.home.allDone),
      button(s.backHome, () => ctx.navigate('#home'), { variant: 'btn-primary' }),
    ]));
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
