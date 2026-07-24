// @vitest-environment jsdom
/**
 * The session-done path, driven deterministically on every platform. Twice now, only
 * the Windows runner's test order ever reached finish() — first hitting the missing
 * hardestWordToday, then the incomplete writer.js mock. This file removes the lottery:
 * finish() runs here, unconditionally, on every OS, both with and without a struggle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/src/zh/writer.js', () => ({
  mountQuiz: () => ({ writer: {}, mistakes: () => 0, reveal: () => {}, destroy: () => {} }),
  loadCharData: async () => ({ strokes: [], medians: [] }),
  hasStrokeData: async () => true,
  neonIgnite: vi.fn(),
}));

vi.mock('../app/src/zh/audio.js', () => ({
  ready: async () => ({ lang: 'zh-CN' }),
  isAvailable: () => true,
  speak: vi.fn(async () => true),
  speakSlow: vi.fn(async () => true),
  stop: vi.fn(),
  pickVoice: () => null,
  chineseVoices: () => [],
  setVoice: vi.fn(),
  rotate: vi.fn(),
}));

const packWord = {
  id: 'zh:一:yi1', simp: '一', pinyin: 'yī', pinyinNum: 'yi1',
  defs: ['one'], band: 1, sentences: [],
};

describe('session done', () => {
  let store;
  let renderReview;
  let root;

  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
    const { IDBFactory } = await import('fake-indexeddb');
    globalThis.indexedDB = new IDBFactory();
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('deck.')) {
        return { ok: true, json: async () => ({ schemaVersion: 1, language: 'zh', packVersion: 'test', words: [packWord] }) };
      }
      return { ok: false, status: 404, statusText: 'not found' };
    });
    store = await import('../app/src/store.js');
    ({ renderReview } = await import('../app/src/views/review.js'));
    await store.init();
  });

  const key = (k) => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
  const until = async (predicate, label) => {
    for (let i = 0; i < 300; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  const maybePassTeach = () => {
    const gotIt = [...root.querySelectorAll('button')].find((b) => /got it/i.test(b.textContent));
    gotIt?.click();
  };
  const reveal = async () => {
    maybePassTeach();
    await until(() => root.querySelector('.hanzi, .ratings'), 'a card to render');
    if (root.querySelector('.ratings')) return;
    key(' ');
    await until(() => root.querySelector('.ratings'), 'the back to show');
    await until(
      () => !root.querySelector('.controls')?.classList.contains('controls-hidden'),
      'the flip to complete',
    );
  };
  const done = () => root.querySelector('.review-done');
  const driveToDone = async (firstRating) => {
    let rating = firstRating;
    for (let i = 0; i < 20 && !done(); i++) {
      maybePassTeach();
      if (!done()) {
        await reveal();
        const before = store.store.events.length;
        key(String(rating));
        rating = 3;
        await until(() => store.store.events.length > before || done(), 'the grade to land');
      }
    }
    await until(done, 'the done screen');
  };

  it('reaches the done screen on an easy day — no sign, no crash', async () => {
    const teardown = renderReview(root, { navigate: () => {} });
    await driveToDone(3);
    expect(done()).not.toBeNull();
    expect(root.querySelector('.done-sign')).toBeNull();
    teardown?.();
  });

  it('lights the sign for the word that earned it', async () => {
    const teardown = renderReview(root, { navigate: () => {} });
    await driveToDone(1);
    expect(done()).not.toBeNull();
    expect(root.querySelector('.done-sign')).not.toBeNull();
    teardown?.();
  });
});
