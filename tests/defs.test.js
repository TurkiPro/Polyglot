/**
 * §3.3.4 — CC-CEDICT classifier fields are data, not glosses.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifiers, humanDefs, summarize } from '../app/src/zh/defs.js';

const dict = JSON.parse(
  readFileSync(new URL('../app/assets/packs/zh/dict.zh.json', import.meta.url), 'utf8'),
);
const entryFor = (simp, pinyinNum) =>
  dict
    .map(([s, trad, py, defs]) => ({ simp: s, trad, pinyinNum: py, defs }))
    .find((e) => e.simp === simp && (!pinyinNum || e.pinyinNum === pinyinNum));

describe('classifier handling, against the shipped dictionary', () => {
  it('strips CL: from 海 without touching its real glosses', () => {
    const hai = entryFor('海', 'hai3');
    expect(hai.defs.some((d) => d.startsWith('CL:'))).toBe(true);

    const shown = humanDefs(hai.defs);
    expect(shown.some((d) => d.includes('CL:'))).toBe(false);
    expect(shown).toContain('ocean');
    expect(shown).toContain('sea');

    // The row summary a user reads carries no machinery.
    expect(summarize(hai.defs)).not.toContain('CL:');
    expect(summarize(hai.defs)).toContain('ocean');
  });

  it('parses 海 measure words into readable forms', () => {
    // "CL:個|个[ge4],片[pian4]" — simplified wins, readings kept for later use.
    expect(classifiers(entryFor('海', 'hai3').defs)).toEqual([
      { form: '个', reading: 'ge4' },
      { form: '片', reading: 'pian4' },
    ]);
  });

  it('handles several classifiers and words with none', () => {
    expect(classifiers(entryFor('人', 'ren2').defs).map((c) => c.form)).toEqual(['个', '位', '名']);
    expect(classifiers(entryFor('书', 'shu1').defs).map((c) => c.form)).toEqual(['本', '册', '部']);
    expect(classifiers(['to love'])).toEqual([]);
    expect(humanDefs(['to love'])).toEqual(['to love']);
    expect(classifiers()).toEqual([]);
  });

  it('leaves no CL: text anywhere a row would render', () => {
    // A broad sweep: every entry that has a classifier must summarize without it.
    let checked = 0;
    for (const [simp, trad, pinyinNum, defs] of dict) {
      if (!defs.some((d) => d.startsWith('CL:'))) continue;
      expect(summarize(defs), simp).not.toContain('CL:');
      if (++checked >= 500) break;
    }
    expect(checked).toBeGreaterThan(100);
  });
});
