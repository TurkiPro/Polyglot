/**
 * Turning HSK list entries into deck words: resolution, alternate readings, overrides.
 *
 * Kept out of build.mjs so the build script stays orchestration and this stays testable.
 */
import { pickPrimary } from './cedict.js';
import { IdAssigner } from './ids.js';
import { numToMarks } from './pinyin.js';

/** Distinct readings for a spelling, most-defined first, deduped by pinyin. */
export function distinctReadings(entries = []) {
  const byPinyin = new Map();
  for (const entry of [...entries].sort((a, b) => b.defs.length - a.defs.length)) {
    const key = entry.pinyinNum.toLowerCase();
    if (!byPinyin.has(key)) byPinyin.set(key, entry);
  }
  return [...byPinyin.values()];
}

/** Build a deck word from a CC-CEDICT entry. */
function wordFrom(id, simp, entry, band) {
  const word = {
    id,
    simp,
    pinyin: numToMarks(entry.pinyinNum),
    pinyinNum: entry.pinyinNum,
    defs: entry.defs,
    band,
    sentences: [],
  };
  if (entry.trad && entry.trad !== simp) word.trad = entry.trad;
  return word;
}

/**
 * Resolve HSK entries against CC-CEDICT.
 *
 * Entries arrive in ascending band order, so the first spelling that resolves wins and a
 * word repeated in a later band keeps its lowest band. A homograph marker never mints a
 * second word by itself: for most marked spellings both senses share one pronunciation,
 * so guessing a second reading would put wrong pinyin on a card. Marked entries are
 * recorded for the report instead, and real splits are curated in overrides.json.
 */
export function resolveWords(hskEntries, bySimp, lang) {
  const ids = new IdAssigner(lang);
  const words = [];
  const byId = new Map();
  const missing = [];
  const homographs = [];
  const seen = new Map();
  let duplicates = 0;

  for (const { raw, variants, band, marker } of hskEntries) {
    let simp;
    let entry;
    for (const candidate of variants) {
      const found = pickPrimary(bySimp.get(candidate));
      if (found) {
        simp = candidate;
        entry = found;
        break;
      }
    }

    if (!entry) {
      missing.push(raw);
      continue;
    }

    const existing = seen.get(simp);
    if (marker !== null) {
      const readings = distinctReadings(bySimp.get(simp));
      homographs.push({
        raw,
        simp,
        band,
        marker,
        resolvedPinyinNum: existing ? existing.pinyinNum : entry.pinyinNum,
        resolvedPinyin: numToMarks(existing ? existing.pinyinNum : entry.pinyinNum),
        readingCount: readings.length,
        alternatives: readings
          .filter((r) => r.pinyinNum.toLowerCase() !== (existing ?? entry).pinyinNum.toLowerCase())
          .map((r) => ({ pinyinNum: r.pinyinNum, pinyin: numToMarks(r.pinyinNum), gloss: r.defs[0] })),
      });
    }

    if (existing) {
      duplicates++;
      continue;
    }

    const word = wordFrom(ids.assign(simp, entry.pinyinNum), simp, entry, band);
    seen.set(simp, word);
    byId.set(word.id, word);
    words.push(word);
  }

  return { words, byId, ids, missing, duplicates, homographs, collisions: ids.collisions };
}

/**
 * Attach the other readings a spelling has, as display-only data for card backs
 * ("also hào — to be fond of"). No cards, no ids, no effect on scheduling.
 *
 * Readings that are themselves deck words are left out — those are taught in their own
 * right and would only repeat on the back of a card the learner already has.
 */
export function attachAltReadings(words, bySimp, limit = 3) {
  const taughtBySimp = new Map();
  for (const w of words) {
    if (!taughtBySimp.has(w.simp)) taughtBySimp.set(w.simp, new Set());
    taughtBySimp.get(w.simp).add(w.pinyinNum.toLowerCase());
  }

  let attached = 0;
  for (const word of words) {
    const taught = taughtBySimp.get(word.simp);
    const alts = distinctReadings(bySimp.get(word.simp))
      .filter((r) => !taught.has(r.pinyinNum.toLowerCase()))
      .slice(0, limit)
      .map((r) => ({
        pinyin: numToMarks(r.pinyinNum),
        pinyinNum: r.pinyinNum,
        gloss: r.defs[0],
      }));

    if (alts.length) {
      word.altReadings = alts;
      attached++;
    }
  }
  return attached;
}

/**
 * Mark the words that share a spelling (§5.4 split groups).
 *
 * Every member gets `splitGroup` — the ids of its siblings — which the REC front uses for
 * its "not <sibling pinyin>" hint. Exactly one member is the primary: the CC-CEDICT
 * primary reading, the one greedy segmentation assumes and the one `speechSynthesis`
 * will actually say. Non-primary members carry `splitPrimary: false`, and the engine
 * gives them no LIS card and no TTS button — wrong audio is worse than none.
 *
 * @returns {{ groups: number, members: number }}
 */
export function markSplitGroups(words, bySimp) {
  const bySpelling = new Map();
  for (const w of words) {
    if (!bySpelling.has(w.simp)) bySpelling.set(w.simp, []);
    bySpelling.get(w.simp).push(w);
  }

  let groups = 0;
  let members = 0;
  for (const [simp, group] of bySpelling) {
    if (group.length < 2) continue;
    groups++;
    members += group.length;

    const primary = pickPrimary(bySimp.get(simp));
    const primaryReading = primary?.pinyinNum.toLowerCase();
    // If CC-CEDICT cannot say, the first member in deck order carries the reading.
    let chosen = group.find((w) => w.pinyinNum.toLowerCase() === primaryReading) ?? group[0];

    for (const word of group) {
      word.splitGroup = group.filter((w) => w.id !== word.id).map((w) => w.id);
      word.splitPrimary = word === chosen;
    }
  }

  return { groups, members };
}

/**
 * Merge `overrides.json` over the resolved deck.
 *
 * Applied after HSK resolution so overrides win, but before sentences and stroke data so
 * added words are finished like any other. Three forms:
 *   - `{ id, ...fields }`      patch an existing word
 *   - `{ simp, pinyinNum, band }`  add a word, filling defs/trad from CC-CEDICT
 *   - `{ simp, pinyinNum, band, defs }`  add a word CC-CEDICT does not have
 *   - `{ id, remove: true }`   drop a word
 */
export function applyOverrides(overrides, state, bySimp) {
  const { words, byId, ids } = state;
  const result = { patched: 0, added: 0, removed: 0, warnings: [] };
  const list = overrides?.words ?? [];

  for (const raw of list) {
    // `$`-prefixed keys and `note` are annotations for whoever edits the file by hand.
    const entry = Object.fromEntries(
      Object.entries(raw).filter(([k]) => !k.startsWith('$') && k !== 'note'),
    );
    if (entry.id && entry.remove) {
      const idx = words.findIndex((w) => w.id === entry.id);
      if (idx === -1) {
        result.warnings.push(`override removes unknown id ${entry.id}`);
        continue;
      }
      byId.delete(entry.id);
      words.splice(idx, 1);
      result.removed++;
      continue;
    }

    if (entry.id) {
      const target = byId.get(entry.id);
      if (!target) {
        result.warnings.push(`override patches unknown id ${entry.id}`);
        continue;
      }
      const { id, ...fields } = entry;
      Object.assign(target, fields);
      if (fields.pinyinNum && !fields.pinyin) target.pinyin = numToMarks(fields.pinyinNum);
      result.patched++;
      continue;
    }

    if (!entry.simp || !entry.pinyinNum) {
      result.warnings.push(`override needs either an id, or simp + pinyinNum: ${JSON.stringify(entry)}`);
      continue;
    }

    // Prefer the CC-CEDICT entry with this exact reading, so defs and trad stay upstream.
    const source = (bySimp.get(entry.simp) ?? []).find(
      (e) => e.pinyinNum.toLowerCase() === entry.pinyinNum.toLowerCase(),
    );
    const defs = entry.defs ?? source?.defs;
    if (!defs?.length) {
      result.warnings.push(`override for ${entry.simp} [${entry.pinyinNum}] has no defs and no CC-CEDICT match`);
      continue;
    }

    const word = wordFrom(
      ids.assign(entry.simp, entry.pinyinNum),
      entry.simp,
      { pinyinNum: entry.pinyinNum, defs, trad: entry.trad ?? source?.trad },
      entry.band ?? 0,
    );
    words.push(word);
    byId.set(word.id, word);
    result.added++;
  }

  return result;
}
