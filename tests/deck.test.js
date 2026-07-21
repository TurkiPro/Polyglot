import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { config } from '../config/app.config.js';
import { numToMarks } from '../packs/zh/lib/pinyin.js';

/**
 * Integrity checks on the committed pack (§7 acceptance). The pack is a build artifact
 * in git, so these run everywhere without needing `npm run deck` or any network.
 */
const LANG = config.pack.langPackV1;
const packDir = new URL(`../app/assets/packs/${LANG}/`, import.meta.url);
const deckPath = new URL(`deck.${LANG}.json`, packDir);

const deck = JSON.parse(readFileSync(deckPath, 'utf8'));

describe('deck pack', () => {
  it('declares the schema and language from config', () => {
    expect(deck.schemaVersion).toBe(config.pack.deckSchemaVersion);
    expect(deck.language).toBe(LANG);
    expect(deck.packVersion).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
    expect(Date.parse(deck.generatedAt)).not.toBeNaN();
  });

  it('has no duplicate word ids', () => {
    const seen = new Set();
    const dupes = [];
    for (const w of deck.words) {
      if (seen.has(w.id)) dupes.push(w.id);
      seen.add(w.id);
    }
    expect(dupes).toEqual([]);
    expect(seen.size).toBe(deck.words.length);
  });

  it('gives every band words, with band 1 in the 300-600 range', () => {
    const perBand = new Map();
    for (const w of deck.words) perBand.set(w.band, (perBand.get(w.band) ?? 0) + 1);
    for (const band of [1, 2, 3, 4, 5, 6, 7]) {
      expect(perBand.get(band), `band ${band}`).toBeGreaterThan(0);
    }
    expect(perBand.get(1)).toBeGreaterThanOrEqual(300);
    expect(perBand.get(1)).toBeLessThanOrEqual(600);
  });

  it('shapes every word per §5.1', () => {
    for (const w of deck.words) {
      // A `~2`-style suffix is legal on collisions, so compare the base id.
      expect(w.id.replace(/~\d+$/, '')).toBe(`${LANG}:${w.simp}:${w.pinyinNum.replace(/\s+/g, '_')}`);
      expect(w.defs.length).toBeGreaterThan(0);
      expect(w.band).toBeGreaterThanOrEqual(1);
      expect(w.band).toBeLessThanOrEqual(9);
      expect(w.trad === undefined || w.trad !== w.simp).toBe(true);
      expect(w.sentences.length).toBeLessThanOrEqual(config.pack.sentencesPerWord);
    }
  });

  it('renders pinyin consistently with the shared converter', () => {
    for (const w of deck.words) expect(w.pinyin).toBe(numToMarks(w.pinyinNum));
  });

  it('keeps sentences within the configured length and marks auto pinyin', () => {
    for (const w of deck.words) {
      for (const s of w.sentences) {
        expect([...s.zh].length).toBeLessThanOrEqual(config.pack.sentenceMaxChars);
        expect(s.zh).toContain(w.simp);
        expect(s.en.length).toBeGreaterThan(0);
        expect(s.pinyinAuto).toBe(true);
        expect(s.src).toMatch(/^tatoeba#\d+$/);
      }
    }
  });

  it('spot-checks tone marks for the §7 words', () => {
    const bySimp = new Map(deck.words.map((w) => [w.simp, w]));
    expect(bySimp.get('好').pinyin).toBe('hǎo');
    expect(bySimp.get('学习').pinyin).toBe('xuéxí');
    expect(bySimp.get('谢谢').pinyin).toBe('xièxie');
    expect(bySimp.get('传统').pinyin).toBe('chuántǒng');
  });
});

describe('pack artifacts', () => {
  it('ships a dictionary of minimal arrays', () => {
    const dict = JSON.parse(readFileSync(new URL(`dict.${LANG}.json`, packDir), 'utf8'));
    expect(dict.length).toBeGreaterThan(100000);
    for (const entry of dict.slice(0, 50)) {
      expect(entry).toHaveLength(4);
      const [simp, trad, pinyinNum, defs] = entry;
      expect(typeof simp).toBe('string');
      expect(typeof trad).toBe('string');
      expect(typeof pinyinNum).toBe('string');
      expect(Array.isArray(defs)).toBe(true);
    }
  });

  it('ships stroke data for the characters the deck uses', () => {
    const chars = new Set();
    for (const w of deck.words) for (const ch of w.simp) if (/\p{Script=Han}/u.test(ch)) chars.add(ch);
    const missing = [...chars].filter((ch) => !existsSync(new URL(`strokes/${ch}.json`, packDir)));
    expect(missing).toEqual([]);
  });

  it('credits every upstream source', () => {
    const credits = JSON.parse(readFileSync(new URL('credits.json', packDir), 'utf8'));
    const names = credits.sources.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(['CC-CEDICT', 'Tatoeba Project', 'HSK 3.0 word lists', 'hanzi-writer', 'hanzi-writer-data']),
    );
    for (const s of credits.sources) {
      expect(s.license).toBeTruthy();
      expect(s.licenseUrl).toMatch(/^https?:\/\//);
    }

    const md = readFileSync(new URL('../CREDITS.md', import.meta.url), 'utf8');
    for (const name of names) expect(md).toContain(name);
  });
});
