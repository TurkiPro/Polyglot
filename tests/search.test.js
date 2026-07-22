/**
 * Search relevance, against the real shipped dictionary and deck.
 *
 * Fixtures would prove nothing here: the defect was that 124,000 real CC-CEDICT entries
 * contain proper nouns which substring-match ordinary English words.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDeck } from '../app/src/engine/deck.js';
import { isReference, prepareEntries, rankResults } from '../app/src/views/search.js';

const packDir = new URL('../app/assets/packs/zh/', import.meta.url);

const entries = prepareEntries(
  JSON.parse(readFileSync(new URL('dict.zh.json', packDir), 'utf8')).map(
    ([simp, trad, pinyinNum, defs]) => ({ simp, trad, pinyinNum, defs }),
  ),
);
const deck = createDeck(JSON.parse(readFileSync(new URL('deck.zh.json', packDir), 'utf8')));

const search = (query, limit = 50) => rankResults(entries, query, deck, limit);
const simps = (query, limit = 50) => search(query, limit).map((e) => e.simp);

describe('dictionary size sanity', () => {
  it('is searching the real dictionary', () => {
    expect(entries.length).toBeGreaterThan(100000);
    expect(deck.size).toBeGreaterThan(10000);
  });
});

describe('the reported defect: "play"', () => {
  it('puts 玩 in the top 3', () => {
    expect(simps('play').slice(0, 3)).toContain('玩');
  });

  it('keeps proper nouns and cross-references out of the top 10', () => {
    const top = search('play', 10);
    const offenders = top.filter((e) => isReference(e));
    expect(offenders.map((e) => `${e.simp} ${e.defs[0]}`)).toEqual([]);
  });
});

describe('the §9 acceptance queries', () => {
  it('finds 咖啡 by English, by toneless pinyin and by hanzi', () => {
    expect(simps('coffee').slice(0, 3)).toContain('咖啡');
    expect(simps('kafei')[0]).toBe('咖啡');
    expect(simps('咖啡')[0]).toBe('咖啡');
  });

  it('finds 好 from numbered pinyin, and honours the typed tone', () => {
    expect(simps('hao3').slice(0, 3)).toContain('好');
    // A typed tone is deliberate: 好 (hao3) must beat 号 (hao4), which ties without it.
    expect(simps('hao3')[0]).toBe('好');
    expect(simps('hao4')[0]).not.toBe('好');
    // Without a tone, the toneless match still works.
    expect(simps('hao').slice(0, 5)).toContain('好');
  });
});

describe('ranking rules', () => {
  it('prefers an exact gloss over a substring one', () => {
    // "to love" and "love" are the same gloss once the article is stripped.
    expect(simps('love').slice(0, 5)).toContain('爱');
  });

  it('ranks deck words above dictionary-only entries with the same match', () => {
    const results = search('water', 20);
    const shui = results.findIndex((e) => e.simp === '水');
    expect(shui).toBeGreaterThanOrEqual(0);
    expect(shui).toBeLessThan(5);
  });

  it('prefers shorter words when scores are otherwise equal', () => {
    const results = simps('tea', 10);
    expect(results.indexOf('茶')).toBeLessThan(5);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(search('zzzzqqqqxxxx')).toEqual([]);
    expect(search('   ')).toEqual([]);
  });

  it('never returns more than the cap', () => {
    expect(search('a', 50)).toHaveLength(50);
  });

  it('treats a CJK query as hanzi-only, matching simp and trad', () => {
    expect(simps('学习')[0]).toBe('学习');
    // Traditional input finds the simplified headword.
    expect(simps('學習')[0]).toBe('学习');
  });
});

describe('performance', () => {
  it('scores and ranks the whole dictionary within budget', () => {
    // Warm up, so the first run's JIT cost is not what gets measured.
    search('play');

    const runs = ['play', 'coffee', 'water', 'kafei', 'love'];
    const started = performance.now();
    for (const query of runs) search(query);
    const perQuery = (performance.now() - started) / runs.length;

    expect(entries.length).toBeGreaterThan(100000);
    expect(perQuery, `${perQuery.toFixed(1)}ms per query over ${entries.length} entries`).toBeLessThan(50);
  });
});
