import { describe, expect, it } from 'vitest';
import { parseCedict } from '../packs/zh/lib/cedict.js';
import { homographMarker } from '../packs/zh/lib/hsk.js';
import {
  applyOverrides,
  attachAltReadings,
  distinctReadings,
  markSplitGroups,
  resolveWords,
} from '../packs/zh/lib/words.js';

const CEDICT = [
  '好 好 [hao3] /good/well/proper/',
  '好 好 [hao4] /to be fond of/',
  '別 别 [bie2] /to leave/other/',
  '別 别 [bie4] /to make sb change their ways/',
  '點 点 [dian3] /point/dot/a little/o clock/',
  '學習 学习 [xue2 xi2] /to learn/to study/',
].join('\n');

const { bySimp } = parseCedict(CEDICT);

/** HSK entries in the shape parseHsk emits. */
const entry = (raw, band, variants = [raw.replace(/[0-9]+$/, '')]) => ({
  raw,
  variants,
  band,
  marker: homographMarker(raw),
});

describe('distinctReadings', () => {
  it('dedupes by pinyin and orders by definition count', () => {
    const readings = distinctReadings(bySimp.get('好'));
    expect(readings.map((r) => r.pinyinNum)).toEqual(['hao3', 'hao4']);
  });

  it('handles a spelling with one reading, and none at all', () => {
    expect(distinctReadings(bySimp.get('点'))).toHaveLength(1);
    expect(distinctReadings(undefined)).toEqual([]);
  });
});

describe('resolveWords', () => {
  it('keeps the lowest band and never mints a ~N id for a homograph marker', () => {
    const state = resolveWords([entry('点1', 1), entry('点2', 4)], bySimp, 'zh');
    expect(state.words).toHaveLength(1);
    expect(state.words[0].id).toBe('zh:点:dian3');
    expect(state.words[0].band).toBe(1);
    expect(state.duplicates).toBe(1);
    expect(state.collisions).toBe(0);
  });

  it('records every marked entry with the reading it resolved to', () => {
    const { homographs } = resolveWords([entry('别1', 2), entry('别2', 5)], bySimp, 'zh');
    expect(homographs).toHaveLength(2);
    expect(homographs.map((h) => [h.raw, h.marker, h.resolvedPinyin])).toEqual([
      ['别1', 1, 'bié'],
      ['别2', 2, 'bié'],
    ]);
    // The untaught reading is surfaced for curation rather than assigned automatically.
    expect(homographs[1].alternatives.map((a) => a.pinyinNum)).toEqual(['bie4']);
  });

  it('reports entries CC-CEDICT does not have', () => {
    const state = resolveWords([entry('新媒体', 6)], bySimp, 'zh');
    expect(state.words).toHaveLength(0);
    expect(state.missing).toEqual(['新媒体']);
  });
});

describe('attachAltReadings', () => {
  it('adds untaught readings with a gloss, and skips taught ones', () => {
    const state = resolveWords([entry('好', 1)], bySimp, 'zh');
    attachAltReadings(state.words, bySimp);
    expect(state.words[0].altReadings).toEqual([
      { pinyin: 'hào', pinyinNum: 'hao4', gloss: 'to be fond of' },
    ]);

    // Once both readings are deck words, neither repeats on the other's card back.
    const split = resolveWords([entry('别1', 2)], bySimp, 'zh');
    applyOverrides({ words: [{ simp: '别', pinyinNum: 'bie4', band: 5 }] }, split, bySimp);
    attachAltReadings(split.words, bySimp);
    expect(split.words.every((w) => w.altReadings === undefined)).toBe(true);
  });

  it('leaves single-reading words alone', () => {
    const state = resolveWords([entry('学习', 1)], bySimp, 'zh');
    attachAltReadings(state.words, bySimp);
    expect(state.words[0].altReadings).toBeUndefined();
  });
});

describe('markSplitGroups', () => {
  /** 别 taught as both bié and biè. */
  const splitDeck = () => {
    const state = resolveWords([entry('别1', 2)], bySimp, 'zh');
    applyOverrides({ words: [{ simp: '别', pinyinNum: 'bie4', band: 5 }] }, state, bySimp);
    return state;
  };

  it('names each member siblings and marks exactly one primary', () => {
    const state = splitDeck();
    const stats = markSplitGroups(state.words, bySimp);
    expect(stats).toEqual({ groups: 1, members: 2 });

    const bie2 = state.words.find((w) => w.id === 'zh:别:bie2');
    const bie4 = state.words.find((w) => w.id === 'zh:别:bie4');
    expect(bie2.splitGroup).toEqual(['zh:别:bie4']);
    expect(bie4.splitGroup).toEqual(['zh:别:bie2']);
    // The CC-CEDICT primary reading wins — that is what TTS would say.
    expect(bie2.splitPrimary).toBe(true);
    expect(bie4.splitPrimary).toBe(false);
    expect(bie2.splitGroup).not.toContain(bie2.id);
  });

  it('leaves words that do not share a spelling untouched', () => {
    const state = resolveWords([entry('好', 1), entry('学习', 1)], bySimp, 'zh');
    markSplitGroups(state.words, bySimp);
    for (const w of state.words) {
      expect(w.splitGroup).toBeUndefined();
      expect(w.splitPrimary).toBeUndefined();
    }
  });

  it('still picks a primary when CC-CEDICT knows neither reading', () => {
    const state = resolveWords([], bySimp, 'zh');
    applyOverrides(
      {
        words: [
          { simp: '新媒体', pinyinNum: 'xin1 mei2 ti3', band: 6, defs: ['new media'] },
          { simp: '新媒体', pinyinNum: 'xin1 mei2 ti4', band: 7, defs: ['coined variant'] },
        ],
      },
      state,
      bySimp,
    );
    markSplitGroups(state.words, bySimp);
    expect(state.words.filter((w) => w.splitPrimary)).toHaveLength(1);
    expect(state.words[0].splitPrimary).toBe(true);
  });
});

describe('applyOverrides', () => {
  it('adds a word, taking defs and trad from CC-CEDICT', () => {
    const state = resolveWords([entry('别1', 2)], bySimp, 'zh');
    const result = applyOverrides({ words: [{ simp: '别', pinyinNum: 'bie4', band: 5 }] }, state, bySimp);
    expect(result.added).toBe(1);
    const added = state.words.find((w) => w.id === 'zh:别:bie4');
    expect(added).toMatchObject({ pinyin: 'biè', band: 5, trad: '別' });
    expect(added.defs).toEqual(['to make sb change their ways']);
  });

  it('adds a word CC-CEDICT does not have', () => {
    const state = resolveWords([], bySimp, 'zh');
    applyOverrides(
      { words: [{ simp: '新媒体', pinyinNum: 'xin1 mei2 ti3', band: 6, defs: ['new media'] }] },
      state,
      bySimp,
    );
    expect(state.words[0]).toMatchObject({
      id: 'zh:新媒体:xin1_mei2_ti3',
      pinyin: 'xīnméitǐ',
      defs: ['new media'],
    });
  });

  it('patches and removes by id, and recomputes pinyin when the reading changes', () => {
    const state = resolveWords([entry('好', 1)], bySimp, 'zh');
    applyOverrides({ words: [{ id: 'zh:好:hao3', defs: ['good'] }] }, state, bySimp);
    expect(state.words[0].defs).toEqual(['good']);

    applyOverrides({ words: [{ id: 'zh:好:hao3', pinyinNum: 'hao4' }] }, state, bySimp);
    expect(state.words[0].pinyin).toBe('hào');

    const removed = applyOverrides({ words: [{ id: 'zh:好:hao3', remove: true }] }, state, bySimp);
    expect(removed.removed).toBe(1);
    expect(state.words).toHaveLength(0);
  });

  it('strips $-prefixed annotations instead of writing them into the deck', () => {
    const state = resolveWords([], bySimp, 'zh');
    applyOverrides(
      { words: [{ $group: 'notes for humans', simp: '好', pinyinNum: 'hao4', band: 3 }] },
      state,
      bySimp,
    );
    expect(Object.keys(state.words[0]).some((k) => k.startsWith('$'))).toBe(false);
  });

  it('warns rather than throwing on unusable entries', () => {
    const state = resolveWords([], bySimp, 'zh');
    const result = applyOverrides(
      {
        words: [
          { id: 'zh:nope:x', defs: ['x'] },
          { id: 'zh:nope:x', remove: true },
          { simp: '好' },
          { simp: '無', pinyinNum: 'wu2' },
        ],
      },
      state,
      bySimp,
    );
    expect(result.warnings).toHaveLength(4);
    expect(state.words).toHaveLength(0);
  });
});
