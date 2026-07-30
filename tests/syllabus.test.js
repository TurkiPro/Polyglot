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
  // Two sittings; the checkpoint sits outside both, as the pipeline emits it.
  lessons: [{ title: 'First lesson', from: 0, to: 3 }, { from: 3, to: 4 }],
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

  it('lists LESSONS, not one row per card (Phase 12)', () => {
    const navigate = vi.fn();
    renderSyllabusPage(root, { navigate });

    expect(root.querySelector('.syllabus')).not.toBeNull();
    expect(root.querySelector('.syllabus-overall-label').textContent).toMatch(/% of the course/);

    // 5 steps become 2 lessons + 1 checkpoint — the whole point: a unit is a handful of rows.
    const rows = root.querySelectorAll('.syllabus-step');
    expect(rows.length).toBe(unit.lessons.length + 1);
    expect(rows.length).toBeLessThan(unit.steps.length);

    root.querySelector('.syllabus-step.kind-lesson').click();
    expect(navigate).toHaveBeenCalledWith('#lesson/u001/l1');
    // The checkpoint is always its own row, never folded inside a lesson.
    expect(root.querySelector('.syllabus-step.kind-checkpoint')).not.toBeNull();
  });

  it('renders rows as real links, so middle-click and copy-link work', () => {
    renderSyllabusPage(root, { navigate: vi.fn() });
    const row = root.querySelector('.syllabus-step.kind-lesson');
    expect(row.tagName).toBe('A');
    expect(row.getAttribute('href')).toBe('#lesson/u001/l1');
  });

  it('does not make a locked checkpoint clickable', () => {
    // Nothing introduced ⇒ the checkpoint's words are unmet ⇒ locked.
    renderSyllabusPage(root, { navigate: vi.fn() });
    const checkpoint = root.querySelector('.syllabus-step.kind-checkpoint.state-locked');
    expect(checkpoint).not.toBeNull();
    expect(checkpoint.tagName).not.toBe('A');
    expect(checkpoint.getAttribute('aria-disabled')).toBe('true');
  });

  it('a step link starts the runner at that step (free navigation)', () => {
    store.store.settings.newPerDay = 10;
    store.store.settings.newPerDayExplicit = true;
    renderLesson(root, { navigate: vi.fn() }, 'u001/1');
    expect(text()).toContain('乙'); // jumped straight to the second word
  });

  it('gives one section per band even when bands are interleaved (not repeated runs)', () => {
    // The n+1 order weaves bands: 1, 2, 1, 3, 2 … Grouping must yield ONE section per band
    // (3 here), each gathering all its units — never a fresh "HSK 1" every time the band recurs.
    const mk = (id, band) => ({
      id, title: id, band, wordIds: [`${id}:w`],
      steps: [{ kind: 'WORD', wordId: `${id}:w` }, { kind: 'CHECKPOINT' }],
    });
    store.store.course = {
      units: [mk('u001', 1), mk('u002', 2), mk('u003', 1), mk('u004', 3), mk('u005', 2)],
    };

    renderSyllabusPage(root, { navigate: vi.fn() });
    const bands = [...root.querySelectorAll('.syllabus-band .band-title')].map((n) => n.textContent);
    expect(bands).toEqual(['HSK 1', 'HSK 2', 'HSK 3']); // three sections, in first-appearance order
    // The current band (HSK 1) gathers BOTH its units (u001 and the interleaved u003).
    const openBand = root.querySelector('.syllabus-band[open]');
    expect(openBand.querySelector('.band-title').textContent).toBe('HSK 1');
    expect(openBand.querySelectorAll('.syllabus-unit').length).toBe(2);
  });

  it('numbers a recurring topic title as a series, leaving unique titles clean', () => {
    const mk = (id, title) => ({
      id, title, band: 1, wordIds: [`${id}:w`],
      steps: [{ kind: 'WORD', wordId: `${id}:w` }, { kind: 'CHECKPOINT' }],
    });
    store.store.course = {
      units: [mk('u001', 'People & family'), mk('u002', 'Work & school'),
        mk('u003', 'People & family'), mk('u004', 'Food & drink'), mk('u005', 'People & family')],
    };

    renderSyllabusPage(root, { navigate: vi.fn() });
    const titles = [...root.querySelectorAll('.syllabus-unit .unit-title')].map((n) => n.textContent);
    expect(titles).toEqual([
      'People & family 1', 'Work & school', 'People & family 2', 'Food & drink', 'People & family 3',
    ]);
  });

  it('runs Unit 0 "The Sounds" as ordinary course content', () => {
    const soundsUnit = {
      id: 'u000', title: 'The Sounds', band: 0, sounds: true, wordIds: [],
      steps: [{ kind: 'TONES', set: 'intro' }, { kind: 'PINYIN' }, { kind: 'CHECKPOINT' }],
      lessons: [{ title: 'The sounds of Chinese', from: 0, to: 2 }],
    };
    store.store.course = { units: [soundsUnit, unit] };

    // The tree shows Unit 0 first, as one sitting like any other unit.
    renderSyllabusPage(root, { navigate: vi.fn() });
    const first = root.querySelector('.syllabus-unit');
    expect(first.textContent).toContain('The Sounds');
    expect(first.textContent).toContain('The sounds of Chinese');

    // The runner opens Unit 0 on its tone intro — the archetype to tap, not a vocabulary card.
    renderLesson(root, { navigate: vi.fn() }, 'u000');
    expect(root.querySelector('.tone-samples')).not.toBeNull();
  });
});
