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
import { measureIntro, introRankOrder } from '../packs/zh/lib/introcost.js';
import { SOUNDS_UNIT } from '../packs/zh/lib/sounds-unit.js';
import { config } from '../config/app.config.js';

const LANG = config.pack.langPackV1;
const PACKS = new URL('../app/assets/packs/zh/', import.meta.url);
const SRC = new URL('../packs/zh/', import.meta.url);

const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));

const deck = await readJson(new URL(`deck.${LANG}.json`, PACKS));
const topics = await readJson(new URL('topics.json', SRC));
const overrides = await readJson(new URL('course-overrides.json', SRC));
const deckOverrides = await readJson(new URL('overrides.json', SRC));
const existing = await readJson(new URL(`course.${LANG}.json`, PACKS));

const { units, stats } = buildCourse(deck.words, topics, {
  titles: overrides.titles,
  notes: overrides.notes,
  courseBands: config.course.courseBands,
  unitSize: config.course.unitSize,
  lessonWords: config.course.lessonWords,
  cohesion: config.course.topicCohesion,
  minUnitSize: config.course.minUnitSize,
  seedOrder: deckOverrides.seedOrder ?? [],
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

// §3: the price of coherence — intro quality under the new order vs the deck's n+1 order.
const before = measureIntro(introRankOrder(deck.words), deck.words, { seedOrder: deckOverrides.seedOrder });
const after = measureIntro(stats.order, deck.words, { seedOrder: deckOverrides.seedOrder });
const row = (label, b, a, floor) => `  ${label.padEnd(18)} ${String(b).padStart(6)}   ${String(a).padStart(6)}${floor ? `   (floor ${floor})` : ''}`;
console.log('\nintro quality (bands 1-3) — before (n+1) vs after (theme-first):');
console.log('  metric                before    after');
console.log(row('band-1 clean %', before.band1CleanPct, after.band1CleanPct, 80));
console.log(row('bands 1-3 clean %', before.cleanPct, after.cleanPct, 75));
console.log(row('bands 1-3 relaxed %', before.relaxedPct, after.relaxedPct));
console.log(row('bands 1-3 bare %', before.nonePct, after.nonePct));
if (after.band1CleanPct < 80 || after.cleanPct < 75) {
  console.error(`\nFLOOR BREACH — raise TOPIC_COHESION (currently ${config.course.topicCohesion}) and rebuild.`);
  process.exit(1);
}
console.log('  floors hold.');
