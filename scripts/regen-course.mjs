#!/usr/bin/env node
/**
 * Regenerate ONLY the committed course artifact from the committed deck (Phase 10 A1).
 *
 * `steps[]` is derived data, and adding it must not disturb deck bytes or card ids (the
 * standing law). Rather than rerun the whole pipeline — which would re-download sources and
 * rewrite the deck — this reads the already-committed `deck.zh.json`, `topics.json`, and
 * `course-overrides.json`, rebuilds the course deterministically with `buildCourse`, and
 * rewrites `course.zh.json` alone. The unit ids and word membership are unchanged by
 * construction (the id-stability test proves it); only `steps[]` is added.
 *
 *   node scripts/regen-course.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { buildCourse } from '../packs/zh/lib/course.js';
import { SOUNDS_UNIT } from '../packs/zh/lib/sounds-unit.js';
import { config } from '../config/app.config.js';

const LANG = config.pack.langPackV1;
const PACKS = new URL('../app/assets/packs/zh/', import.meta.url);
const SRC = new URL('../packs/zh/', import.meta.url);

const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));

const deck = await readJson(new URL(`deck.${LANG}.json`, PACKS));
const topics = await readJson(new URL('topics.json', SRC));
const overrides = await readJson(new URL('course-overrides.json', SRC));
const existing = await readJson(new URL(`course.${LANG}.json`, PACKS));

const { units, stats } = buildCourse(deck.words, topics, {
  titles: overrides.titles,
  notes: overrides.notes,
  courseBands: config.course.courseBands,
  unitSize: config.course.unitSize,
  lessonWords: config.course.lessonWords,
  soundsUnit: SOUNDS_UNIT,
});

// The course tracks the deck it was built from; keep its existing metadata untouched.
const course = {
  schemaVersion: existing.schemaVersion,
  language: existing.language,
  packVersion: existing.packVersion,
  generatedAt: existing.generatedAt,
  units,
};

await writeFile(new URL(`course.${LANG}.json`, PACKS), JSON.stringify(course));
console.log(
  `course.${LANG}.json — ${stats.units} units, steps: ` +
    `${stats.steps.WORD} word / ${stats.steps.PHRASE} phrase / ` +
    `${stats.steps.PRACTICE} practice / ${stats.steps.CHECKPOINT} checkpoint`,
);
