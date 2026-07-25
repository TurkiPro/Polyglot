/**
 * The Course pipeline (Phase 9 §1): units carved from the introRank spine.
 *
 * Node suite — buildCourse is a pure data transform, no DOM. The real committed course is
 * validated against a fresh rebuild so unit ids stay stable once shipped (§1).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCourse, unitId } from '../packs/zh/lib/course.js';
import { config } from '../config/app.config.js';

const read = (p) => JSON.parse(readFileSync(resolve(process.cwd(), p), 'utf8'));
const has = (p) => existsSync(resolve(process.cwd(), p));

/** Synthetic words in introRank order, `perBand` of each band 1..bands. */
function makeWords(perBand, bands = 3) {
  const words = [];
  let rank = 1;
  for (let band = 1; band <= bands; band++) {
    for (let i = 0; i < perBand; i++) {
      words.push({ id: `b${band}-${i}`, simp: `${band}:${i}`, introRank: rank++, band });
    }
  }
  return words;
}

describe('buildCourse (§9.1)', () => {
  it('places every word in exactly one unit', () => {
    const words = makeWords(50); // 150 words
    const { units } = buildCourse(words, {}, { unitSize: 22 });
    const placed = units.flatMap((u) => u.wordIds);
    expect(placed).toHaveLength(words.length);
    expect(new Set(placed).size).toBe(words.length); // no duplicates
    expect(new Set(placed)).toEqual(new Set(words.map((w) => w.id)));
  });

  it('keeps unit sizes within UNIT_SIZE ± 3', () => {
    const { units } = buildCourse(makeWords(80), {}, { unitSize: 22 });
    for (const unit of units) {
      expect(unit.wordIds.length).toBeGreaterThanOrEqual(19);
      expect(unit.wordIds.length).toBeLessThanOrEqual(25);
    }
  });

  it('is deterministic — same inputs, identical output', () => {
    const words = makeWords(60);
    const topics = { food: words.slice(0, 20).map((w) => w.id) };
    const a = buildCourse(words, { topics, labels: { food: 'Food' } }, { unitSize: 22 });
    const b = buildCourse(words, { topics, labels: { food: 'Food' } }, { unitSize: 22 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('numbers unit ids sequentially, zero-padded', () => {
    const { units } = buildCourse(makeWords(50), {}, { unitSize: 22 });
    expect(units[0].id).toBe('u001');
    expect(units[1].id).toBe('u002');
    expect(unitId(6)).toBe('u007'); // the §1 example
  });

  it('titles authored bands from their dominant topic, higher bands by number', () => {
    const words = makeWords(30, 5); // bands 1..5
    const topics = { food: words.filter((w) => w.band === 1).map((w) => w.id) };
    const { units } = buildCourse(words, { topics, labels: { food: 'Food & drink' } },
      { unitSize: 22, courseBands: [1, 2, 3] });

    const band1 = units.find((u) => u.band === 1);
    expect(band1.title).toBe('Food & drink');
    const band5 = units.find((u) => u.band === 5);
    expect(band5.title).toMatch(/^Band 5 · Unit \d+$/);
  });

  it('lets overrides replace a title and attach a note', () => {
    const words = makeWords(50);
    const { units } = buildCourse(words, {}, {
      unitSize: 22,
      titles: { u001: 'Getting started' },
      notes: { u002: '了 marks a completed action.' },
    });
    expect(units[0].title).toBe('Getting started');
    expect(units[1].note).toBe('了 marks a completed action.');
    expect(units[0].note).toBeUndefined(); // no note where none is authored
  });
});

/* ── steps[]: the one sequence path and runner share (Phase 10 A1) ── */

describe('deriveSteps via buildCourse (§10 A1)', () => {
  it('emits one WORD per word in order, a CHECKPOINT last, PRACTICE on the cadence', () => {
    const words = makeWords(50); // synthetic, no sentences ⇒ no PHRASE beats
    const { units } = buildCourse(words, {}, { unitSize: 22, lessonWords: 6 });

    for (const unit of units) {
      const kinds = unit.steps.map((s) => s.kind);
      expect(kinds.at(-1)).toBe('CHECKPOINT');
      expect(kinds.filter((k) => k === 'CHECKPOINT')).toHaveLength(1);

      const wordSteps = unit.steps.filter((s) => s.kind === 'WORD');
      expect(wordSteps.map((s) => s.wordId)).toEqual(unit.wordIds); // order untouched

      // A practice set after each full LESSON_WORDS, never as the step just before checkpoint.
      const practice = kinds.filter((k) => k === 'PRACTICE').length;
      expect(practice).toBe(Math.floor((unit.wordIds.length - 1) / 6));
      expect(unit.steps.at(-2).kind).not.toBe('PRACTICE');
    }
  });

  it('adds structure without resequencing — ids and word membership are untouched', () => {
    const words = makeWords(50);
    const withSteps = buildCourse(words, {}, { unitSize: 22 });
    // Word membership matches a run that ignores steps entirely.
    const placed = withSteps.units.flatMap((u) => u.wordIds);
    expect(new Set(placed)).toEqual(new Set(words.map((w) => w.id)));
  });

  it('spotlights a phrase once every one of its words is known', () => {
    // Three words, then a fourth whose sentence is all four — known only at word 4.
    const words = [
      { id: 'w1', simp: '我', introRank: 1, band: 1, sentences: [] },
      { id: 'w2', simp: '爱', introRank: 2, band: 1, sentences: [] },
      { id: 'w3', simp: '你', introRank: 3, band: 1, sentences: [] },
      { id: 'w4', simp: '们', introRank: 4, band: 1,
        sentences: [{ zh: '我爱你们', en: 'I love you all', src: 't#1' }] },
    ];
    const { units } = buildCourse(words, {}, { unitSize: 4, lessonWords: 6 });
    const phrase = units[0].steps.find((s) => s.kind === 'PHRASE');
    expect(phrase).toEqual({ kind: 'PHRASE', wordId: 'w4', src: 't#1' });
    // The phrase step follows its word, never precedes it.
    const wIdx = units[0].steps.findIndex((s) => s.wordId === 'w4' && s.kind === 'WORD');
    const pIdx = units[0].steps.findIndex((s) => s.kind === 'PHRASE');
    expect(pIdx).toBeGreaterThan(wIdx);
  });

  it('reports step totals', () => {
    const { stats } = buildCourse(makeWords(50), {}, { unitSize: 22 });
    expect(stats.steps.WORD).toBe(150);
    expect(stats.steps.CHECKPOINT).toBe(stats.units);
  });
});

/* ── The real committed course ──────────────────────────── */

describe('committed course.zh.json (§9.1)', () => {
  const path = 'app/assets/packs/zh/course.zh.json';

  it.skipIf(!has(path))('covers every deck word in exactly one unit', () => {
    const course = read(path);
    const deck = read('app/assets/packs/zh/deck.zh.json');
    const placed = course.units.flatMap((u) => u.wordIds);
    expect(new Set(placed).size).toBe(placed.length); // no word in two units
    expect(new Set(placed)).toEqual(new Set(deck.words.map((w) => w.id)));
  });

  it.skipIf(!has(path))('keeps every unit within size bounds', () => {
    for (const unit of read(path).units) {
      expect(unit.wordIds.length).toBeGreaterThanOrEqual(19);
      expect(unit.wordIds.length).toBeLessThanOrEqual(25);
    }
  });

  it.skipIf(!has(path))('reproduces the committed unit ids from the deck (id stability)', () => {
    const course = read(path);
    const deck = read('app/assets/packs/zh/deck.zh.json');
    const topics = read('packs/zh/topics.json');
    const overrides = read('packs/zh/course-overrides.json');
    const { units } = buildCourse(deck.words, topics, {
      titles: overrides.titles,
      notes: overrides.notes,
      courseBands: config.course.courseBands,
      unitSize: config.course.unitSize,
    });
    expect(units.map((u) => u.id)).toEqual(course.units.map((u) => u.id));
    expect(units.map((u) => u.wordIds.join(','))).toEqual(course.units.map((u) => u.wordIds.join(',')));
    // steps[] is derived data too — the committed course must match a fresh rebuild exactly.
    expect(units.map((u) => JSON.stringify(u.steps))).toEqual(course.units.map((u) => JSON.stringify(u.steps)));
  });

  it.skipIf(!has(path))('gives every committed unit a WORD-per-word run ending in one CHECKPOINT', () => {
    for (const unit of read(path).units) {
      expect(Array.isArray(unit.steps)).toBe(true);
      expect(unit.steps.at(-1).kind).toBe('CHECKPOINT');
      expect(unit.steps.filter((s) => s.kind === 'CHECKPOINT')).toHaveLength(1);
      expect(unit.steps.filter((s) => s.kind === 'WORD').map((s) => s.wordId)).toEqual(unit.wordIds);
      // Every PHRASE names a word in this unit and carries a sentence source.
      for (const step of unit.steps.filter((s) => s.kind === 'PHRASE')) {
        expect(unit.wordIds).toContain(step.wordId);
        expect(typeof step.src).toBe('string');
      }
    }
  });
});
