/**
 * Regression for the Design v3 sign-lighting crash: review.js called hardestWordToday()
 * before it existed, and only the Windows runner's test order ever reached finish() —
 * a ReferenceError the Linux runs masked. The function now exists in engine/gamify.js;
 * these pin its contract so it cannot silently regress into "defined but wrong".
 */
import { describe, expect, it } from 'vitest';
import { hardestWordToday } from '../app/src/engine/gamify.js';

const NOON = new Date();
NOON.setHours(12, 0, 0, 0);
const NOW = NOON.getTime();
const ev = (cardId, rating, ts) => ({ id: `${cardId}-${ts}`, cardId, rating, ts });

describe('hardestWordToday', () => {
  it('is null with no events, and null when today held no Again', () => {
    expect(hardestWordToday([], NOW)).toBe(null);
    expect(hardestWordToday([ev('zh:好:hao3#REC', 3, NOW - 1000)], NOW)).toBe(null);
  });

  it('counts only Again presses, grouped across a word\'s sibling cards', () => {
    const events = [
      ev('zh:好:hao3#REC', 1, NOW - 5000),
      ev('zh:好:hao3#PROD', 1, NOW - 4000),
      ev('zh:学习:xue2_xi2#REC', 1, NOW - 3000),
      ev('zh:学习:xue2_xi2#REC', 4, NOW - 2000),
    ];
    expect(hardestWordToday(events, NOW)).toBe('zh:好:hao3');
  });

  it('breaks ties by the most recent press', () => {
    const events = [
      ev('zh:好:hao3#REC', 1, NOW - 5000),
      ev('zh:学习:xue2_xi2#REC', 1, NOW - 1000),
    ];
    expect(hardestWordToday(events, NOW)).toBe('zh:学习:xue2_xi2');
  });

  it('ignores yesterday entirely — the sign is today\'s struggle only', () => {
    const events = [
      ev('zh:好:hao3#REC', 1, NOW - 86400000 - 1000),
      ev('zh:好:hao3#REC', 1, NOW - 86400000 - 2000),
      ev('zh:学习:xue2_xi2#REC', 1, NOW - 1000),
    ];
    expect(hardestWordToday(events, NOW)).toBe('zh:学习:xue2_xi2');
  });
});
