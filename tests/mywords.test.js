/**
 * @vitest-environment jsdom
 *
 * My Words: the queue-jump rule, the status chip, and removal semantics.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeck } from '../app/src/engine/deck.js';
import { newCardCandidates, buildQueue } from '../app/src/engine/queue.js';
import { rebuildFromEvents, stateHash } from '../app/src/engine/replay.js';

vi.mock('../app/src/zh/writer.js', () => ({
  mountQuiz: () => ({ destroy: () => {}, reveal: () => {}, mistakes: () => 0, writer: {} }),
  loadCharData: async () => ({}),
  hasStrokeData: async () => true,
}));
vi.mock('../app/src/zh/tts.js', () => ({
  ready: async () => null,
  isAvailable: () => false,
  speak: async () => false,
  stop: () => {},
  pickVoice: () => null,
  reset: () => {},
}));

const packWord = (id, band, index) => ({
  id,
  simp: id,
  pinyin: 'yī',
  pinyinNum: 'yi1',
  defs: ['one'],
  band,
  sentences: [],
  index,
});

const customWord = (id, updatedAt) => ({
  id,
  simp: id,
  pinyin: 'kāfēi',
  pinyinNum: 'ka1 fei1',
  defs: ['coffee'],
  band: 0,
  custom: true,
  updatedAt,
  deleted: false,
  sentences: [],
});

describe('custom words jump the new-card queue (§8)', () => {
  it('puts custom words ahead of band 1 pack words', () => {
    const deck = createDeck({ words: [packWord('p1', 1), packWord('p2', 1)] }, [
      customWord('c1', 1000),
    ]);
    expect(newCardCandidates(deck, new Map()).map((c) => c.wordId)).toEqual(['c1', 'p1', 'p2']);
  });

  it('orders several custom words newest first', () => {
    const deck = createDeck({ words: [packWord('p1', 1)] }, [
      customWord('older', 1000),
      customWord('newest', 3000),
      customWord('middle', 2000),
    ]);
    expect(newCardCandidates(deck, new Map()).map((c) => c.wordId)).toEqual([
      'newest',
      'middle',
      'older',
      'p1',
    ]);
  });

  it('still honours NEW_CARDS_PER_DAY', () => {
    const words = Array.from({ length: 40 }, (_, i) => packWord(`p${i}`, 1));
    const customs = Array.from({ length: 5 }, (_, i) => customWord(`c${i}`, 1000 + i));
    const deck = createDeck({ words }, customs);

    const { cards, newCount } = buildQueue(deck, new Map(), { now: Date.now(), maxNew: 3 });
    expect(newCount).toBe(3);
    // The three that made the cut are all custom, newest first.
    expect(cards).toEqual(['c4#REC', 'c3#REC', 'c2#REC']);
  });

  it('leaves pack ordering alone when there are no custom words', () => {
    const deck = createDeck({ words: [packWord('b3', 3), packWord('b1', 1), packWord('b2', 2)] });
    expect(newCardCandidates(deck, new Map()).map((c) => c.wordId)).toEqual(['b1', 'b2', 'b3']);
  });
});

describe('status chip', () => {
  it('reports up next, learning, and a due date', async () => {
    const { statusOf } = await import('../app/src/views/words.js');
    const word = customWord('c1', 1000);
    const id = 'c1#REC';
    const now = Date.UTC(2026, 6, 21, 12);

    expect(statusOf(word, new Map(), now).kind).toBe('next');
    expect(statusOf(word, new Map([[id, { reps: 0, state: 0 }]]), now).kind).toBe('next');
    expect(statusOf(word, new Map([[id, { reps: 1, state: 1 }]]), now).kind).toBe('learning');
    expect(statusOf(word, new Map([[id, { reps: 1, state: 3 }]]), now).kind).toBe('learning');

    const due = statusOf(word, new Map([[id, { reps: 4, state: 2, due: now + 86400000 }]]), now);
    expect(due.kind).toBe('due');
    expect(due.label).toContain('tomorrow');
  });
});

describe('the view', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('lists custom words newest first with their status, and no pack words', async () => {
    vi.resetModules();
    const store = await import('../app/src/store.js');
    const { renderWords } = await import('../app/src/views/words.js');

    store.store.deck = createDeck({ words: [packWord('p1', 1)] }, [
      customWord('older', 1000),
      customWord('newest', 2000),
    ]);
    store.store.states = new Map();

    const root = document.createElement('div');
    document.body.append(root);
    renderWords(root, { navigate: () => {} });

    const rows = [...root.querySelectorAll('.list-row')];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.querySelector('.row-hanzi').textContent)).toEqual([
      'newest',
      'older',
    ]);
    // A pack word is not "my word".
    expect(root.textContent).not.toContain('p1');
    expect(rows[0].querySelector('.chip').textContent).toBe('Up next');
  });

  it('shows an empty state with a way into Browse', async () => {
    vi.resetModules();
    const store = await import('../app/src/store.js');
    const { renderWords } = await import('../app/src/views/words.js');

    store.store.deck = createDeck({ words: [packWord('p1', 1)] });
    store.store.states = new Map();

    const root = document.createElement('div');
    document.body.append(root);
    const navigate = vi.fn();
    renderWords(root, { navigate });

    expect(root.querySelector('.list-row')).toBeNull();
    expect(root.textContent).toContain('No words of your own yet');
    root.querySelector('.btn-primary').click();
    expect(navigate).toHaveBeenCalledWith('#browse');
  });

  it('hides removal behind a confirm step', async () => {
    vi.resetModules();
    const store = await import('../app/src/store.js');
    const { renderWords } = await import('../app/src/views/words.js');

    store.store.deck = createDeck({ words: [] }, [customWord('c1', 1000)]);
    store.store.states = new Map();

    const root = document.createElement('div');
    document.body.append(root);
    renderWords(root, { navigate: () => {} });

    const actions = root.querySelector('.row-actions');
    expect(actions.querySelectorAll('.btn')).toHaveLength(1);

    actions.querySelector('.btn').click();
    // Confirm step: a warning, a cancel and a destructive confirm.
    expect(actions.textContent).toContain('Remove');
    expect(actions.querySelector('.btn-danger')).not.toBeNull();

    actions.querySelector('.btn-quiet').click();
    expect(actions.querySelectorAll('.btn')).toHaveLength(1);
    expect(actions.querySelector('.btn-danger')).toBeNull();
  });
});

describe('removal semantics', () => {
  it('replays cleanly after a word is gone, keeping the other words intact', () => {
    const withCustom = createDeck({ words: [packWord('p1', 1)] }, [customWord('c1', 1000)]);
    const log = [
      { id: 'e1', cardId: 'p1#REC', rating: 3, ts: Date.UTC(2026, 6, 21, 9) },
      { id: 'e2', cardId: 'c1#REC', rating: 3, ts: Date.UTC(2026, 6, 21, 10) },
      { id: 'e3', cardId: 'p1#REC', rating: 4, ts: Date.UTC(2026, 6, 24, 9) },
    ];

    const before = rebuildFromEvents(withCustom, log);
    expect(before.skipped).toBe(0);
    expect(before.states.has('c1#REC')).toBe(true);

    // Tombstoned: createDeck drops it, and its events become unreplayable.
    const afterRemoval = createDeck({ words: [packWord('p1', 1)] }, [
      { id: 'c1', deleted: 1, updatedAt: 2000 },
    ]);
    const after = rebuildFromEvents(afterRemoval, log);

    expect(afterRemoval.has('c1')).toBe(false);
    expect(after.skipped).toBe(1);
    expect(after.states.has('c1#REC')).toBe(false);

    // The surviving word's scheduling is untouched by the removal.
    const onlyPack = rebuildFromEvents(afterRemoval, log.filter((e) => e.cardId.startsWith('p1')));
    expect(stateHash(after.states)).toBe(stateHash(onlyPack.states));
  });

  it('tombstones through the store, keeping events but dropping cards', async () => {
    vi.resetModules();
    const { IDBFactory } = await import('fake-indexeddb');
    globalThis.indexedDB = new IDBFactory();
    globalThis.fetch = vi.fn(async (url) =>
      String(url).includes('deck.')
        ? { ok: true, json: async () => ({ schemaVersion: 1, language: 'zh', packVersion: 't', words: [packWord('p1', 1)] }) }
        : { ok: false, status: 404, statusText: 'nope' },
    );

    const store = await import('../app/src/store.js');
    await store.init();

    await store.addCustomWord({ id: 'c1', simp: '咖啡', pinyin: 'kāfēi', pinyinNum: 'ka1 fei1', defs: ['coffee'], sentences: [] });
    expect(store.store.deck.has('c1')).toBe(true);
    expect(store.store.deck.custom().map((w) => w.id)).toEqual(['c1']);

    await store.recordReview({ cardId: 'c1#REC', rating: 3 });
    expect(store.store.events).toHaveLength(1);
    expect(store.store.states.has('c1#REC')).toBe(true);

    expect(await store.removeCustomWord('c1')).toBe(true);

    // Word gone, cards gone, event kept — the log is immutable (§2).
    expect(store.store.deck.has('c1')).toBe(false);
    expect(store.store.deck.custom()).toEqual([]);
    expect(store.store.states.has('c1#REC')).toBe(false);
    expect(store.store.events).toHaveLength(1);

    // And it never comes back in a queue.
    expect(store.queue().cards).not.toContain('c1#REC');

    // A cold start agrees.
    vi.resetModules();
    const fresh = await import('../app/src/store.js');
    await fresh.init();
    expect(fresh.store.deck.has('c1')).toBe(false);
    expect(fresh.store.events).toHaveLength(1);
  });
});
