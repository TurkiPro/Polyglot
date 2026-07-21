import { describe, expect, it } from 'vitest';
import { parseCedict, pickPrimary, pruneCrossRefs } from '../packs/zh/lib/cedict.js';
import { bandFromFilename, parseHsk, wordVariants } from '../packs/zh/lib/hsk.js';
import { IdAssigner, baseId } from '../packs/zh/lib/ids.js';
import { charLength, pickSentences, sentencePinyin } from '../packs/zh/lib/tatoeba.js';
import { numToMarks } from '../packs/zh/lib/pinyin.js';

describe('cedict', () => {
  const sample = [
    '# comment line',
    '#! date=2026-07-21T06:35:08Z',
    '傳統 传统 [chuan2 tong3] /tradition/traditional/',
    '好 好 [hao3] /good/well/proper/good to/easy to/very/so/(suffix indicating completion)/',
    '好 好 [hao4] /to be fond of/to have a tendency to/',
    '嗎 吗 [ma5] /(question particle for "yes-no" questions)/',
    'garbage line without brackets',
  ].join('\n');

  it('parses entries and skips comments and junk', () => {
    const { entries, bySimp, skipped } = parseCedict(sample);
    expect(entries).toHaveLength(4);
    expect(skipped).toBe(1);
    expect(entries[0]).toEqual({
      trad: '傳統',
      simp: '传统',
      pinyinNum: 'chuan2 tong3',
      defs: ['tradition', 'traditional'],
    });
    expect(bySimp.get('好')).toHaveLength(2);
  });

  it('drops cross-reference definitions only when real ones remain', () => {
    expect(pruneCrossRefs(['variant of 傳統', 'tradition'])).toEqual(['tradition']);
    expect(pruneCrossRefs(['old variant of 好[hao3]'])).toEqual(['old variant of 好[hao3]']);
    expect(pruneCrossRefs(['see 傳統', 'abbr. for X', 'tradition'])).toEqual(['tradition']);
  });

  it('picks the reading with the most definitions as primary', () => {
    const { bySimp } = parseCedict(sample);
    expect(pickPrimary(bySimp.get('好')).pinyinNum).toBe('hao3');
    expect(pickPrimary(undefined)).toBeUndefined();
  });
});

describe('hsk', () => {
  it('maps filenames to bands, collapsing 7-9 to 7', () => {
    expect(bandFromFilename('HSK_Level_1_words.txt')).toBe(1);
    expect(bandFromFilename('HSK_Level_7-9_words.txt')).toBe(7);
    expect(() => bandFromFilename('nope.txt')).toThrow();
  });

  it('strips homograph digits and expands optional parentheses', () => {
    expect(wordVariants('和1')).toEqual(['和']);
    expect(wordVariants('花2')).toEqual(['花']);
    expect(wordVariants('没（有）')).toEqual(['没有', '没']);
    expect(wordVariants('有时（候）')).toEqual(['有时候', '有时']);
    expect(wordVariants('学习')).toEqual(['学习']);
    expect(wordVariants('  ')).toEqual([]);
  });

  it('keeps list order and band for every entry', () => {
    const { entries, listed } = parseHsk([
      { filename: 'HSK_Level_1_words.txt', text: '好\n学习\n' },
      { filename: 'HSK_Level_2_words.txt', text: '好\n传统\n' },
    ]);
    expect(listed).toBe(4);
    expect(entries.map((e) => [e.variants[0], e.band])).toEqual([
      ['好', 1],
      ['学习', 1],
      ['好', 2],
      ['传统', 2],
    ]);
  });
});

describe('ids', () => {
  it('forms the §5.1 id shape', () => {
    expect(baseId('zh', '传统', 'chuan2 tong3')).toBe('zh:传统:chuan2_tong3');
    expect(baseId('zh', '好', 'hao3')).toBe('zh:好:hao3');
  });

  it('suffixes collisions ~2, ~3 and leaves the first untouched', () => {
    const ids = new IdAssigner('zh');
    expect(ids.assign('好', 'hao3')).toBe('zh:好:hao3');
    expect(ids.assign('好', 'hao3')).toBe('zh:好:hao3~2');
    expect(ids.assign('好', 'hao3')).toBe('zh:好:hao3~3');
    expect(ids.assign('好', 'hao4')).toBe('zh:好:hao4');
    expect(ids.collisions).toBe(2);
  });
});

describe('sentence pinyin', () => {
  const readings = new Map([
    ['这', 'zhe4'],
    ['是', 'shi4'],
    ['一个', 'yi1 ge4'],
    ['古老', 'gu3 lao3'],
    ['的', 'de5'],
    ['目的', 'mu4 di4'],
    ['传统', 'chuan2 tong3'],
  ]);
  const readingOf = (w) => readings.get(w);
  const toMarks = (p) => numToMarks(p, { separator: ' ' });
  const run = (text) => sentencePinyin(text, readingOf, toMarks, 8);

  it('segments greedily by longest match', () => {
    expect(run('这是一个古老的传统。')).toBe('zhè shì yī gè gǔ lǎo de chuán tǒng.');
  });

  it('prefers the longer word so shared characters get the right reading', () => {
    // 目的 is di4, not the particle de5 — greedy longest match is what buys this.
    expect(run('目的')).toBe('mù dì');
  });

  it('passes unknown characters through', () => {
    expect(run('这X是')).toBe('zhè X shì');
  });

  it('maps full-width punctuation without a leading space', () => {
    expect(run('这是！')).toBe('zhè shì!');
    expect(run('这，是')).toBe('zhè, shì');
  });
});

describe('sentence selection', () => {
  const cmn = new Map([
    [1, '好。'],
    [2, '这是一个很长的句子，用来测试排序。'],
    [3, '好吗？'],
    [4, '你好。'],
  ]);

  it('keeps the shortest, breaking ties by id for determinism', () => {
    const picked = pickSentences([2, 4, 3, 1], cmn, 3);
    expect(picked.map((s) => s.id)).toEqual([1, 3, 4]);
  });

  it('ignores unknown ids and de-duplicates', () => {
    expect(pickSentences([1, 1, 999], cmn, 3).map((s) => s.id)).toEqual([1]);
  });

  it('counts code points, not UTF-16 units', () => {
    expect(charLength('好吗？')).toBe(3);
  });
});
