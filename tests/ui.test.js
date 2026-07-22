/**
 * The Phase 3 logic that does not need a DOM.
 *
 * Rendering itself is checked by the manual checklist in the README — vitest runs in
 * node, and a DOM implementation is not on the dependency allowlist.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bandProgress, passRate } from '../app/src/views/stats.js';
import { createDeck } from '../app/src/engine/deck.js';
import { relativeDay } from '../app/src/ui/components.js';
import { parseHash } from '../app/src/main.js';
import { strings } from '../app/src/ui/strings.js';
import { toneFromMarks } from '../app/src/zh/tones.js';
import { syllableTone } from '../app/src/zh/pinyin.js';
import { pickVoice } from '../app/src/zh/tts.js';

describe('stats', () => {
  const now = Date.UTC(2026, 6, 21, 12);
  const DAY = 86400000;

  it('counts a pass as rating >= 2, over the last 30 days', () => {
    const events = [
      { rating: 1, ts: now - DAY },
      { rating: 2, ts: now - DAY },
      { rating: 3, ts: now - DAY },
      { rating: 4, ts: now - DAY },
      // Older than the window, so ignored even though it is a fail.
      { rating: 1, ts: now - 40 * DAY },
    ];
    expect(passRate(events, now)).toBeCloseTo(0.75);
    expect(passRate([], now)).toBeNull();
  });

  it('reports words started per band', () => {
    const deck = createDeck({
      words: [
        { id: 'a', band: 1, defs: [], sentences: [] },
        { id: 'b', band: 1, defs: [], sentences: [] },
        { id: 'c', band: 2, defs: [], sentences: [] },
      ],
    });
    const states = new Map([['a#REC', {}]]);
    expect(bandProgress(deck, states)).toEqual([
      { band: 1, total: 2, started: 1 },
      { band: 2, total: 1, started: 0 },
    ]);
  });
});

describe('tone reading', () => {
  it('reads the tone back off a marked syllable', () => {
    expect(toneFromMarks('hǎo')).toBe(3);
    expect(toneFromMarks('chuán')).toBe(2);
    expect(toneFromMarks('tǒng')).toBe(3);
    expect(toneFromMarks('xiè')).toBe(4);
    expect(toneFromMarks('yī')).toBe(1);
    expect(toneFromMarks('nǚ')).toBe(3);
    // Neutral tone carries no mark.
    expect(toneFromMarks('xie')).toBe(5);
    // Punctuation is not a syllable.
    expect(toneFromMarks('.')).toBe(0);
  });
});

describe('voice selection', () => {
  it('prefers zh-CN, then any Chinese voice, else none (§9)', () => {
    const voices = [
      { lang: 'en-US', name: 'English' },
      { lang: 'zh-TW', name: 'Taiwan' },
      { lang: 'zh-CN', name: 'Mainland' },
    ];
    expect(pickVoice(voices).name).toBe('Mainland');
    expect(pickVoice(voices.slice(0, 2)).name).toBe('Taiwan');
    expect(pickVoice([{ lang: 'en-GB' }])).toBeNull();
    expect(pickVoice([])).toBeNull();
  });
});

describe('router', () => {
  it('parses routes and falls back to home', () => {
    expect(parseHash('#review')).toEqual({ name: 'review', arg: null });
    expect(parseHash('#word/zh:好:hao3')).toEqual({ name: 'word', arg: 'zh:好:hao3' });
    expect(parseHash('#credits')).toEqual({ name: 'credits', arg: null });
    expect(parseHash('#nope')).toEqual({ name: 'home', arg: null });
    expect(parseHash('')).toEqual({ name: 'home', arg: null });
  });
});

describe('relative dates', () => {
  const now = Date.UTC(2026, 6, 21, 12);
  it('describes a due date without a date library', () => {
    expect(relativeDay(now - 1000, now)).toBe('now');
    expect(relativeDay(now + 86400000, now)).toBe('tomorrow');
    expect(relativeDay(now + 5 * 86400000, now)).toBe('in 5 days');
    expect(relativeDay(now + 60 * 86400000, now)).toBe('in 2 months');
  });
});

describe('§9 acceptance, against the real pack', () => {
  const packDir = new URL('../app/assets/packs/zh/', import.meta.url);
  const deck = JSON.parse(readFileSync(new URL('deck.zh.json', packDir), 'utf8'));
  const bySimp = new Map(deck.words.map((w) => [w.simp, w]));

  it('gives 好 t3, 传统 t2 t3 and 谢谢 t4 t5', () => {
    const tones = (simp) =>
      bySimp.get(simp).pinyinNum.split(/\s+/).map((syllable) => syllableTone(syllable));
    expect(tones('好')).toEqual([3]);
    expect(tones('传统')).toEqual([2, 3]);
    expect(tones('谢谢')).toEqual([4, 5]);
    // And the rendered marks agree with the tone numbers.
    expect(bySimp.get('传统').pinyin).toBe('chuántǒng');
  });

  // Search relevance is covered end to end in tests/search.test.js, against the real
  // dictionary — that is where the ranking defect lived.
});

describe('strings', () => {
  it('keeps every user-facing string in one place (the i18n seam)', () => {
    expect(strings.appName).toBe('polyglot');
    // Spot-check that each screen has its section.
    for (const key of ['nav', 'home', 'review', 'browse', 'word', 'stats', 'settings', 'credits']) {
      expect(strings[key], key).toBeTruthy();
    }
  });
});
