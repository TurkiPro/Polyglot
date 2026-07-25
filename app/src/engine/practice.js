/**
 * Practice events (Phase 9 §2): the course's exercise-result stream.
 *
 * Append-only and synced with the same cursor pattern as review events, but a WHOLLY
 * separate stream. It feeds XP, mastery and adaptivity — never FSRS. Cued recognition (an
 * MCQ, a match) is far easier than the free recall the scheduler grades on, so letting a
 * correct MCQ bump card stability would inflate intervals and quietly rot retention. The
 * firewall is structural: `rebuildFromEvents` (the FSRS oracle) never reads this stream, and
 * a practice event carries no `cardId` for it to act on even if one leaked in.
 *
 * Language-agnostic, like the rest of `engine/`.
 */
import { uuidv4 } from './events.js';

/** @typedef {{ id: string, unitId: string, type: string, wordId: string, correct: 0|1, ts: number }} PracticeEvent */

/**
 * Build a practice event. `synced` is storage bookkeeping, stripped from the wire shape.
 * @returns {PracticeEvent & { synced: 0 }}
 */
export function createPracticeEvent({ unitId, type, wordId, correct, ts = Date.now() }) {
  if (!unitId) throw new Error('practice: unitId is required');
  if (!type) throw new Error('practice: type is required');
  if (!wordId) throw new Error('practice: wordId is required');
  return { id: uuidv4(), unitId, type, wordId, correct: correct ? 1 : 0, ts, synced: 0 };
}

/** The wire shape: bookkeeping stripped, exactly the §2 fields. */
export function toWirePractice({ id, unitId, type, wordId, correct, ts }) {
  return { id, unitId, type, wordId, correct: correct ? 1 : 0, ts };
}

/**
 * Fold the practice log into per-word and per-unit tallies — the basis for mastery and for
 * weighting a checkpoint toward a learner's weakest words (§4). Pure and deterministic: the
 * same events in any order yield the same tallies.
 *
 * @param {PracticeEvent[]} events
 */
export function rebuildPractice(events) {
  const byWord = new Map();
  const byUnit = new Map();

  for (const event of events ?? []) {
    const correct = event.correct ? 1 : 0;
    const word = byWord.get(event.wordId) ?? { attempts: 0, correct: 0, lastTs: 0 };
    word.attempts += 1;
    word.correct += correct;
    word.lastTs = Math.max(word.lastTs, event.ts);
    byWord.set(event.wordId, word);

    const unit = byUnit.get(event.unitId) ?? { attempts: 0, correct: 0 };
    unit.attempts += 1;
    unit.correct += correct;
    byUnit.set(event.unitId, unit);
  }

  return { byWord, byUnit };
}

/**
 * The unit's words ranked weakest-first, for checkpoint weighting (§4). Weakness is low
 * practice accuracy; never-practised words sort as maximally weak so they are covered.
 *
 * @param {string[]} wordIds the unit's words
 * @param {ReturnType<typeof rebuildPractice>} practice
 */
export function weakestFirst(wordIds, practice) {
  const score = (id) => {
    const seen = practice.byWord.get(id);
    return seen && seen.attempts > 0 ? seen.correct / seen.attempts : -1; // unseen = weakest
  };
  return [...wordIds].sort((a, b) => score(a) - score(b) || (a < b ? -1 : a > b ? 1 : 0));
}
