import { describe, expect, it } from 'vitest';
import { numToMarks, syllableTone, syllableToMarks } from '../packs/zh/lib/pinyin.js';

describe('pinyin', () => {
  // The required vectors from §7.
  const vectors = [
    ['hao3', 'hǎo'],
    ['lu:4', 'lǜ'],
    ['lv4', 'lǜ'],
    ['xie4', 'xiè'],
    ['liu2', 'liú'],
    ['gui4', 'guì'],
    ['er2', 'ér'],
    ['nu:3', 'nǚ'],
    ['xiong2', 'xióng'],
    ['ma5', 'ma'],
  ];

  it.each(vectors)('converts %s → %s', (input, expected) => {
    expect(syllableToMarks(input)).toBe(expected);
  });

  it('joins a word without spaces', () => {
    expect(numToMarks('chuan2 tong3')).toBe('chuántǒng');
    expect(numToMarks('xue2 xi2')).toBe('xuéxí');
    expect(numToMarks('xie4 xie5')).toBe('xièxie');
  });

  it('keeps sentence pinyin spaced when asked', () => {
    expect(numToMarks('zhe4 shi4 yi1 ge4', { separator: ' ' })).toBe('zhè shì yī gè');
  });

  it('applies the a > e > ou > last-vowel placement rule', () => {
    expect(syllableToMarks('shuai4')).toBe('shuài'); // a wins
    expect(syllableToMarks('zhuo2')).toBe('zhuó'); // last vowel
    expect(syllableToMarks('gou3')).toBe('gǒu'); // ou → mark the o
    expect(syllableToMarks('jue2')).toBe('jué'); // e wins
  });

  it('preserves capitalized syllables from CEDICT proper nouns', () => {
    expect(numToMarks('Zhong1 guo2')).toBe('Zhōngguó');
    expect(syllableToMarks('An1')).toBe('Ān');
  });

  it('passes through toneless input and punctuation', () => {
    expect(syllableToMarks('de')).toBe('de');
    expect(syllableToMarks('。')).toBe('。');
  });

  it('reports the tone for coloring', () => {
    expect(syllableTone('hao3')).toBe(3);
    expect(syllableTone('ma5')).toBe(5);
    expect(syllableTone('de')).toBe(5);
    expect(syllableTone('。')).toBe(0);
  });
});
