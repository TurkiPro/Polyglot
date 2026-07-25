// @vitest-environment jsdom
/**
 * The syllabus surface and the step-driven runner (Phase 10 A2).
 *
 * Two properties matter most here. First, the runner walks the unit's `steps[]` — the same
 * list the syllabus renders — so there is one sequence, not two. Second, the syllabus is a map,
 * never a cap bypass: a WORD step for an unmet word still honours the daily new-card cap, so a
 * spent budget ends the sitting rather than smuggling in another introduction.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/src/zh/writer.js', () => ({
  mountQuiz: () => ({ writer: {}, mistakes: () => 0, reveal: () => {}, destroy: () => {} }),
  loadCharData: async () => ({ strokes: [], medians: [] }),
  hasStrokeData: async () => true,
  neonIgnite: vi.fn(),
}));
vi.mock('../app/src/zh/audio.js', () => ({
  ready: async () => ({ lang: 'zh-CN' }), isAvailable: () => true,
  speak: vi.fn(async () => true), speakSlow: vi.fn(async () => true), stop: vi.fn(),
  pickVoice: () => null, chineseVoices: () => [], setVoice: vi.fn(), rotate: vi.fn(),
}));

const W = (id, simp) => ({
  id, simp, pinyin: 'hǎo', pinyinNum: 'hao3', defs: ['good'], band: 1,
  sentences: [{ zh: `${simp}。`, pinyin: 'hǎo.', pinyinAuto: true, en: 'x', src: 't#1' }],
});
const packWords = [W('zh:a:a1', '甲'), W('zh:b:b1', '乙'), W('zh:c:c1', '丙')];

/** One unit whose steps interleave words with a practice set, checkpoint last. */
const unit = {
  id: 'u001', title: 'First unit', band: 1,
  wordIds: packWords.map((w) => w.id),
  steps: [
    { kind: 'WORD', wordId: 'zh:a:a1' },
    { kind: 'WORD', wordId: 'zh:b:b1' },
    { kind: 'PRACTICE' },
    { kind: 'WORD', wordId: 'zh:c:c1' },
    { kind: 'CHECKPOINT' },
  ],
};

describe('syllabus + runner (A2)', () => {
  let store; let renderLesson; let renderSyllabusPage; let root;

  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
    const { IDBFactory } = await import('fake-indexeddb');
    globalThis.indexedDB = new IDBFactory();
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('deck.')) {
        return { ok: true, json: async () => ({ schemaVersion: 1, language: 'zh', packVersion: 't', words: packWords }) };
      }
      return { ok: false, status: 404, statusText: 'nf' };
    });
    store = await import('../app/src/store.js');
    ({ renderLesson } = await import('../app/src/views/lesson.js'));
    ({ renderSyllabusPage } = await import('../app/src/views/syllabus.js'));
    await store.init();
    store.store.course = { units: [unit] };
  });

  const text = () => root.textContent;

  it('the runner honours the daily new-card cap — a spent budget never introduces a word', async () => {
    store.store.settings.newPerDay = 0;
    store.store.settings.newPerDayExplicit = true; // no ramp: cap is exactly 0

    const before = store.store.events.length;
    renderLesson(root, { navigate: vi.fn() }, 'u001');

    // The first WORD step cannot introduce anything, so the sitting stops on the cap screen…
    expect(text()).toContain('daily limit');
    // …and not a single review was recorded.
    expect(store.store.events.length).toBe(before);
  });

  it('with budget, a WORD step teaches the word rather than capping', () => {
    store.store.settings.newPerDay = 10;
    store.store.settings.newPerDayExplicit = true;
    renderLesson(root, { navigate: vi.fn() }, 'u001');
    expect(text()).not.toContain('daily limit');
    expect(text()).toContain('甲'); // the first word's teach screen
  });

  it('renders the whole course as a tree with overall progress and tappable steps', () => {
    const navigate = vi.fn();
    renderSyllabusPage(root, { navigate });

    expect(root.querySelector('.syllabus')).not.toBeNull();
    expect(root.querySelector('.syllabus-overall-label').textContent).toMatch(/% of the course/);
    // The current unit is expanded, so its steps are present and clickable.
    const steps = root.querySelectorAll('.syllabus-step');
    expect(steps.length).toBe(unit.steps.length);
    steps[0].click();
    expect(navigate).toHaveBeenCalledWith('#lesson/u001/0');
    // The checkpoint step routes to the quiz, not a lesson step.
    root.querySelector('.syllabus-step.kind-checkpoint').click();
    expect(navigate).toHaveBeenCalledWith('#quiz/u001');
  });

  it('a step link starts the runner at that step (free navigation)', () => {
    store.store.settings.newPerDay = 10;
    store.store.settings.newPerDayExplicit = true;
    renderLesson(root, { navigate: vi.fn() }, 'u001/1');
    expect(text()).toContain('乙'); // jumped straight to the second word
  });
});
