// @vitest-environment jsdom
/**
 * Per-word usage notes (the 两 vs 二 explanation): committed reviewable data shown on the teach
 * screen, characters hoverable. Deck bytes stay untouched — the note lives in usage-notes.json.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../app/src/zh/audio.js', () => ({
  speak: vi.fn(), speakSlow: vi.fn(), ready: async () => ({}), isAvailable: () => true,
}));

const { store } = await import('../app/src/store.js');
const { renderTeach } = await import('../app/src/views/teach.js');

const word = (id, simp) => ({ id, simp, pinyin: 'liǎng', pinyinNum: 'liang3', defs: ['two'], band: 1, sentences: [] });

describe('usage note on the teach screen', () => {
  it('renders the committed note, with its hanzi wrapped as hoverable glosses', () => {
    store.deck = { words: [word('zh:两:liang3', '两')] };
    store.usageNotes = { 'zh:两:liang3': '两 (liǎng) is used before a measure word — 两个人.' };

    const node = renderTeach(word('zh:两:liang3', '两'), () => {});
    const note = node.querySelector('.usage-note');
    expect(note).not.toBeNull();
    expect(note.textContent).toContain('两 (liǎng)');
    expect(note.querySelectorAll('.gloss').length).toBeGreaterThan(0); // hanzi are hoverable
  });

  it('shows nothing when a word has no note', () => {
    store.usageNotes = {};
    const node = renderTeach(word('zh:好:hao3', '好'), () => {});
    expect(node.querySelector('.usage-note')).toBeNull();
  });
});
