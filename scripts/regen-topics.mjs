#!/usr/bin/env node
/**
 * Regenerate topics.json from the committed deck (Phase 11 §1).
 *
 * Runs the rule-based tagger over the committed deck — no source download, no deck change — and
 * writes the reviewable topics.json plus a human-skim report the maintainer signs off on before
 * §2 builds theme-first units on it.
 *
 *   node scripts/regen-topics.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { tagTopics, LABELS } from '../packs/zh/lib/topics.js';
import { config } from '../config/app.config.js';

const LANG = config.pack.langPackV1;
const PACKS = new URL('../app/assets/packs/zh/', import.meta.url);
const SRC = new URL('../packs/zh/', import.meta.url);

const deck = JSON.parse(await readFile(new URL(`deck.${LANG}.json`, PACKS), 'utf8'));
const byId = new Map(deck.words.map((w) => [w.id, w]));
const old = JSON.parse(await readFile(new URL('topics.json', SRC), 'utf8'));

const { topics, home, core, unmapped, orderedTopics } = tagTopics(deck.words);

const out = {
  $schema: 'Topic → deck word ids (Design v3 §5.1, re-tagged Phase 11 §1). Reviewable data.',
  $notes: [
    'Tagged by rule (packs/zh/lib/topics.js): a closed-class CORE list of function words, an',
    'explicit curated home topic for bands 1-2, head-term keyword rules for the tail, and a',
    'poison-substring trap list. A word has ONE home topic (first array it appears in); later',
    'appearances are secondary, for Browse only. orderedTopics carry an inherent sequence.',
    'Never generated at runtime; regenerate with `node scripts/regen-topics.mjs`.',
  ],
  labels: LABELS,
  orderedTopics,
  core,
  topics,
};
await writeFile(new URL('topics.json', SRC), `${JSON.stringify(out, null, 2)}\n`);

/* ── The review report (§1): bands 1-2 topic lists + changed tags ── */
const simp = (id) => byId.get(id)?.simp ?? id;
const band = (id) => byId.get(id)?.band ?? 9;
const def0 = (id) => (byId.get(id)?.defs?.[0] ?? '').slice(0, 42);
const lines = [];
lines.push('# Phase 11 §1 — topic review (bands 1-2)\n');

for (const [topic, ids] of Object.entries(topics)) {
  const b12 = ids.filter((id) => band(id) <= 2);
  if (!b12.length) continue;
  lines.push(`\n## ${LABELS[topic] ?? topic}  (${b12.length} in bands 1-2)`);
  for (const id of b12) lines.push(`  ${simp(id).padEnd(6)}  ${def0(id)}`);
}

lines.push(`\n## CORE — function/structure words (topic-less): ${core.length} total`);
lines.push(`  ${core.filter((id) => band(id) <= 2).map(simp).join(' ')}`);

const unmappedB12 = unmapped.filter((w) => (w.band ?? 9) <= 2);
lines.push(`\n## Unmapped in bands 1-2 (${unmappedB12.length}) — need a home or CORE`);
for (const w of unmappedB12) lines.push(`  ${w.simp.padEnd(6)}  ${(w.defs?.[0] ?? '').slice(0, 42)}`);

// Changed tags vs the old topics.json (home-topic moves the maintainer should eyeball).
const oldHome = new Map();
for (const [t, ids] of Object.entries(old.topics ?? {})) for (const id of ids) if (!oldHome.has(id)) oldHome.set(id, t);
const moves = [];
for (const [id, topic] of Object.entries(home)) {
  const was = oldHome.get(id);
  if (was && was !== topic && band(id) <= 3) moves.push(`  ${simp(id).padEnd(6)} ${was} → ${topic}`);
}
lines.push(`\n## Changed home tags, bands 1-3 (${moves.length})`);
lines.push(...moves.slice(0, 200));

await writeFile(new URL('data/topic-report.txt', SRC), `${lines.join('\n')}\n`);

const total = Object.values(topics).reduce((n, ids) => n + ids.length, 0);
console.log(`topics.json — ${Object.keys(topics).length} topics, ${total} memberships, ` +
  `${core.length} core, ${unmapped.length} unmapped (${unmappedB12.length} in bands 1-2)`);
console.log('review report: packs/zh/data/topic-report.txt');
