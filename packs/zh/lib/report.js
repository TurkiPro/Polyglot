/**
 * report.txt — what the build did, and what a human should look at.
 *
 * Split out of build.mjs to keep it under the file cap (§4.6).
 */
import { writeFile } from 'node:fs/promises';
import { config } from '../../../config/app.config.js';

const { identity, pack } = config;
const LANG = pack.langPackV1;

export function homographReport(homographs, words, declined = {}) {
  const lines = [`homograph-marked HSK entries (${homographs.length}):`];

  // Readings the final deck actually teaches, so a split already curated in
  // overrides.json is not still reported as an unused candidate.
  const taught = new Map();
  for (const w of words) {
    if (!taught.has(w.simp)) taught.set(w.simp, new Set());
    taught.get(w.simp).add(w.pinyinNum.toLowerCase());
  }

  const bySpelling = new Map();
  for (const h of homographs) {
    if (!bySpelling.has(h.simp)) bySpelling.set(h.simp, []);
    bySpelling.get(h.simp).push(h);
  }

  for (const [simp, entries] of bySpelling) {
    const covered = taught.get(simp) ?? new Set();
    const reason = declined[simp];
    lines.push(
      `  ${simp} — ${entries[0].readingCount} distinct reading(s) in CC-CEDICT, ${covered.size} taught` +
        (reason ? '  DECLINED' : ''),
    );
    if (reason) lines.push(`    reason: ${reason}`);

    for (const h of entries) {
      const unused = h.alternatives.filter((a) => !covered.has(a.pinyinNum.toLowerCase()));
      const isCandidate = !reason && h.marker > 1 && unused.length > 0;
      lines.push(
        `    ${h.raw} (band ${h.band}) → ${h.resolvedPinyin} [${h.resolvedPinyinNum}]` +
          (isCandidate ? '  CANDIDATE' : ''),
      );
      if (isCandidate) {
        for (const a of unused.slice(0, 3)) {
          lines.push(`        untaught reading: ${a.pinyin} [${a.pinyinNum}] — ${a.gloss}`);
        }
      }
    }
  }
  lines.push('');
  return lines;
}

/**
 * Topic collections, and the band-1 words nothing claimed.
 *
 * That list is the review surface: a grammar word belongs there, a noun almost certainly
 * does not, and reading it is how a wrong mapping gets caught.
 */
function topicReport(topics) {
  if (!topics) return [];

  const lines = [
    `topic collections (Design v3 §5.1): ${topics.mapped} of ${topics.scope} words in bands 1-4`,
  ];
  for (const [topic, count] of Object.entries(topics.counts)) {
    lines.push(`  ${(topics.labels[topic] ?? topic).padEnd(20)} ${count}`);
  }

  lines.push(
    '',
    `band-1 words in no topic (${topics.unmappedBand1.length}) — expect grammar words here:`,
    ...topics.unmappedBand1.map((word) => `  - ${word}`),
    '',
  );
  return lines;
}

export async function writeReport(stats, warnings = []) {
  const lines = [
    `${identity.projectName} — ${LANG} pack build report`,
    `generated: ${stats.generatedAt}`,
    `packVersion: ${stats.version}`,
    '',
    `CEDICT entries parsed:      ${stats.cedictEntries}`,
    `CEDICT lines skipped:       ${stats.cedictSkipped}`,
    `HSK words listed:           ${stats.hskWords}`,
    `HSK duplicates across lists:${String(stats.hskDuplicates).padStart(7)}`,
    `deck words:                 ${stats.deckWords}`,
    `HSK words missing in CEDICT:${String(stats.missing.length).padStart(7)}`,
    `id collisions (~2, ~3, …):  ${stats.collisions}`,
    `overrides added / patched:  ${stats.overrides.added} / ${stats.overrides.patched}`,
    `words with altReadings:     ${stats.withAlts}`,
    `split groups / members:     ${stats.splits.groups} / ${stats.splits.members}`,
    '',
    'introduction order (Phase 7 §2) — every word debuts in a sentence you can read:',
    `  seeded (bootstrap):       ${stats.intro.seeded}`,
    `  clean n+1:                ${stats.intro.clean}`,
    `  relaxed (1 extra unknown):${String(stats.intro.relaxed).padStart(7)}`,
    `  no sentence:              ${stats.intro.none}`,
    `  bands 1-3: ${stats.introMetrics.cleanPct}% clean, ${stats.introMetrics.relaxedPct}% relaxed, ` +
      `${stats.introMetrics.nonePct}% bare (of ${stats.introMetrics.total} words)`,
    `  component breakdowns:     ${stats.components.withComponents} words / ` +
      `${stats.components.charsCovered} characters`,
    `  card ids preserved:       ${stats.idCheck.checked}${stats.idCheck.added ? ` (+${stats.idCheck.added} new)` : ''}`,
    '',
    'words per band:',
    ...stats.perBand.map(([band, count]) => `  band ${band}: ${count}`),
    '',
    `words with sentences:       ${stats.withSentences}`,
    `sentences attached:         ${stats.sentences}`,
    `unique characters:          ${stats.chars}`,
    `stroke files copied:        ${stats.strokesCopied}`,
    `serif subset characters:    ${stats.fonts.characters}`,
    ...stats.fonts.files.map((f) => `  ${f.file}: ${(f.bytes / 1024).toFixed(0)} KB`),
    `words without a WRITE card: ${stats.noWrite}`,
    '',
    `warnings (${warnings.length}):`,
    ...warnings.map((w) => `  - ${w}`),
    '',
    `HSK words missing from CEDICT (${stats.missing.length}):`,
    ...stats.missing.map((w) => `  - ${w}`),
    '',
    ...topicReport(stats.topics),
    ...homographReport(stats.homographs, stats.words, stats.declinedSplits),
  ];
  await writeFile(new URL('../data/report.txt', import.meta.url), lines.join('\n'));
}
