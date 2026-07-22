/**
 * Gamification (§10). Every number is derived from the event log, so these tests drive
 * the log rather than poking at stored totals.
 */
import { describe, expect, it } from 'vitest';
import { config } from '../config/app.config.js';
import { createDeck } from '../app/src/engine/deck.js';
import { rebuildFromEvents } from '../app/src/engine/replay.js';
import {
  badgesOf,
  bandStatus,
  computeGamify,
  heatmap,
  levelOf,
  levelXp,
  longestStreakOf,
  passRate,
  reviewsByDay,
  streakOf,
  xpOf,
} from '../app/src/engine/gamify.js';

const { xpShowup, xpPerReview, xpPerNewWord, xpBandBadge, streakMinReviews, bandClear } = config.gamify;

const DAY = 86400000;
/** Local noon, so a test never straddles midnight by accident. */
const dayAt = (offset = 0) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.getTime() + offset * DAY;
};

const word = (id, band = 1) => ({
  id,
  simp: id,
  pinyin: 'yī',
  pinyinNum: 'yi1',
  defs: ['one'],
  band,
  sentences: [],
});

/** N events on a given local day. */
function eventsOn(dayOffset, count, { cardId = 'w0#REC', rating = 3, startId = 0 } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${dayOffset}-${startId + i}`,
    cardId,
    rating,
    ts: dayAt(dayOffset) + i * 1000,
  }));
}

describe('XP (§10)', () => {
  it('pays show-up once a day, per review, and per new word', () => {
    const events = [
      { id: 'a', cardId: 'w1#REC', rating: 3, ts: dayAt(-1) },
      { id: 'b', cardId: 'w1#REC', rating: 3, ts: dayAt(-1) + 1000 },
      { id: 'c', cardId: 'w2#REC', rating: 3, ts: dayAt(0) },
      { id: 'd', cardId: 'w1#PROD', rating: 3, ts: dayAt(0) + 1000 },
    ];

    const xp = xpOf(events, []);
    expect(xp.showUp).toBe(2 * xpShowup); // two distinct local days
    expect(xp.reviews).toBe(4 * xpPerReview);
    expect(xp.newWords).toBe(2 * xpPerNewWord); // w1#REC and w2#REC
    expect(xp.bandBadges).toBe(0);
    expect(xp.total).toBe(xp.showUp + xp.reviews + xp.newWords);
  });

  it('does not pay new-word XP twice for the same card, or at all for non-REC', () => {
    const events = [
      { id: 'a', cardId: 'w1#REC', rating: 3, ts: dayAt(0) },
      { id: 'b', cardId: 'w1#REC', rating: 1, ts: dayAt(0) + 1000 },
      { id: 'c', cardId: 'w1#LIS', rating: 3, ts: dayAt(0) + 2000 },
    ];
    expect(xpOf(events, []).newWords).toBe(xpPerNewWord);
  });

  it('pays a badge for each cleared band', () => {
    const bands = [{ band: 1, cleared: true }, { band: 2, cleared: false }, { band: 3, cleared: true }];
    expect(xpOf([], bands).bandBadges).toBe(2 * xpBandBadge);
  });

  it('pays nothing for an empty log', () => {
    expect(xpOf([], []).total).toBe(0);
  });
});

describe('levels (§10)', () => {
  it('uses the §0 formula for its thresholds', () => {
    expect(levelXp(1)).toBe(100);
    expect(levelXp(4)).toBe(800);
    expect(levelXp(9)).toBe(2700);
  });

  it('is the highest level whose threshold the total meets', () => {
    expect(levelOf(0).level).toBe(0);
    expect(levelOf(99).level).toBe(0);
    expect(levelOf(100).level).toBe(1);
    expect(levelOf(282).level).toBe(1);
    expect(levelOf(283).level).toBe(2); // ceil(100 * 2^1.5) = 283
    expect(levelOf(100000).level).toBeGreaterThan(20);
  });

  it('reports progress towards the next level', () => {
    const at100 = levelOf(100);
    expect(at100).toMatchObject({ level: 1, xpIntoLevel: 0, nextLevelXp: 283 });
    expect(at100.xpForNext).toBe(183);
    expect(at100.progress).toBe(0);

    const midway = levelOf(191); // halfway between 100 and 283
    expect(midway.progress).toBeCloseTo(0.497, 2);
    expect(levelOf(282).progress).toBeLessThan(1);
  });
});

describe('streaks (§10)', () => {
  const full = (offset, startId = 0) => eventsOn(offset, streakMinReviews, { startId });

  it('counts a day only when it reaches STREAK_MIN_REVIEWS', () => {
    expect(streakOf(eventsOn(0, streakMinReviews - 1))).toBe(0);
    expect(streakOf(eventsOn(0, streakMinReviews))).toBe(1);
  });

  it('counts consecutive days ending today', () => {
    const events = [...full(-2, 0), ...full(-1, 100), ...full(0, 200)];
    expect(streakOf(events)).toBe(3);
  });

  it('survives until a day is actually missed — ending yesterday still counts', () => {
    // Before today's first review, the streak is intact.
    const events = [...full(-2, 0), ...full(-1, 100)];
    expect(streakOf(events)).toBe(2);

    // Two days idle: broken.
    const stale = [...full(-3, 0), ...full(-2, 100)];
    expect(streakOf(stale)).toBe(0);
  });

  it('breaks on a gap day', () => {
    const events = [...full(-4, 0), ...full(-3, 100), ...full(-1, 200), ...full(0, 300)];
    // The gap at -2 means only the last two days count.
    expect(streakOf(events)).toBe(2);
  });

  it('breaks on a day that fell short, even without a gap', () => {
    const events = [...full(-2, 0), ...eventsOn(-1, streakMinReviews - 1, { startId: 100 }), ...full(0, 200)];
    expect(streakOf(events)).toBe(1);
  });

  it('splits a session that crosses midnight across both days', () => {
    // Nine reviews before midnight, nine after: neither day reaches the threshold.
    const midnight = new Date(dayAt(0));
    midnight.setHours(0, 0, 0, 0);
    const before = Array.from({ length: 9 }, (_, i) => ({
      id: `b${i}`,
      cardId: 'w1#REC',
      rating: 3,
      ts: midnight.getTime() - (i + 1) * 60000,
    }));
    const after = Array.from({ length: 9 }, (_, i) => ({
      id: `a${i}`,
      cardId: 'w1#REC',
      rating: 3,
      ts: midnight.getTime() + (i + 1) * 60000,
    }));

    const byDay = reviewsByDay([...before, ...after]);
    expect(byDay.size).toBe(2);
    expect([...byDay.values()]).toEqual([9, 9]);
    expect(streakOf([...before, ...after])).toBe(0);
  });

  it('remembers the longest run even after it breaks', () => {
    const events = [...full(-10, 0), ...full(-9, 100), ...full(-8, 200), ...full(0, 300)];
    expect(streakOf(events)).toBe(1);
    expect(longestStreakOf(events)).toBe(3);
  });
});

describe('band clears (§10)', () => {
  /** A band of `total` words, `matured` of them past the interval threshold. */
  const bandOf = (total, matured) => {
    const words = Array.from({ length: total }, (_, i) => word(`w${i}`, 1));
    const states = new Map(
      words.map((w, i) => [
        `${w.id}#REC`,
        { reps: 1, scheduled_days: i < matured ? bandClear.minIntervalDays : 1 },
      ]),
    );
    return bandStatus(createDeck({ words }), states)[0];
  };

  it('clears at the ratio from §0 and not below it', () => {
    expect(bandClear.minRatio).toBe(0.95);
    expect(bandOf(100, 95).cleared).toBe(true);
    expect(bandOf(100, 94).cleared).toBe(false);
    expect(bandOf(20, 20).cleared).toBe(true);
  });

  it('needs the interval threshold, not merely a started card', () => {
    const words = [word('a'), word('b')];
    const states = new Map([
      ['a#REC', { reps: 5, scheduled_days: bandClear.minIntervalDays - 1 }],
      ['b#REC', { reps: 5, scheduled_days: bandClear.minIntervalDays }],
    ]);
    const [band] = bandStatus(createDeck({ words }), states);
    expect(band).toMatchObject({ total: 2, started: 2, matured: 1, cleared: false });
  });

  it('counts untouched words against the band', () => {
    const words = [word('a'), word('b')];
    const states = new Map([['a#REC', { reps: 5, scheduled_days: 30 }]]);
    const [band] = bandStatus(createDeck({ words }), states);
    expect(band).toMatchObject({ total: 2, matured: 1, cleared: false });
  });

  it('reports each band separately', () => {
    const words = [word('a', 1), word('b', 2), word('c', 2)];
    const bands = bandStatus(createDeck({ words }), new Map());
    expect(bands.map((b) => [b.band, b.total])).toEqual([[1, 1], [2, 2]]);
  });
});

describe('badges (§10)', () => {
  it('awards band clears, streak and review milestones, and the full sweep', () => {
    const bands = [
      { band: 1, cleared: true, ratio: 1 },
      { band: 2, cleared: false, ratio: 0.5 },
    ];
    const badges = badgesOf({ bands, streak: 30, longestStreak: 30, totalReviews: 1200 });
    const earned = badges.filter((b) => b.earned).map((b) => b.id);

    expect(earned).toContain('band-1');
    expect(earned).not.toContain('band-2');
    expect(earned).toContain('streak-7');
    expect(earned).toContain('streak-30');
    expect(earned).not.toContain('streak-100');
    expect(earned).toContain('reviews-1000');
    expect(earned).not.toContain('reviews-10000');
    expect(earned).not.toContain('all-bands');
  });

  it('awards the sweep only when every curriculum band is clear', () => {
    const all = badgesOf({
      bands: [{ band: 1, cleared: true, ratio: 1 }, { band: 2, cleared: true, ratio: 1 }],
      streak: 0,
      longestStreak: 0,
      totalReviews: 0,
    });
    expect(all.find((b) => b.id === 'all-bands').earned).toBe(true);

    // Custom words (band 0) are not a curriculum band and cannot block the sweep.
    const withCustom = badgesOf({
      bands: [{ band: 0, cleared: false, ratio: 0 }, { band: 1, cleared: true, ratio: 1 }],
      streak: 0,
      longestStreak: 0,
      totalReviews: 0,
    });
    expect(withCustom.find((b) => b.id === 'all-bands').earned).toBe(true);
    expect(withCustom.some((b) => b.id === 'band-0')).toBe(false);
  });

  it('keeps a milestone once the streak has lapsed', () => {
    const badges = badgesOf({ bands: [], streak: 1, longestStreak: 40, totalReviews: 0 });
    expect(badges.find((b) => b.id === 'streak-30').earned).toBe(true);
  });
});

describe('stats helpers', () => {
  it('scores a pass as rating >= 2 within the window', () => {
    const now = dayAt(0);
    const events = [
      { rating: 1, ts: now - DAY },
      { rating: 2, ts: now - DAY },
      { rating: 3, ts: now - DAY },
      { rating: 4, ts: now - DAY },
      { rating: 1, ts: now - 40 * DAY },
    ];
    expect(passRate(events, now)).toBeCloseTo(0.75);
    expect(passRate([], now)).toBeNull();
  });

  it('lays out 12 weeks of days, oldest first, ending today', () => {
    const now = dayAt(0);
    const cells = heatmap([...eventsOn(0, 3), ...eventsOn(-5, 2)], now);
    expect(cells).toHaveLength(84);
    expect(cells.at(-1).count).toBe(3);
    expect(cells.at(-6).count).toBe(2);
    expect(cells[0].count).toBe(0);
    // Strictly increasing days, one per cell.
    for (let i = 1; i < cells.length; i++) expect(cells[i].day).toBeGreaterThan(cells[i - 1].day);
  });
});

describe('the whole picture', () => {
  it('derives everything from the log, and agrees with a replay', () => {
    const words = [word('w1'), word('w2')];
    const deck = createDeck({ words });
    const events = [
      { id: 'a', cardId: 'w1#REC', rating: 3, ts: dayAt(-1) },
      { id: 'b', cardId: 'w2#REC', rating: 3, ts: dayAt(-1) + 1000 },
      { id: 'c', cardId: 'w1#REC', rating: 3, ts: dayAt(0) },
    ];
    const { states } = rebuildFromEvents(deck, events);

    const g = computeGamify(deck, events, states, dayAt(0));
    expect(g.xp.total).toBe(2 * xpShowup + 3 * xpPerReview + 2 * xpPerNewWord);
    expect(g.level).toBe(levelOf(g.xp.total).level);
    expect(g.totals).toMatchObject({ reviews: 3, wordsStarted: 2, days: 2 });
    expect(g.streak).toBe(0); // three reviews is short of the threshold
    expect(g.bands[0]).toMatchObject({ band: 1, total: 2, started: 2 });
    expect(g.badges.length).toBeGreaterThan(0);

    // Same log, same numbers — no hidden accumulation.
    expect(computeGamify(deck, events, states, dayAt(0))).toEqual(g);
  });

  it('is empty but valid with no history at all', () => {
    const deck = createDeck({ words: [word('w1')] });
    const g = computeGamify(deck, [], new Map(), dayAt(0));
    expect(g.xp.total).toBe(0);
    expect(g.level).toBe(0);
    expect(g.streak).toBe(0);
    expect(g.passRate).toBeNull();
    expect(g.badges.every((b) => !b.earned)).toBe(true);
  });
});
