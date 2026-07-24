/**
 * @vitest-environment jsdom
 *
 * Phase 3.4 — the seven usability items, where they can be asserted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config/app.config.js';
import { createDeck } from '../app/src/engine/deck.js';
import { buildQueue, newCardCandidates, priorityOf } from '../app/src/engine/queue.js';
import { audioControl } from '../app/src/ui/components.js';
import { strings } from '../app/src/ui/strings.js';
import { chineseVoices, pickVoice, RATE_NORMAL, RATE_SLOW } from '../app/src/zh/tts.js';

vi.mock('../app/src/zh/writer.js', () => ({
  mountQuiz: () => ({ destroy: () => {}, reveal: () => {}, mistakes: () => 0, writer: {} }),
  loadCharData: async () => ({}),
  hasStrokeData: async () => true,
}));

const word = (id, band = 1, extra = {}) => ({
  id,
  simp: id,
  pinyin: 'yī',
  pinyinNum: 'yi1',
  defs: ['one'],
  band,
  sentences: [],
  ...extra,
});

beforeEach(() => {
  document.body.replaceChildren();
});

/* ── 1. Study next ──────────────────────────────────────── */

describe('study next (§3.4.1)', () => {
  const deck = () => createDeck({ words: [word('a', 1), word('b', 1), word('z', 7)] });

  it('puts a prioritized curriculum word at the front of the new-card queue', () => {
    const priorities = new Map([['z', Date.now()]]);
    expect(newCardCandidates(deck(), new Map(), priorities).map((c) => c.wordId)).toEqual([
      'z',
      'a',
      'b',
    ]);
  });

  it('orders several prioritized words most-recently-asked first', () => {
    const priorities = new Map([['b', 1000], ['z', 2000]]);
    expect(newCardCandidates(deck(), new Map(), priorities).map((c) => c.wordId)).toEqual([
      'z',
      'b',
      'a',
    ]);
  });

  it('still respects NEW_CARDS_PER_DAY', () => {
    const words = Array.from({ length: 40 }, (_, i) => word(`w${i}`, 1));
    const priorities = new Map([['w39', 5000], ['w38', 4000]]);
    const { cards, newCount } = buildQueue(createDeck({ words }), new Map(), {
      now: Date.now(),
      maxNew: 3,
      priorities,
    });

    expect(newCount).toBe(3);
    expect(cards.slice(0, 2)).toEqual(['w39#REC', 'w38#REC']);
    expect(cards).toHaveLength(config.study.newCardsPerDay > 3 ? 3 : cards.length);
  });

  it('shares one lane with custom words — both are the learner asking', () => {
    // A custom word is prioritized at the moment it was added, with no separate record.
    expect(priorityOf({ id: 'c', custom: true, updatedAt: 900 }, new Map())).toBe(900);
    expect(priorityOf({ id: 'p' }, new Map())).toBe(0);
    // An explicit "Study next" wins if it came later.
    expect(priorityOf({ id: 'c', custom: true, updatedAt: 900 }, new Map([['c', 1500]]))).toBe(1500);
  });

  it('leaves curriculum order alone when nothing is prioritized', () => {
    expect(newCardCandidates(deck(), new Map()).map((c) => c.wordId)).toEqual(['a', 'b', 'z']);
  });
});

/* ── 2 & 4. Audio everywhere, and slow replay ───────────── */

describe('audio controls (§3.4.2, §3.4.4)', () => {
  it('pairs normal and slow, and never triggers a flip', () => {
    const plays = [];
    const control = audioControl(() => plays.push('normal'), () => plays.push('slow'));

    expect(control.dataset.noFlip).toBe('');
    const buttons = [...control.querySelectorAll('button')];
    expect(buttons).toHaveLength(2);
    for (const node of buttons) expect(node.dataset.noFlip).toBe('');

    buttons[0].click();
    buttons[1].click();
    expect(plays).toEqual(['normal', 'slow']);
  });

  it('speaks slowly on a long press, and does not then double-speak', async () => {
    vi.useFakeTimers();
    try {
      const plays = [];
      const control = audioControl(() => plays.push('normal'), () => plays.push('slow'));
      const play = control.querySelector('.btn-audio');

      play.dispatchEvent(new window.Event('pointerdown'));
      vi.advanceTimersByTime(500);
      expect(plays).toEqual(['slow']);

      // The release that follows a long press must not speak again.
      play.dispatchEvent(new window.Event('pointerup'));
      play.click();
      expect(plays).toEqual(['slow']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a short press stays a normal play', () => {
    vi.useFakeTimers();
    try {
      const plays = [];
      const control = audioControl(() => plays.push('normal'), () => plays.push('slow'));
      const play = control.querySelector('.btn-audio');

      play.dispatchEvent(new window.Event('pointerdown'));
      vi.advanceTimersByTime(100);
      play.dispatchEvent(new window.Event('pointerup'));
      play.click();
      expect(plays).toEqual(['normal']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('slow is audibly slower than normal', () => {
    expect(RATE_SLOW).toBeLessThan(RATE_NORMAL);
    expect(RATE_SLOW).toBeLessThanOrEqual(0.6);
  });

  it('every face that shows hanzi or a sentence carries audio', async () => {
    const store = await import('../app/src/store.js');
    const w = word('zh:好:hao3', 1, {
      simp: '好',
      pinyinNum: 'hao3',
      sentences: [{ zh: '你好。', pinyin: 'nǐ hǎo.', pinyinAuto: true, en: 'Hello.', src: 't#1' }],
    });
    store.store.deck = createDeck({ words: [w] });
    const { renderBack } = await import('../app/src/views/card.js');

    for (const mode of ['REC', 'LIS', 'PROD', 'SENT', 'WRITE']) {
      const back = renderBack({ mode, word: w });
      expect(back.querySelector('.audio-control'), `${mode} back`).not.toBeNull();
    }
  });

  it('still suppresses audio on a non-primary split member (§9)', async () => {
    const store = await import('../app/src/store.js');
    const secondary = word('zh:别:bie4', 5, { simp: '别', pinyinNum: 'bie4', splitPrimary: false });
    store.store.deck = createDeck({ words: [secondary] });
    const { renderBack, renderFront } = await import('../app/src/views/card.js');

    expect(renderBack({ mode: 'REC', word: secondary }).querySelector('.audio-control')).toBeNull();
    const front = renderFront({
      mode: 'REC',
      word: secondary,
      onReady: () => {},
      onSuggest: () => {},
      onFlip: () => {},
    });
    // And its hanzi is not tappable-to-speak either.
    expect(front.querySelector('.hanzi').classList.contains('speakable')).toBe(false);
  });
});

/* ── 4. Voice picker ────────────────────────────────────── */

describe('voice picker (§3.4.4)', () => {
  const voices = [
    { voiceURI: 'en', lang: 'en-US', name: 'English' },
    { voiceURI: 'tw', lang: 'zh-TW', name: 'Taiwan' },
    { voiceURI: 'cn', lang: 'zh-CN', name: 'Mainland' },
    { voiceURI: 'neural', lang: 'zh-CN', name: 'Microsoft Xiaoxiao Online (Natural)' },
  ];

  it('lists only Chinese voices', () => {
    expect(chineseVoices(voices).map((v) => v.voiceURI)).toEqual(['tw', 'cn', 'neural']);
  });

  it('honours the chosen voice over the zh-CN default', () => {
    expect(pickVoice(voices, null).voiceURI).toBe('cn');
    expect(pickVoice(voices, 'neural').voiceURI).toBe('neural');
    expect(pickVoice(voices, 'tw').voiceURI).toBe('tw');
  });

  it('falls back gracefully when the chosen voice is gone', () => {
    // An OS voice can be uninstalled, or a profile can move to another machine.
    expect(pickVoice(voices, 'uninstalled').voiceURI).toBe('cn');
    expect(pickVoice([], 'neural')).toBeNull();
  });

  it('tells Windows users where the good voices are', () => {
    expect(strings.voices.tip).toMatch(/Edge/);
    expect(strings.voices.tip).toMatch(/neural/i);
  });
});

/* ── 5. Sentences on backs ──────────────────────────────── */

describe('example sentences on card backs (§3.4.5)', () => {
  const withSentences = () =>
    word('zh:好:hao3', 1, {
      simp: '好',
      pinyinNum: 'hao3',
      sentences: [
        { zh: '这是一个非常长的句子。', pinyin: 'zhè shì...', pinyinAuto: true, en: 'A long one.', src: 't#1' },
        { zh: '你好。', pinyin: 'nǐ hǎo.', pinyinAuto: true, en: 'Hello.', src: 't#2' },
      ],
    });

  it('shows the shortest example on a recognition back', async () => {
    const store = await import('../app/src/store.js');
    const w = withSentences();
    store.store.deck = createDeck({ words: [w] });
    const { renderBack } = await import('../app/src/views/card.js');

    const back = renderBack({ mode: 'REC', word: w });
    const sentence = back.querySelector('.sentence');
    expect(sentence).not.toBeNull();
    expect(sentence.querySelector('.sentence-zh').textContent).toBe('你好。');
    expect(sentence.querySelector('.sentence-en').textContent).toBe('Hello.');
    expect(sentence.querySelector('.sentence-pinyin')).not.toBeNull();
  });

  it('does not repeat the sentence on SENT, which already leads with one', async () => {
    const store = await import('../app/src/store.js');
    const w = withSentences();
    store.store.deck = createDeck({ words: [w] });
    const { renderBack } = await import('../app/src/views/card.js');

    expect(renderBack({ mode: 'SENT', word: w }).querySelectorAll('.sentence')).toHaveLength(1);
    expect(renderBack({ mode: 'LIS', word: w }).querySelectorAll('.sentence')).toHaveLength(1);
  });

  it('omits the block entirely for a word with no sentences', async () => {
    const store = await import('../app/src/store.js');
    const w = word('bare', 1);
    store.store.deck = createDeck({ words: [w] });
    const { renderBack } = await import('../app/src/views/card.js');
    expect(renderBack({ mode: 'REC', word: w }).querySelector('.sentence')).toBeNull();
  });
});

/* ── 6 & 7. Discoverability ─────────────────────────────── */

describe('discoverability (§3.4.6, §3.4.7)', () => {
  it('explains why only recognition appears at first', () => {
    expect(strings.home.locked).toMatch(/Listening/);
    expect(strings.home.locked).toMatch(/writing/);
    expect(strings.home.locked).toMatch(/unlock/);
  });

  it('offers writing practice from the word page, ungraded', async () => {
    const store = await import('../app/src/store.js');
    const w = word('zh:好:hao3', 1, { simp: '好', pinyinNum: 'hao3' });
    store.store.deck = createDeck({ words: [w] });
    store.store.states = new Map();
    store.store.events = [];
    const { renderWord } = await import('../app/src/views/word.js');

    const root = document.createElement('div');
    document.body.append(root);
    renderWord(root, { navigate: () => {} }, w.id);

    const practice = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === strings.word.practiceWriting,
    );
    expect(practice, 'Practice writing is reachable on day one').not.toBeNull();

    practice.click();
    expect(root.querySelector('.practice')).not.toBeNull();
    expect(root.querySelectorAll('.tianzige-write').length).toBe(1);
    // Free practice records nothing.
    expect(store.store.events).toHaveLength(0);
  });

  it('offers Study next on a curriculum word that has not started', async () => {
    const store = await import('../app/src/store.js');
    const w = word('zh:好:hao3', 1, { simp: '好', pinyinNum: 'hao3' });
    store.store.deck = createDeck({ words: [w] });
    store.store.states = new Map();
    store.store.priorities = new Map();
    const { renderWord } = await import('../app/src/views/word.js');

    const root = document.createElement('div');
    document.body.append(root);
    renderWord(root, { navigate: () => {} }, w.id);

    const action = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === strings.word.studyNext,
    );
    expect(action).not.toBeNull();
  });

  it('names its collections without needing a query', () => {
    expect(strings.browse.bands).toBe('HSK bands');
    expect(strings.browse.bandLabel(3)).toBe('Band 3');
    expect(strings.browse.learned(2, 300)).toContain('2 of 300');
  });
});
