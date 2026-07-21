/**
 * Build the Chinese language pack: `node packs/zh/build.mjs` (npm run deck).
 *
 * Downloads the upstream sources into `packs/zh/data/` (cached across runs), then writes
 * every §5.1–5.3 artifact into `app/assets/packs/zh/`, plus CREDITS.md at the repo root
 * and report.txt beside the data.
 *
 * Outputs are committed, so deploys never depend on third-party downloads. Rebuilding is
 * a manual, local act.
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { config } from '../../config/app.config.js';
import { parseCedict, pickPrimary } from './lib/cedict.js';
import { buildCredits, renderCreditsMarkdown } from './lib/credits.js';
import { download, readSource, readSourceText } from './lib/download.js';
import { parseHsk } from './lib/hsk.js';
import { numToMarks } from './lib/pinyin.js';
import { writeReport } from './lib/report.js';
import { applyOverrides, attachAltReadings, markSplitGroups, resolveWords } from './lib/words.js';
import {
  charLength,
  indexWordSentences,
  parseLinks,
  parseSentences,
  pickSentences,
  sentencePinyin,
} from './lib/tatoeba.js';

const { pack, sources, identity } = config;
const LANG = pack.langPackV1;

const OUT_DIR = new URL(`../../app/assets/packs/${LANG}/`, import.meta.url);
const STROKES_DIR = new URL('strokes/', OUT_DIR);
const STROKE_SRC = new URL('../../node_modules/hanzi-writer-data/', import.meta.url);
const REPO_ROOT = new URL('../../', import.meta.url);

const warnings = [];
const warn = (msg) => warnings.push(msg);
const log = (msg) => console.log(msg);

/** `YYYY.MM.DD` — the pack version is the build date. */
function packVersion(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}.${p(date.getUTCMonth() + 1)}.${p(date.getUTCDate())}`;
}

async function fetchSources() {
  log('\n[1/7] sources');
  await download(sources.cedictUrl, 'cedict.txt.gz', { log });
  await download(sources.tatoebaLinks, 'cmn-eng_links.tsv.bz2', { log });
  await download(sources.tatoebaSentencesCmn, 'cmn_sentences.tsv.bz2', { log });
  await download(sources.tatoebaSentencesEng, 'eng_sentences.tsv.bz2', { log });
  for (const file of sources.hsk30Files) {
    await download(sources.hsk30Base + file, file, { log });
  }
}

async function loadHsk() {
  const files = [];
  for (const filename of sources.hsk30Files) {
    files.push({ filename, text: await readSourceText(filename) });
  }
  return parseHsk(files);
}

/** Hand-written entries merged over the generated deck; absent file means none. */
async function loadOverrides() {
  try {
    return JSON.parse(await readFile(new URL('overrides.json', import.meta.url), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { words: [] };
    throw new Error(`overrides.json is not valid JSON: ${err.message}`);
  }
}

/** Attach up to SENTENCES_PER_WORD examples to each word. */
async function attachSentences(words, bySimp) {
  log('\n[4/7] sentences');

  const maxWordLen = words.reduce((m, w) => Math.max(m, charLength(w.simp)), 1);
  const wordSet = new Set(words.map((w) => w.simp));

  // Keep only Mandarin sentences short enough to be useful as examples.
  const cmnAll = parseSentences(await readSource('cmn_sentences.tsv.bz2'), () => true);
  const cmn = new Map();
  for (const [id, text] of cmnAll) {
    if (charLength(text) <= pack.sentenceMaxChars) cmn.set(id, text);
  }
  cmnAll.clear();
  log(`  ${cmn.size} Mandarin sentences ≤ ${pack.sentenceMaxChars} chars`);

  // A candidate needs at least one English translation.
  const links = parseLinks(await readSource('cmn-eng_links.tsv.bz2'), (id) => cmn.has(id));
  for (const id of [...cmn.keys()]) if (!links.has(id)) cmn.delete(id);
  log(`  ${cmn.size} of those have an English translation`);

  const neededEng = new Set();
  for (const list of links.values()) neededEng.add(list[0]);
  const eng = parseSentences(await readSource('eng_sentences.tsv.bz2'), (id) => neededEng.has(id));
  log(`  ${eng.size} English translations loaded`);

  const index = indexWordSentences(cmn, wordSet, maxWordLen);
  log(`  ${index.size} of ${wordSet.size} words appear in at least one sentence`);

  // Readings for segmentation: the primary CEDICT entry for each headword.
  const readingCache = new Map();
  const readingOf = (candidate) => {
    if (readingCache.has(candidate)) return readingCache.get(candidate);
    const entry = pickPrimary(bySimp.get(candidate));
    const reading = entry?.pinyinNum;
    readingCache.set(candidate, reading);
    return reading;
  };
  const maxHeadword = 8;
  const toMarks = (p) => numToMarks(p, { separator: ' ' });

  /*
   * When a spelling is taught as several words (别 bié / 别 biè), the sentence index
   * cannot tell which reading a given sentence uses — 别动！is bié, but it matches the
   * spelling either way. Only the split-group primary keeps the shared sentences; the
   * other readings get none, and so no SENT card (§5.4), rather than a mismatched one.
   */
  let withSentences = 0;
  let total = 0;
  let skippedAmbiguous = 0;
  for (const word of words) {
    if (word.splitPrimary === false) {
      skippedAmbiguous++;
      continue;
    }
    const picked = pickSentences(index.get(word.simp) ?? [], cmn, pack.sentencesPerWord);
    for (const s of picked) {
      const engId = links.get(s.id)?.[0];
      const en = engId === undefined ? undefined : eng.get(engId);
      if (!en) continue;
      word.sentences.push({
        zh: s.text,
        pinyin: sentencePinyin(s.text, readingOf, toMarks, maxHeadword),
        pinyinAuto: true,
        en,
        src: `tatoeba#${s.id}`,
      });
    }
    if (word.sentences.length > 0) withSentences++;
    total += word.sentences.length;
  }

  log(`  ${total} sentences attached to ${withSentences} words`);
  if (skippedAmbiguous) {
    log(`  ${skippedAmbiguous} secondary readings left without sentences (ambiguous spelling)`);
    warn(`${skippedAmbiguous} secondary readings get no sentences: the spelling is shared with another deck word and the sense cannot be told apart`);
  }
  return { withSentences, total, skippedAmbiguous };
}

/** Copy stroke data for exactly the characters the deck uses. */
async function copyStrokes(words) {
  log('\n[5/7] strokes');
  const chars = new Set();
  for (const word of words) for (const ch of word.simp) if (/\p{Script=Han}/u.test(ch)) chars.add(ch);

  await rm(STROKES_DIR, { recursive: true, force: true });
  await mkdir(STROKES_DIR, { recursive: true });

  let copied = 0;
  const missing = [];
  for (const ch of chars) {
    try {
      await cp(new URL(`${ch}.json`, STROKE_SRC), new URL(`${ch}.json`, STROKES_DIR));
      copied++;
    } catch {
      missing.push(ch);
    }
  }

  if (missing.length) warn(`no stroke data for ${missing.length} characters: ${missing.join('')}`);
  log(`  ${copied} of ${chars.size} characters have stroke data`);
  return { chars: chars.size, copied, missing };
}

/** Words whose every character lacks stroke data cannot have a WRITE card. */
function markWriteAvailability(words, missingChars) {
  if (missingChars.length === 0) return 0;
  const missing = new Set(missingChars);
  let affected = 0;
  for (const word of words) {
    if ([...word.simp].some((ch) => missing.has(ch))) {
      word.noWrite = true;
      affected++;
    }
  }
  return affected;
}

async function writeArtifacts({ words, cedict, version, generatedAt }) {
  log('\n[6/7] artifacts');
  await mkdir(OUT_DIR, { recursive: true });

  const deck = {
    schemaVersion: pack.deckSchemaVersion,
    language: LANG,
    packVersion: version,
    generatedAt,
    words,
  };
  await writeFile(new URL(`deck.${LANG}.json`, OUT_DIR), JSON.stringify(deck));
  log(`  deck.${LANG}.json — ${words.length} words`);

  // Minimal per-entry arrays: [simp, trad, pinyinNum, defs[]] (§5.2).
  const dict = cedict.entries.map((e) => [e.simp, e.trad === e.simp ? '' : e.trad, e.pinyinNum, e.defs]);
  await writeFile(new URL(`dict.${LANG}.json`, OUT_DIR), JSON.stringify(dict));
  log(`  dict.${LANG}.json — ${dict.length} entries`);

  const credits = buildCredits(sources, { packVersion: version, generatedAt });
  await writeFile(new URL('credits.json', OUT_DIR), JSON.stringify(credits, null, 2));
  await writeFile(
    new URL('CREDITS.md', REPO_ROOT),
    renderCreditsMarkdown(credits, identity.projectName),
  );
  log('  credits.json + CREDITS.md');
}

/**
 * Every homograph-marked HSK entry with the reading it resolved to.
 *
 * The marker separates senses, and only sometimes readings, so the pipeline never splits
 * on it automatically — a marker with no distinct reading available would otherwise put
 * invented pinyin on a card. Entries flagged `CANDIDATE` do have an unused reading and
 * are worth a look; promote the real ones by hand in overrides.json.
 */
function spotChecks(words) {
  log('\n[7/7] spot checks');
  const bySimp = new Map(words.map((w) => [w.simp, w]));
  for (const simp of ['好', '学习', '谢谢', '传统']) {
    const w = bySimp.get(simp);
    if (!w) {
      log(`  ${simp} — MISSING from deck`);
      continue;
    }
    log(`  ${w.simp}  ${w.pinyin}  (${w.pinyinNum})  band ${w.band}  ${w.defs[0] ?? ''}`);
    if (w.sentences[0]) log(`      "${w.sentences[0].zh}" → ${w.sentences[0].pinyin}`);
  }
}

async function main() {
  const startedAt = Date.now();
  const now = new Date();
  const generatedAt = now.toISOString();
  const version = packVersion(now);

  log(`building ${identity.projectName} ${LANG} pack ${version}`);
  await fetchSources();

  log('\n[2/7] dictionary');
  const cedict = parseCedict(await readSourceText('cedict.txt.gz'));
  log(`  ${cedict.entries.length} entries (${cedict.skipped} lines skipped)`);
  if (cedict.entries.length < 100000) throw new Error('CEDICT parse looks wrong: < 100,000 entries');

  log('\n[3/7] HSK bands');
  const hsk = await loadHsk();
  log(`  ${hsk.listed} list entries`);

  const resolved = resolveWords(hsk.entries, cedict.bySimp, LANG);
  const { words, missing, duplicates, homographs, collisions } = resolved;
  log(`  ${words.length} deck words (${duplicates} repeats, ${missing.length} absent from CEDICT)`);

  const overridesFile = await loadOverrides();
  const overrides = applyOverrides(overridesFile, resolved, cedict.bySimp);
  log(`  overrides: +${overrides.added} added, ${overrides.patched} patched, ${overrides.removed} removed`);
  for (const w of overrides.warnings) warn(`override: ${w}`);

  const splits = markSplitGroups(words, cedict.bySimp);
  log(`  ${splits.groups} split groups covering ${splits.members} words`);

  const withAlts = attachAltReadings(words, cedict.bySimp);
  log(`  ${withAlts} words carry alternate readings`);
  if (missing.length) warn(`${missing.length} HSK words are not in CC-CEDICT — see the list below`);

  const sentenceStats = await attachSentences(words, cedict.bySimp);
  const strokes = await copyStrokes(words);
  const noWrite = markWriteAvailability(words, strokes.missing);

  await writeArtifacts({ words, cedict, version, generatedAt });

  const bandCounts = new Map();
  for (const w of words) bandCounts.set(w.band, (bandCounts.get(w.band) ?? 0) + 1);
  const perBand = [...bandCounts.entries()].sort((a, b) => a[0] - b[0]);

  await writeReport({
    words,
    generatedAt,
    version,
    cedictEntries: cedict.entries.length,
    cedictSkipped: cedict.skipped,
    hskWords: hsk.listed,
    hskDuplicates: duplicates,
    homographs,
    overrides,
    withAlts,
    splits,
    declinedSplits: overridesFile.declinedSplits ?? {},
    deckWords: words.length,
    missing,
    collisions,
    perBand,
    withSentences: sentenceStats.withSentences,
    sentences: sentenceStats.total,
    chars: strokes.chars,
    strokesCopied: strokes.copied,
    noWrite,
  }, warnings);

  spotChecks(words);

  log(`\nbands: ${perBand.map(([b, c]) => `${b}:${c}`).join('  ')}`);
  log(`warnings: ${warnings.length} (see packs/${LANG}/data/report.txt)`);
  log(`done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error(`\nbuild failed: ${err.message}`);
  process.exitCode = 1;
});
