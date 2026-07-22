/**
 * @vitest-environment jsdom
 *
 * View rendering.
 *
 * jsdom is a dev-only dependency, human-approved per §4.3, and scoped to this file: it is
 * opted into with the docblock above rather than switched on globally, so every other
 * suite keeps running in plain node. Use it only for asserting rendered DOM — logic that
 * can be tested without a document belongs in a node suite.
 *
 * What this buys: the §9 front/back table, the keyboard shortcuts and the no-innerHTML
 * rule become assertions instead of checklist items.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeck } from '../app/src/engine/deck.js';
import { RATING } from '../app/src/engine/srs.js';
import { button, el, progressBar, relativeDay } from '../app/src/ui/components.js';
import { colorMarkedPinyin, colorPinyin, highlightWord } from '../app/src/zh/tones.js';

/** hanzi-writer needs a real canvas/SVG stack; WRITE cards are left to the checklist. */
vi.mock('../app/src/zh/writer.js', () => ({
  mountQuiz: () => ({ writer: {}, mistakes: () => 0, reveal: () => {}, destroy: () => {} }),
  loadCharData: async () => ({ strokes: [], medians: [] }),
  hasStrokeData: async () => true,
}));

vi.mock('../app/src/zh/tts.js', () => ({
  ready: async () => ({ lang: 'zh-CN' }),
  isAvailable: () => true,
  speak: vi.fn(async () => true),
  stop: vi.fn(),
  pickVoice: () => null,
  reset: () => {},
}));

const word = (over = {}) => ({
  id: 'zh:传统:chuan2_tong3',
  simp: '传统',
  trad: '傳統',
  pinyin: 'chuántǒng',
  pinyinNum: 'chuan2 tong3',
  defs: ['tradition', 'traditional'],
  band: 5,
  sentences: [
    { zh: '这是一个古老的传统。', pinyin: 'zhè shì yī gè gǔ lǎo de chuán tǒng.', pinyinAuto: true, en: 'This is an old tradition.', src: 'tatoeba#1' },
  ],
  ...over,
});

let root;
beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
});

describe('components', () => {
  it('never interprets text as markup', () => {
    const node = el('div', { text: '<img src=x onerror=alert(1)>' });
    expect(node.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(node.querySelector('img')).toBeNull();
    expect(node.children).toHaveLength(0);
  });

  it('escapes user-supplied definitions from an imported deck', () => {
    const node = el('li', { text: '<script>bad()</script>' });
    document.body.append(node);
    expect(document.querySelectorAll('script')).toHaveLength(0);
  });

  it('sets bar width through CSSOM, not an inline style attribute in markup', () => {
    const bar = progressBar(0.5, 'half');
    const fill = bar.querySelector('.bar-fill');
    expect(fill.style.getPropertyValue('--ratio')).toBe('0.5');
    // Clamped, so bad input cannot overflow the track.
    expect(progressBar(2).querySelector('.bar-fill').style.getPropertyValue('--ratio')).toBe('1');
    expect(progressBar(-1).querySelector('.bar-fill').style.getPropertyValue('--ratio')).toBe('0');
  });

  it('wires button handlers', () => {
    const onClick = vi.fn();
    const node = button('Go', onClick);
    node.click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('tone colouring (§9)', () => {
  it('wraps each syllable in its tone class', () => {
    const host = el('div');
    host.append(colorPinyin('chuan2 tong3'));
    const spans = [...host.querySelectorAll('span')];
    expect(spans.map((s) => s.className)).toEqual(['t2', 't3']);
    expect(spans.map((s) => s.textContent)).toEqual(['chuán', 'tǒng']);
    expect(host.textContent).toBe('chuántǒng');
  });

  it('colours 好 as t3 and 谢谢 as t4 t5', () => {
    const tones = (pinyinNum) => {
      const host = el('div');
      host.append(colorPinyin(pinyinNum));
      return [...host.querySelectorAll('span')].map((s) => s.className);
    };
    expect(tones('hao3')).toEqual(['t3']);
    expect(tones('xie4 xie5')).toEqual(['t4', 't5']);
  });

  it('colours pre-marked sentence pinyin and keeps its spacing', () => {
    const host = el('div');
    host.append(colorMarkedPinyin('zhè shì yī gè'));
    expect([...host.querySelectorAll('span')].map((s) => s.className)).toEqual(['t4', 't4', 't1', 't4']);
    expect(host.textContent).toBe('zhè shì yī gè');
  });

  it('marks the target word inside a sentence', () => {
    const host = el('div');
    host.append(highlightWord('这是一个古老的传统。', '传统'));
    const target = host.querySelector('.target');
    expect(target.textContent).toBe('传统');
    expect(host.textContent).toBe('这是一个古老的传统。');
  });

  it('leaves the sentence intact when the word does not occur', () => {
    const host = el('div');
    host.append(highlightWord('你好。', '传统'));
    expect(host.querySelector('.target')).toBeNull();
    expect(host.textContent).toBe('你好。');
  });
});

describe('card fronts and backs (§9 table)', () => {
  /** card.js pulls siblings out of the store, so give it a deck. */
  async function withDeck(words) {
    const store = await import('../app/src/store.js');
    store.store.deck = createDeck({ words });
    return import('../app/src/views/card.js');
  }

  it('REC: large hanzi on the front; pinyin, defs, trad and audio on the back', async () => {
    const w = word();
    const { renderFront, renderBack } = await withDeck([w]);

    const front = renderFront({ mode: 'REC', word: w, onReady: () => {}, onSuggest: () => {}, onFlip: () => {} });
    expect(front.querySelector('.hanzi').textContent).toBe('传统');
    expect(front.textContent).not.toContain('tradition');

    const back = renderBack({ mode: 'REC', word: w });
    expect(back.querySelector('.pinyin').textContent).toBe('chuántǒng');
    expect(back.textContent).toContain('tradition');
    expect(back.querySelector('.trad').textContent).toBe('傳統');
    expect(back.querySelector('.btn-audio')).not.toBeNull();
  });

  it('SENT: front shows the sentence with the target marked', async () => {
    const w = word();
    const { renderFront } = await withDeck([w]);
    const front = renderFront({ mode: 'SENT', word: w, onReady: () => {}, onSuggest: () => {}, onFlip: () => {} });
    expect(front.querySelector('.target').textContent).toBe('传统');
    expect(front.textContent).not.toContain('This is an old tradition.');
  });

  it('PROD: front shows English and judges the typed answer per §8', async () => {
    const w = word();
    const { renderFront } = await withDeck([w]);
    const suggestions = [];
    const front = renderFront({
      mode: 'PROD',
      word: w,
      onReady: () => {},
      onSuggest: (r) => suggestions.push(r),
      onFlip: () => {},
    });

    expect(front.textContent).toContain('tradition');
    expect(front.textContent).not.toContain('传统');

    const input = front.querySelector('input.answer');
    input.value = 'CHUAN2TONG3';
    front.querySelector('.btn-primary').click();
    expect(suggestions.at(-1)).toBe(RATING.GOOD);
    expect(front.querySelector('.verdict').classList.contains('ok')).toBe(true);

    input.value = 'wrong';
    front.querySelector('.btn-primary').click();
    expect(suggestions.at(-1)).toBe(RATING.AGAIN);
    expect(front.querySelector('.verdict').classList.contains('bad')).toBe(true);
  });

  it('split members: REC front hints the sibling, and no audio on the non-primary (§9)', async () => {
    const primary = word({ id: 'zh:别:bie2', simp: '别', pinyin: 'bié', pinyinNum: 'bie2', trad: undefined, splitGroup: ['zh:别:bie4'], splitPrimary: true });
    const secondary = word({ id: 'zh:别:bie4', simp: '别', pinyin: 'biè', pinyinNum: 'bie4', trad: undefined, splitGroup: ['zh:别:bie2'], splitPrimary: false, sentences: [] });
    const { renderFront, renderBack } = await withDeck([primary, secondary]);

    const front = renderFront({ mode: 'REC', word: primary, onReady: () => {}, onSuggest: () => {}, onFlip: () => {} });
    expect(front.querySelector('.hint').textContent).toBe('not biè');

    // The primary keeps its audio button; the non-primary must not have one.
    expect(renderBack({ mode: 'REC', word: primary }).querySelector('.btn-audio')).not.toBeNull();
    expect(renderBack({ mode: 'REC', word: secondary }).querySelector('.btn-audio')).toBeNull();
  });

  it('shows alternate readings on the back as display-only text', async () => {
    const w = word({ altReadings: [{ pinyin: 'hào', pinyinNum: 'hao4', gloss: 'to be fond of' }] });
    const { renderBack } = await withDeck([w]);
    const back = renderBack({ mode: 'REC', word: w });
    expect(back.querySelector('.alt-readings').textContent).toContain('hào');
    expect(back.querySelector('.alt-readings').textContent).toContain('to be fond of');
  });
});

describe('relative dates render', () => {
  it('formats a due date', () => {
    const now = Date.UTC(2026, 6, 21, 12);
    expect(relativeDay(new Date(now + 86400000), now)).toBe('tomorrow');
  });
});

/**
 * The review loop, driven the way a user drives it. jsdom supplies the document and
 * fake-indexeddb the storage, so this exercises store → engine → db for real.
 */
describe('review session', () => {
  const packWords = [
    word({ id: 'w1', simp: '一', pinyin: 'yī', pinyinNum: 'yi1', band: 1, sentences: [] }),
    word({ id: 'w2', simp: '二', pinyin: 'èr', pinyinNum: 'er4', band: 1, sentences: [] }),
    word({ id: 'w3', simp: '三', pinyin: 'sān', pinyinNum: 'san1', band: 1, sentences: [] }),
  ];

  let store;
  let renderReview;

  beforeEach(async () => {
    vi.resetModules();
    const { IDBFactory } = await import('fake-indexeddb');
    globalThis.indexedDB = new IDBFactory();
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('deck.')) {
        return { ok: true, json: async () => ({ schemaVersion: 1, language: 'zh', packVersion: 'test', words: packWords }) };
      }
      return { ok: false, status: 404, statusText: 'not found' };
    });

    store = await import('../app/src/store.js');
    ({ renderReview } = await import('../app/src/views/review.js'));
    await store.init();
  });

  const key = (k) => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
  /** Grading awaits an IndexedDB transaction, so wait for the effect, not a fixed tick. */
  const until = async (predicate, label) => {
    for (let i = 0; i < 200; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('shows a front, flips on space, and grades on 1-4', async () => {
    const teardown = renderReview(root, { navigate: () => {} });

    // Front: hanzi only, no answer visible.
    expect(root.querySelector('.hanzi')).not.toBeNull();
    expect(root.querySelector('.ratings')).toBeNull();

    key(' ');
    // Back: the rating row appears.
    expect(root.querySelector('.ratings')).not.toBeNull();
    expect(root.querySelectorAll('.ratings .btn')).toHaveLength(4);

    const before = store.store.events.length;
    key('3');
    await until(() => store.store.events.length > before, 'the review to be recorded');
    await until(() => root.querySelector('.ratings') === null, 'the next card front');

    expect(store.store.events).toHaveLength(before + 1);
    expect(store.store.events.at(-1).rating).toBe(RATING.GOOD);
    // And the next card is showing its front again.
    expect(root.querySelector('.ratings')).toBeNull();
    teardown?.();
  });

  it('records the review durably, so a reload replays to the same state', async () => {
    const teardown = renderReview(root, { navigate: () => {} });
    key(' ');
    key('3');
    await until(() => store.store.events.length === 1, 'the review to be recorded');
    teardown?.();

    const hashBefore = store.currentHash();
    const cardId = store.store.events.at(-1).cardId;

    // Re-open from storage exactly as a cold start would.
    vi.resetModules();
    const fresh = await import('../app/src/store.js');
    await fresh.init();

    expect(fresh.store.events).toHaveLength(1);
    expect(fresh.store.events[0].cardId).toBe(cardId);
    expect(fresh.currentHash()).toBe(hashBefore);
  });

  it('stops listening for shortcuts once the view is torn down', async () => {
    const teardown = renderReview(root, { navigate: () => {} });
    key(' ');
    key('3');
    await until(() => store.store.events.length === 1, 'the review to be recorded');
    const after = store.store.events.length;

    teardown?.();
    key(' ');
    key('3');
    await flush();
    expect(store.store.events).toHaveLength(after);
  });

  it('grades over plain HTTP, where crypto.randomUUID does not exist', async () => {
    // Reproduces testing on a phone against a dev machine's LAN address: a non-secure
    // context, so `crypto.randomUUID` is undefined and every grade used to throw,
    // leaving the session stuck on the back of the first card.
    const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
    try {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });

      const teardown = renderReview(root, { navigate: () => {} });
      key(' ');
      expect(root.querySelector('.ratings')).not.toBeNull();

      key('3');
      await until(() => store.store.events.length === 1, 'the review to be recorded');
      await until(() => root.querySelector('.ratings') === null, 'the session to advance');

      expect(store.store.events[0].id).toMatch(/^[0-9a-f-]{36}$/);
      teardown?.();
    } finally {
      if (original) Object.defineProperty(globalThis.crypto, 'randomUUID', original);
    }
  });

  it('offers no more new cards than the daily limit allows', async () => {
    await store.updateSettings({ newPerDay: 2 });
    const { cards, newCount } = store.queue();
    expect(newCount).toBe(2);
    expect(cards).toHaveLength(2);
  });
});

describe('design system v2 (§C)', () => {
  it('maps every route and card mode to a vendored icon', async () => {
    const { ROUTE_ICONS, MODE_ICONS, iconFor, iconForMode } = await import('../app/src/ui/icons.js');
    const { ICON_NAMES } = await import('../app/src/ui/components.js');

    // Every mapping points at a file we actually vendored.
    for (const name of Object.values(ROUTE_ICONS)) expect(ICON_NAMES).toContain(name);
    for (const name of Object.values(MODE_ICONS)) expect(ICON_NAMES).toContain(name);

    expect(Object.keys(ROUTE_ICONS)).toEqual(['home', 'review', 'browse', 'words', 'stats', 'settings']);
    expect(Object.keys(MODE_ICONS)).toEqual(['REC', 'LIS', 'PROD', 'SENT', 'WRITE']);

    // A host element comes back synchronously; the SVG fills in when it loads.
    const host = iconFor('home');
    expect(host.dataset.icon).toBe('home');
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(iconForMode('LIS').dataset.icon).toBe('volume-2');

    // Unknown names render nothing rather than throwing.
    expect(iconFor('nope')).toBeNull();
    expect(iconForMode('NOPE')).toBeNull();
  });

  it('inlines a vendored SVG without innerHTML, and survives a missing one', async () => {
    const { icon, resetIcons } = await import('../app/src/ui/components.js');
    resetIcons();

    globalThis.fetch = vi.fn(async (url) =>
      String(url).includes('check.svg')
        ? { ok: true, text: async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>' }
        : { ok: false, status: 404 },
    );

    const good = icon('check', 16);
    await vi.waitFor(() => expect(good.querySelector('svg')).not.toBeNull());
    const svg = good.querySelector('svg');
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('path')).not.toBeNull();

    // A 404 leaves an empty host instead of breaking the screen.
    const missing = icon('nope');
    await new Promise((r) => setTimeout(r, 10));
    expect(missing.querySelector('svg')).toBeNull();
    resetIcons();
  });

  it('shows an interval preview on every grade button, matching the schedule', async () => {
    vi.resetModules();
    const { IDBFactory } = await import('fake-indexeddb');
    globalThis.indexedDB = new IDBFactory();
    const w = { id: 'w1', simp: '一', pinyin: 'yī', pinyinNum: 'yi1', defs: ['one'], band: 1, sentences: [] };
    globalThis.fetch = vi.fn(async (url) =>
      String(url).includes('deck.')
        ? { ok: true, json: async () => ({ schemaVersion: 1, language: 'zh', packVersion: 't', words: [w] }) }
        : { ok: false, status: 404, statusText: 'nope' },
    );

    const store = await import('../app/src/store.js');
    const { renderReview } = await import('../app/src/views/review.js');
    await store.init();

    const host = document.createElement('div');
    document.body.append(host);
    const teardown = renderReview(host, { navigate: () => {} });

    // A session progress bar sits under the app bar.
    expect(host.querySelector('.session-bar-fill')).not.toBeNull();

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));

    const buttons = [...host.querySelectorAll('.ratings .btn')];
    expect(buttons).toHaveLength(4);

    // A brand-new card still gets previews: it is what most of a first session is.
    const previews = buttons.map((b) => b.querySelector('.interval')?.textContent);
    expect(previews.every(Boolean), `previews: ${previews}`).toBe(true);
    expect(previews[0]).not.toBe(previews[3]);

    // And they are the real schedule, not decoration.
    const { newCard, previewSchedules } = await import('../app/src/engine/srs.js');
    const { formatInterval } = await import('../app/src/ui/components.js');
    const at = Date.now();
    const expected = previewSchedules(newCard(new Date(at)), at);
    expect(previews[2]).toBe(formatInterval(expected[3].due, at));
    teardown?.();
  });
});
