/**
 * Scheduling: a thin wrapper over ts-fsrs, plus the grading adapters the UI calls to
 * turn an answer into a rating.
 *
 * ts-fsrs output is stored verbatim (§8) — this module never reinterprets stability,
 * difficulty or due dates, it only adds polyglot's own `suspended` / `buriedUntil`.
 */
import { createEmptyCard, fsrs } from 'ts-fsrs';
import { config } from '../../../config/app.config.js';

/** Rating values match ts-fsrs exactly (§5.5): 1=Again 2=Hard 3=Good 4=Easy. */
export const RATING = Object.freeze({ AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 });

/** The fields ts-fsrs owns. Everything else on a stored card is ours. */
const FSRS_FIELDS = [
  'due',
  'stability',
  'difficulty',
  'elapsed_days',
  'scheduled_days',
  'learning_steps',
  'reps',
  'lapses',
  'state',
  'last_review',
];

/**
 * Fuzz is disabled deliberately: it randomizes intervals, which would make
 * `rebuildFromEvents` non-deterministic and break the sync merge (§2).
 */
const scheduler = fsrs({
  request_retention: config.study.fsrsTargetRetention,
  enable_fuzz: false,
});

/** A fresh, never-reviewed card. */
export function newCard(now = new Date()) {
  return createEmptyCard(now);
}

/** Pull just the ts-fsrs fields out of a stored card. */
export function toFsrsCard(stored) {
  const card = {};
  for (const field of FSRS_FIELDS) {
    if (stored[field] !== undefined) card[field] = stored[field];
  }
  return card;
}

/**
 * Apply a rating. Returns the ts-fsrs card verbatim — callers merge it back onto their
 * stored record rather than the other way round.
 * @param {object} card stored card or plain ts-fsrs card
 * @param {1|2|3|4} rating
 * @param {Date|number} now
 */
export function gradeCard(card, rating, now = new Date()) {
  const at = now instanceof Date ? now : new Date(now);
  return scheduler.next(toFsrsCard(card), at, rating).card;
}

/** Current interval in whole days; 0 while a card is still in learning steps. */
export function intervalDays(card) {
  return card?.scheduled_days ?? 0;
}

/**
 * What each of the four ratings would schedule, without committing to any of them.
 *
 * ts-fsrs computes all four in one pass, so the previews on the grade buttons are the
 * same numbers `gradeCard` will produce — not an estimate of them.
 *
 * @returns {{ 1: object, 2: object, 3: object, 4: object }} card per rating
 */
export function previewSchedules(card, now = new Date()) {
  const at = now instanceof Date ? now : new Date(now);
  const log = scheduler.repeat(toFsrsCard(card), at);
  return { 1: log[1].card, 2: log[2].card, 3: log[3].card, 4: log[4].card };
}

// ── Grading adapters (pure; the UI calls these, then calls gradeCard) ──────────

/**
 * Canonical form of numbered pinyin for comparison: lowercase, both ü spellings folded,
 * and all spacing dropped so `chuan2tong3` and `CHUAN2 TONG3` are the same answer.
 */
export function normalizePinyin(input) {
  return String(input ?? '')
    .toLowerCase()
    .replace(/u:/g, 'ü')
    .replace(/v/g, 'ü')
    .replace(/\s+/g, '');
}

/**
 * PROD: judge typed pinyin against the word's reading.
 * A match preselects Good, a miss preselects Again — the user may override either before
 * confirming, which is why this returns a suggestion rather than grading outright.
 * @returns {{ correct: boolean, suggested: 1|3 }}
 */
export function gradeProduction(typed, pinyinNum) {
  const correct = normalizePinyin(typed) === normalizePinyin(pinyinNum) && normalizePinyin(typed) !== '';
  return { correct, suggested: correct ? RATING.GOOD : RATING.AGAIN };
}

/**
 * WRITE: total hanzi-writer mistakes across the word's characters.
 * 0 → Good, 1-3 → Hard, more than 3 (or a reveal) → Again. Easy is manual-only (§8).
 * @returns {1|2|3}
 */
export function gradeWriting(mistakes, { revealed = false } = {}) {
  const total = Array.isArray(mistakes) ? mistakes.reduce((a, b) => a + b, 0) : Number(mistakes) || 0;
  if (revealed || total > 3) return RATING.AGAIN;
  if (total >= 1) return RATING.HARD;
  return RATING.GOOD;
}
