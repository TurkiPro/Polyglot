/**
 * Today's study queue.
 *
 * Pure: given card states, the deck and a clock reading, it returns an ordered list of
 * card ids. It reads no storage and mutates nothing, so the whole of §8's queue
 * behaviour is testable headless.
 */
import { config } from '../../../config/app.config.js';
import { cardId as makeCardId } from './deck.js';

const { newCardsPerDay, maxReviewsPerDay } = config.study;

/** A new card is slotted in after roughly this many reviews (§8). */
const NEW_EVERY = 5;

/** Due, unlocked, unburied — the three conditions for a card to be studiable now. */
export function isDue(state, now) {
  if (!state || state.suspended) return false;
  if (state.buriedUntil && state.buriedUntil > now) return false;
  return new Date(state.due).getTime() <= now;
}

/**
 * REC cards for words the learner has not met yet, in teaching order: band, then the
 * order the pack lists them in.
 */
export function newCardCandidates(deck, states) {
  const candidates = [];
  for (const [index, word] of deck.words.entries()) {
    const id = makeCardId(word.id, 'REC');
    if (states.has(id)) continue;
    candidates.push({ cardId: id, wordId: word.id, band: word.band ?? 0, index });
  }
  candidates.sort((a, b) => a.band - b.band || a.index - b.index);
  return candidates;
}

/**
 * Build the queue for the current moment.
 *
 * @param {ReturnType<import('./deck.js').createDeck>} deck
 * @param {Map<string, object>} states
 * @param {object} [options]
 * @param {number} [options.now] epoch ms
 * @param {number} [options.reviewsDoneToday] counts against MAX_REVIEWS_PER_DAY
 * @param {number} [options.newDoneToday] counts against NEW_CARDS_PER_DAY
 * @param {number} [options.maxReviews] override, for the settings sliders
 * @param {number} [options.maxNew] override, for the settings sliders
 * @returns {{ cards: string[], dueCount: number, newCount: number }}
 */
export function buildQueue(deck, states, options = {}) {
  const {
    now = Date.now(),
    reviewsDoneToday = 0,
    newDoneToday = 0,
    maxReviews = maxReviewsPerDay,
    maxNew = newCardsPerDay,
  } = options;

  const reviewBudget = Math.max(0, maxReviews - reviewsDoneToday);
  const newBudget = Math.max(0, maxNew - newDoneToday);

  const due = [...states.values()]
    .filter((state) => isDue(state, now))
    .sort(
      (a, b) =>
        new Date(a.due).getTime() - new Date(b.due).getTime() ||
        (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0),
    )
    .slice(0, reviewBudget)
    .map((state) => state.cardId);

  const fresh = newCardCandidates(deck, states)
    .slice(0, newBudget)
    .map((candidate) => candidate.cardId);

  return { cards: interleave(due, fresh), dueCount: due.length, newCount: fresh.length };
}

/**
 * Weave new cards into the review stream, roughly one every NEW_EVERY reviews, so a
 * session is not front-loaded with unfamiliar material. When reviews run out the
 * remaining new cards follow, and with no reviews at all the queue is just new cards.
 */
export function interleave(due, fresh, every = NEW_EVERY) {
  if (fresh.length === 0) return [...due];
  if (due.length === 0) return [...fresh];

  const out = [];
  const pending = [...fresh];
  // Spread the new cards evenly when there are more than the cadence would place.
  const step = Math.max(1, Math.min(every, Math.floor(due.length / pending.length) || 1));

  for (const [index, cardId] of due.entries()) {
    out.push(cardId);
    if ((index + 1) % step === 0 && pending.length) out.push(pending.shift());
  }
  out.push(...pending);
  return out;
}
