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
import { DATA_DIR, download, readSource, readSourceText } from './lib/download.js';
import { collectCharacters, subsetWeights } from './lib/fonts.js';
import { attachComponents, parseDecomposition } from './lib/decomp.js';
import { parseHsk } from './lib/hsk.js';
import { earlyBandMetrics, orderByIntroduction } from './lib/intro.js';
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
const FONT_DIR = new URL('../../app/assets/fonts/', import.meta.url);
const UI_STRINGS = new URL('../../app/src/ui/strings.js', import.meta.url);
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
  log('\n[1/9] sources');
  await download(sources.cedictUrl, 'cedict.txt.gz', { log });
  await download(sources.notoSerifScUrl, 'NotoSerifSC-VF.ttf', { log });
  await download(sources.tatoebaLinks, 'cmn-eng_links.tsv.bz2', { log });
  await download(sources.tatoebaSentencesCmn, 'cmn_sentences.tsv.bz2', { log });
  await download(sources.tatoebaSentencesEng, 'eng_sentences.tsv.bz2', { log });
  await download(sources.decompUrl, 'decomposition.txt', { log });
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

/**
 * Topic collections (Design v3 §5.1) — committed, reviewable data like overrides.json.
 * Validated here so a stale id can never reach the app.
 */
async function checkTopics(words) {
  let file;
  try {
    file = JSON.parse(await readFile(new URL('topics.json', import.meta.url), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`topics.json is not valid JSON: ${err.message}`);
  }

  const byId = new Map(words.map((word) => [word.id, word]));
  const counts = {};
  const unknown = [];

  for (const [topic, ids] of Object.entries(file.topics ?? {})) {
    counts[topic] = ids.length;
    for (const id of ids) if (!byId.has(id)) unknown.push(`${topic}:${id}`);
  }

  if (unknown.length) {
    throw new Error(
      `topics.json names ${unknown.length} id(s) the deck does not have: ` +
        `${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? '…' : ''}`,
    );
  }

  const mapped = new Set(Object.values(file.topics ?? {}).flat());
  const inScope = words.filter((word) => word.band >= 1 && word.band <= 4);
  const unmappedBand1 = words
    .filter((word) => word.band === 1 && !mapped.has(word.id))
    .map((word) => `${word.simp} (${word.defs[0]})`);

  return {
    counts,
    labels: file.labels ?? {},
    scope: inScope.length,
    mapped: inScope.filter((word) => mapped.has(word.id)).length,
    unmappedBand1,
  };
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
  log('\n[4/9] sentences');

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

/**
 * Subset the serif face to the characters this pack uses (§3.2.3).
 * The full variable font is ~25 MB; each subset weight is a fraction of that.
 */
async function buildFonts(words) {
  log('\n[6/8] fonts');
  // Hanzi baked into the UI (the 学 watermark, the 语 mark) must be in the subset too.
  const uiText = await readFile(UI_STRINGS, 'utf8');
  const characters = collectCharacters(words, uiText);

  const source = await readFile(new URL('NotoSerifSC-VF.ttf', DATA_DIR));
  const written = await subsetWeights(source, characters, FONT_DIR);

  const count = [...characters].length;
  for (const { weight, file, bytes } of written) {
    log(`  ${file} — ${(bytes / 1024).toFixed(0)} KB (weight ${weight})`);
  }
  log(`  ${count} characters subset from ${(source.length / 1048576).toFixed(1)} MB source`);
  return { characters: count, files: written };
}

/** Copy stroke data for exactly the characters the deck uses. */
async function copyStrokes(words) {
  log('\n[5/8] strokes');
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

/**
 * Card ids are permanent (§5.1). A reordering pass must never mint or lose one, so the
 * build refuses to write a deck whose ids differ from the one already committed.
 */
async function assertIdsUnchanged(words) {
  let previous;
  try {
    previous = JSON.parse(await readFile(new URL(`deck.${LANG}.json`, OUT_DIR), 'utf8'));
  } catch {
    log('  no previous deck to compare ids against (first build)');
    return { checked: 0 };
  }

  const before = new Set(previous.words.map((word) => word.id));
  const after = new Set(words.map((word) => word.id));

  const lost = [...before].filter((id) => !after.has(id));
  const added = [...after].filter((id) => !before.has(id));

  if (lost.length) {
    throw new Error(
      `${lost.length} card id(s) would disappear, which orphans review history: ` +
        `${lost.slice(0, 5).join(', ')}${lost.length > 5 ? '…' : ''}`,
    );
  }

  log(`  ${before.size} ids preserved${added.length ? `, ${added.length} new` : ''}`);
  return { checked: before.size, added: added.length };
}

async function writeArtifacts({ words, cedict, version, generatedAt }) {
  log('\n[7/8] artifacts');
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
  log('\n[8/8] spot checks');
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

  log('\n[2/9] dictionary');
  const cedict = parseCedict(await readSourceText('cedict.txt.gz'));
  log(`  ${cedict.entries.length} entries (${cedict.skipped} lines skipped)`);
  if (cedict.entries.length < 100000) throw new Error('CEDICT parse looks wrong: < 100,000 entries');

  log('\n[3/9] HSK bands');
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
  // Dependency-ordered introduction, and the component breakdowns the teach screen
  // shows (Phase 7 §2, §3). Both need the sentences, so they run after them.
  log('\n[5/9] learn mode');
  const seedOrder = overridesFile.seedOrder ?? [];
  const intro = orderByIntroduction(words, seedOrder);
  const introMetrics = earlyBandMetrics(words);
  log(`  intro order: ${intro.stats.seeded} seeded, ${intro.stats.clean} clean, ` +
      `${intro.stats.relaxed} relaxed, ${intro.stats.none} bare`);
  log(`  bands 1-3: ${introMetrics.cleanPct}% clean, ${introMetrics.relaxedPct}% relaxed, ` +
      `${introMetrics.nonePct}% without a sentence`);

  const decomposition = parseDecomposition(await readSourceText('decomposition.txt'));
  const componentStats = attachComponents(words, decomposition);
  log(`  components on ${componentStats.withComponents} words (${componentStats.charsCovered} characters)`);

  const strokes = await copyStrokes(words);
  const noWrite = markWriteAvailability(words, strokes.missing);
  const fonts = await buildFonts(words);

  const idCheck = await assertIdsUnchanged(words);
  const topics = await checkTopics(words);
  if (topics) {
    log(`  topics: ${topics.mapped}/${topics.scope} words in bands 1-4, ` +
        `${topics.unmappedBand1.length} band-1 words unmapped`);
  }
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
    intro: intro.stats,
    introMetrics,
    components: componentStats,
    idCheck,
    topics,
    declinedSplits: overridesFile.declinedSplits ?? {},
    deckWords: words.length,
    missing,
    collisions,
    perBand,
    withSentences: sentenceStats.withSentences,
    sentences: sentenceStats.total,
    chars: strokes.chars,
    strokesCopied: strokes.copied,
    fonts,
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
