/**
 * `rebuildFromEvents` — card state as a pure function of the event log.
 *
 * This one function is the sync merge, the import path and the correctness oracle (§8).
 * Same deck + same events ⇒ byte-identical states, always. Anything that would make it
 * depend on wall-clock time, iteration order or randomness is a bug.
 */
import { config } from '../../../config/app.config.js';
import { cardId as makeCardId, modesForWord, parseCardId } from './deck.js';
import { sortEvents } from './events.js';
import { gradeCard, intervalDays, newCard } from './srs.js';

const { staggerUnlockDays } = config.study;

/** Midnight opening the day that `ts` falls in, in the device's timezone. */
export function startOfLocalDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The next local midnight strictly after `ts` — when a buried card comes back. */
export function nextLocalMidnight(ts) {
  const d = new Date(startOfLocalDay(ts));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Local-day index, used for streaks and "first review today". */
export const localDayKey = (ts) => startOfLocalDay(ts);

/**
 * Create the full card set for a word: REC active, every other mode suspended until the
 * REC card matures (§5.4).
 */
function introduceWord(word, states, now) {
  for (const mode of modesForWord(word)) {
    const id = makeCardId(word.id, mode);
    if (states.has(id)) continue;
    states.set(id, {
      cardId: id,
      wordId: word.id,
      mode,
      ...newCard(new Date(now)),
      suspended: mode !== 'REC',
      buriedUntil: null,
    });
  }
}

/**
 * Unsuspend a word's non-REC cards once its REC card's interval reaches
 * STAGGER_UNLOCK_DAYS. Unlocking is one-way: a later lapse does not re-suspend, because
 * the learner has already met those cards.
 */
function applyUnlock(word, states) {
  const rec = states.get(makeCardId(word.id, 'REC'));
  if (!rec || intervalDays(rec) < staggerUnlockDays) return;
  for (const mode of modesForWord(word)) {
    if (mode === 'REC') continue;
    const sibling = states.get(makeCardId(word.id, mode));
    if (sibling?.suspended) sibling.suspended = false;
  }
}

/** Answering any card of a word buries its siblings until the next local midnight. */
function applyBury(word, answeredId, states, ts) {
  const until = nextLocalMidnight(ts);
  for (const mode of modesForWord(word)) {
    const id = makeCardId(word.id, mode);
    if (id === answeredId) continue;
    const sibling = states.get(id);
    if (sibling) sibling.buriedUntil = until;
  }
}

/**
 * Apply one event to a state map, in place.
 *
 * This is the single definition of what a review does. A live session calls it per
 * answer; `rebuildFromEvents` folds it over the whole log. There is deliberately no
 * second implementation for the live path — one would drift from the other, and replay
 * is what sync and import trust.
 *
 * @returns {boolean} false if the event could not be applied
 */
export function applyEvent(deck, states, event) {
  const { wordId } = parseCardId(event.cardId);
  const word = deck.word(wordId);
  // An event for a word this deck no longer has (pack rollback, deleted custom word)
  // stays in the log but cannot be replayed.
  if (!word) return false;

  introduceWord(word, states, event.ts);

  const state = states.get(event.cardId);
  if (!state) return false;

  Object.assign(state, gradeCard(state, event.rating, new Date(event.ts)));
  // Answering a card clears its own bury and, if it was suspended, its suspension.
  state.buriedUntil = null;
  state.suspended = false;

  applyBury(word, event.cardId, states, event.ts);
  applyUnlock(word, states);
  return true;
}

/**
 * Fold an event log into card states.
 *
 * @param {ReturnType<import('./deck.js').createDeck>} deck
 * @param {Array<{ id: string, cardId: string, rating: 1|2|3|4, ts: number }>} events
 * @returns {{ states: Map<string, object>, skipped: number }}
 */
export function rebuildFromEvents(deck, events) {
  const states = new Map();
  let skipped = 0;
  for (const event of sortEvents(events)) {
    if (!applyEvent(deck, states, event)) skipped++;
  }
  return { states, skipped };
}

/**
 * The fields `stateHash` covers: the durable scheduling state, and nothing else.
 *
 * `buriedUntil` is deliberately absent. Bury is ephemeral session state derived from the
 * device's local midnight, so two devices in different timezones legitimately compute
 * different values from the same log. Including it would make the determinism test pass
 * in one timezone while a real cross-device sync looked corrupted the first time someone
 * reviewed while travelling.
 *
 * `suspended` is included: it derives from the REC card's FSRS interval, which is
 * timezone-independent, so it must agree across devices.
 */
export const HASHED_FIELDS = Object.freeze([
  'due',
  'stability',
  'difficulty',
  'elapsed_days',
  'scheduled_days',
  'learning_steps',
  'reps',
  'lapses',
  'state',
  'suspended',
]);

/**
 * A stable fingerprint of replayed state, for the export→wipe→import check (§9) and the
 * two-device sync check (§12). Dates are normalized to epoch ms so a state that has been
 * through JSON hashes the same as one that has not.
 */
export function stateHash(states) {
  const rows = [...states.values()]
    .map((s) =>
      [
        s.cardId,
        new Date(s.due).getTime(),
        s.stability.toFixed(6),
        s.difficulty.toFixed(6),
        s.elapsed_days ?? 0,
        s.scheduled_days,
        s.learning_steps ?? 0,
        s.reps,
        s.lapses,
        s.state,
        s.suspended ? 1 : 0,
      ].join(':'),
    )
    .sort();

  // FNV-1a over the sorted rows — short, dependency-free, and enough to catch drift.
  let hash = 0x811c9dc5;
  for (const ch of rows.join('|')) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
