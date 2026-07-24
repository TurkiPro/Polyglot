/**
 * Gamification (§10): XP, level, streak, badges — all of it derived.
 *
 * Nothing here is stored as a running total. Every number is a pure function of the deck,
 * the event log and the card states that replay produces, so importing a file or syncing
 * a device can never leave XP disagreeing with history. The `meta` cache is exactly that:
 * a cache, rebuilt by calling this again.
 *
 * Language-agnostic, like the rest of `engine/`.
 */
import { config } from '../../../config/app.config.js';
import { localDayKey } from './replay.js';

const { xpShowup, xpPerReview, xpPerNewWord, xpBandBadge, streakMinReviews, levelXpFormula, bandClear } =
  config.gamify;

const DAY = 86400000;

/** Milestones that are not band clears (§10). */
const STREAK_MILESTONES = [7, 30, 100, 365];
const REVIEW_MILESTONES = [1000, 10000];

/**
 * The word that fought hardest today (Design v3 §2.2): most Again presses this local
 * day, ties broken by the most recent press. Null when today held no Again at all —
 * the sign-lighting is earned by struggle, so an easy day simply has no sign.
 * Returns a wordId; the caller resolves it against the deck.
 */
export function hardestWordToday(events, now = Date.now()) {
  const today = localDayKey(now);
  const tally = new Map(); // wordId → { count, latest }
  for (const event of events) {
    if (event.rating !== 1 || localDayKey(event.ts) !== today) continue;
    const wordId = event.cardId.split('#')[0];
    const entry = tally.get(wordId) ?? { count: 0, latest: 0 };
    entry.count += 1;
    entry.latest = Math.max(entry.latest, event.ts);
    tally.set(wordId, entry);
  }
  let best = null;
  for (const [wordId, { count, latest }] of tally) {
    if (!best || count > best.count || (count === best.count && latest > best.latest)) {
      best = { wordId, count, latest };
    }
  }
  return best ? best.wordId : null;
}

/** Reviews per local day, oldest first. */
export function reviewsByDay(events) {
  const byDay = new Map();
  for (const event of events) {
    const day = localDayKey(event.ts);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return byDay;
}

/**
 * Consecutive days that met STREAK_MIN_REVIEWS, ending today or yesterday.
 *
 * Ending "yesterday" matters: a streak is not broken until a day is missed, so it still
 * shows before the first review of the day. A session that runs past midnight simply
 * lands its later reviews in the next day's bucket — device timezone throughout.
 */
export function streakOf(events, now = Date.now()) {
  const byDay = reviewsByDay(events);
  const counts = (day) => byDay.get(day) ?? 0;

  const today = localDayKey(now);
  const yesterday = localDayKey(now - DAY);

  // A streak that ended yesterday is still alive; one that ended earlier is not.
  let cursor;
  if (counts(today) >= streakMinReviews) cursor = today;
  else if (counts(yesterday) >= streakMinReviews) cursor = yesterday;
  else return 0;

  let streak = 0;
  while (counts(cursor) >= streakMinReviews) {
    streak += 1;
    cursor = localDayKey(cursor - DAY);
  }
  return streak;
}

/** The longest run of counting days ever recorded. */
export function longestStreakOf(events) {
  const days = [...reviewsByDay(events).entries()]
    .filter(([, count]) => count >= streakMinReviews)
    .map(([day]) => day)
    .sort((a, b) => a - b);

  let best = 0;
  let run = 0;
  let previous = null;
  for (const day of days) {
    run = previous !== null && localDayKey(previous + DAY) === day ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return best;
}

/**
 * Per-band maturity. A band is clear when at least `minRatio` of its REC cards have an
 * interval of `minIntervalDays` or more (BAND_CLEAR_RULE).
 */
export function bandStatus(deck, states) {
  const bands = new Map();

  for (const word of deck.words) {
    const band = word.band ?? 0;
    if (!bands.has(band)) bands.set(band, { band, total: 0, started: 0, matured: 0 });
    const row = bands.get(band);
    row.total += 1;

    const rec = states.get(`${word.id}#REC`);
    if (!rec) continue;
    if (rec.reps > 0) row.started += 1;
    if ((rec.scheduled_days ?? 0) >= bandClear.minIntervalDays) row.matured += 1;
  }

  return [...bands.values()]
    .sort((a, b) => a.band - b.band)
    .map((row) => ({
      ...row,
      ratio: row.total === 0 ? 0 : row.matured / row.total,
      cleared: row.total > 0 && row.matured / row.total >= bandClear.minRatio,
    }));
}

/**
 * XP, broken out so the Stats screen can explain where it came from.
 *
 * Show-up XP lands once per local day, on that day's first review. New-word XP lands when
 * a word's REC card is first graded — the card being introduced is what counts, not the
 * word existing.
 */
export function xpOf(events, bands) {
  const days = reviewsByDay(events);
  const firstRecGrade = new Set();
  for (const event of events) {
    if (event.cardId.endsWith('#REC')) firstRecGrade.add(event.cardId);
  }

  const showUp = days.size * xpShowup;
  const reviews = events.length * xpPerReview;
  const newWords = firstRecGrade.size * xpPerNewWord;
  const bandBadges = bands.filter((b) => b.cleared).length * xpBandBadge;

  return { showUp, reviews, newWords, bandBadges, total: showUp + reviews + newWords + bandBadges };
}

/** Cumulative XP needed to reach level n. */
export const levelXp = (n) => levelXpFormula(n);

/**
 * The level a total buys, and how far into the next one it is.
 *
 * Per §10 this is the highest n whose threshold the total meets, so a learner is level 0
 * until their first 100 XP.
 */
export function levelOf(totalXp) {
  let level = 0;
  while (totalXp >= levelXp(level + 1)) level += 1;

  const floor = level === 0 ? 0 : levelXp(level);
  const ceiling = levelXp(level + 1);
  const span = ceiling - floor;

  return {
    level,
    xpIntoLevel: totalXp - floor,
    xpForNext: ceiling - totalXp,
    nextLevelXp: ceiling,
    progress: span > 0 ? Math.min(1, (totalXp - floor) / span) : 0,
  };
}

/** Pass rate over the last `days` days; a pass is rating ≥ 2 (§10). */
export function passRate(events, now = Date.now(), days = 30) {
  const since = now - days * DAY;
  const recent = events.filter((e) => e.ts >= since);
  if (recent.length === 0) return null;
  return recent.filter((e) => e.rating >= 2).length / recent.length;
}

/** Daily counts for the last `weeks` weeks, oldest first — the heatmap. */
export function heatmap(events, now = Date.now(), weeks = 12) {
  const byDay = reviewsByDay(events);
  const today = localDayKey(now);
  const cells = [];
  for (let i = weeks * 7 - 1; i >= 0; i--) {
    const day = localDayKey(today - i * DAY);
    cells.push({ day, count: byDay.get(day) ?? 0 });
  }
  return cells;
}

/** Every badge, earned or not, so the screen can show what is still ahead. */
export function badgesOf({ bands, streak, longestStreak, totalReviews }) {
  const badges = [];

  for (const band of bands) {
    if (band.band === 0) continue; // Custom words are not a curriculum band.
    badges.push({
      id: `band-${band.band}`,
      kind: 'band',
      value: band.band,
      earned: band.cleared,
      progress: band.ratio,
    });
  }

  const best = Math.max(streak, longestStreak);
  for (const milestone of STREAK_MILESTONES) {
    badges.push({
      id: `streak-${milestone}`,
      kind: 'streak',
      value: milestone,
      earned: best >= milestone,
      progress: Math.min(1, best / milestone),
    });
  }

  for (const milestone of REVIEW_MILESTONES) {
    badges.push({
      id: `reviews-${milestone}`,
      kind: 'reviews',
      value: milestone,
      earned: totalReviews >= milestone,
      progress: Math.min(1, totalReviews / milestone),
    });
  }

  const curriculum = bands.filter((b) => b.band > 0);
  badges.push({
    id: 'all-bands',
    kind: 'allBands',
    value: curriculum.length,
    earned: curriculum.length > 0 && curriculum.every((b) => b.cleared),
    progress: curriculum.length ? curriculum.filter((b) => b.cleared).length / curriculum.length : 0,
  });

  return badges;
}

/**
 * The whole picture, from the log alone.
 *
 * @param {ReturnType<import('./deck.js').createDeck>} deck
 * @param {object[]} events
 * @param {Map<string, object>} states
 * @param {number} [now]
 */
export function computeGamify(deck, events, states, now = Date.now()) {
  const bands = bandStatus(deck, states);
  const xp = xpOf(events, bands);
  const streak = streakOf(events, now);
  const longestStreak = longestStreakOf(events);
  const wordsStarted = [...states.keys()].filter((id) => id.endsWith('#REC')).length;

  return {
    xp,
    ...levelOf(xp.total),
    streak,
    longestStreak,
    totals: {
      reviews: events.length,
      wordsStarted,
      days: reviewsByDay(events).size,
    },
    passRate: passRate(events, now),
    bands,
    badges: badgesOf({ bands, streak, longestStreak, totalReviews: events.length }),
    computedAt: now,
  };
}
