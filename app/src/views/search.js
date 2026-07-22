/**
 * Dictionary search: score everything, rank, then truncate.
 *
 * The previous match-then-truncate took the first 50 substring hits in store order, so
 * "play" returned footballers whose names contain "player" and buried 玩. Relevance has
 * to be decided across the whole dictionary before anything is cut.
 *
 * Split from browse.js so the ranking is testable against the real shipped dictionary
 * without a DOM (§4.6).
 */

/** Definition-side scores. */
const SCORE_DEF_EXACT = 100;
const SCORE_DEF_WORD = 60;
const SCORE_DEF_SUBSTRING = 15;

/** Pinyin-side scores. */
const SCORE_PINYIN_EXACT = 95;
const SCORE_PINYIN_PREFIX = 70;
const SCORE_PINYIN_SUBSTRING = 40;

/** Hanzi-side scores (CJK queries). */
const SCORE_HAN_EXACT = 100;
const SCORE_HAN_PREFIX = 70;
const SCORE_HAN_SUBSTRING = 40;

/** Modifiers. */
const BONUS_IN_DECK = 40;
const PENALTY_REFERENCE = -35;
const LENGTH_FREE_CHARS = 2;
const LENGTH_PENALTY_PER_CHAR = -2;

const HAN = /[一-鿿]/;

/**
 * CC-CEDICT marks cross-references in the gloss text.
 */
const REFERENCE_RE = /\b(surname|variant of|old variant|abbr\. for)\b/;

/**
 * CC-CEDICT capitalizes the *reading* of a proper noun — `Bei3 jing1`, `Xin1`, `C Luo2`
 * — while ordinary headwords stay lowercase. That is the signal the footballers trip:
 * `C罗` [C Luo2] "Cristiano Ronaldo", `加索尔` [Jia1 suo3 er3] "Gasol".
 *
 * Reading capitalization is used rather than definition capitalization, which the spec
 * suggested: a capitalized *def* also catches CC-CEDICT's classifier annotations
 * (`CL:場|场[chang3]`) and legitimate glosses like "Chinese opera", which would demote
 * 表演 "play" and 戏 "drama; play" — the two best answers for the query that started this.
 */
const PROPER_READING_RE = /^[A-Z]/;

/** Leading articles, so "to play" and "play" score as the same gloss. */
const LEADING_ARTICLE_RE = /^(to|an|a|the)\s+/;

/** A typed tone is deliberate, so an entry that matches it outranks one that does not. */
const BONUS_TONE_MATCH = 10;

/** Tones and spacing carry no signal when someone types "kafei". */
export const plainPinyin = (value) => String(value ?? '').toLowerCase().replace(/[1-5\s]/g, '');

/** Spacing dropped, tones kept: "hao3" vs "hao4". */
export const tonedPinyin = (value) => String(value ?? '').toLowerCase().replace(/\s/g, '');

/** Strip a leading article for exact-gloss comparison. */
export const bareDef = (def) => def.replace(LEADING_ARTICLE_RE, '');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether an entry reads as a proper noun or a cross-reference. */
export function isReference(entry) {
  if (PROPER_READING_RE.test(entry.pinyinNum)) return true;
  return entry.defs.some((def) => REFERENCE_RE.test(def));
}

/**
 * Cache the per-entry values a query would otherwise recompute 124,000 times.
 * Called once when the dictionary is loaded into memory; safe to call again.
 */
export function prepareEntries(entries) {
  for (const entry of entries) {
    if (entry.defsLower !== undefined) continue;
    entry.defsLower = entry.defs.map((def) => def.toLowerCase());
    entry.defsBare = entry.defsLower.map(bareDef);
    entry.pinyinPlain = plainPinyin(entry.pinyinNum);
    entry.pinyinToned = tonedPinyin(entry.pinyinNum);
    entry.pinyinLower = String(entry.pinyinNum).toLowerCase();
    entry.isReference = isReference(entry);
  }
  return entries;
}

/** Everything a query needs, computed once rather than per entry. */
export function compileQuery(raw) {
  const query = String(raw ?? '').trim();
  const lower = query.toLowerCase();
  return {
    query,
    lower,
    bare: bareDef(lower),
    cjk: HAN.test(query),
    pinyin: plainPinyin(query),
    toned: tonedPinyin(lower),
    hasTone: /[1-5]/.test(query),
    wordRe: lower ? new RegExp(`\\b${escapeRegExp(lower)}\\b`) : null,
  };
}

/** Modifiers applied on top of the best match score. */
function modifiers(entry, deckWord) {
  let score = 0;
  if (deckWord) {
    // Deck words are what the learner is actually studying, and a low band is common.
    score += BONUS_IN_DECK + Math.max(0, 10 - (deckWord.band ?? 10));
  }
  if (entry.isReference) score += PENALTY_REFERENCE;
  const extra = Math.max(0, [...entry.simp].length - LENGTH_FREE_CHARS);
  score += extra * LENGTH_PENALTY_PER_CHAR;
  return score;
}

/** Best hanzi score for a CJK query, matching simp and trad only. */
function hanScore(entry, q) {
  let best = 0;
  for (const form of [entry.simp, entry.trad]) {
    if (!form) continue;
    if (form === q.query) best = Math.max(best, SCORE_HAN_EXACT);
    else if (form.startsWith(q.query)) best = Math.max(best, SCORE_HAN_PREFIX);
    else if (form.includes(q.query)) best = Math.max(best, SCORE_HAN_SUBSTRING);
  }
  return best;
}

/** Best latin score: the strongest signal across definitions and pinyin. */
function latinScore(entry, q) {
  let best = 0;

  for (let i = 0; i < entry.defsLower.length; i++) {
    const def = entry.defsLower[i];
    if (def === q.lower || entry.defsBare[i] === q.bare) {
      best = Math.max(best, SCORE_DEF_EXACT);
      continue;
    }
    // Reject with the cheap substring test first: the regex is the expensive part and
    // all but a handful of 124,000 entries never reach it.
    if (!def.includes(q.lower)) continue;
    best = Math.max(best, q.wordRe?.test(def) ? SCORE_DEF_WORD : SCORE_DEF_SUBSTRING);
  }

  if (q.pinyin) {
    // Typing "hao3" should put 好 above 号: both read "hao" once tones are stripped.
    if (q.hasTone && entry.pinyinToned === q.toned) {
      best = Math.max(best, SCORE_PINYIN_EXACT + BONUS_TONE_MATCH);
    } else if (entry.pinyinPlain === q.pinyin) best = Math.max(best, SCORE_PINYIN_EXACT);
    else if (entry.pinyinPlain.startsWith(q.pinyin)) best = Math.max(best, SCORE_PINYIN_PREFIX);
    else if (entry.pinyinPlain.includes(q.pinyin)) best = Math.max(best, SCORE_PINYIN_SUBSTRING);
    // "hao3" typed with its tone number should still land on 好.
    else if (entry.pinyinLower.includes(q.lower)) best = Math.max(best, SCORE_PINYIN_SUBSTRING);
  }

  return best;
}

/**
 * Score one entry. Zero means no match at all.
 * @param {object} entry prepared dictionary entry
 * @param {ReturnType<compileQuery>} q
 * @param {object|undefined} deckWord the deck word for this entry, if any
 */
export function scoreEntry(entry, q, deckWord) {
  const base = baseScore(entry, q);
  if (base <= 0) return 0;
  return base + modifiers(entry, deckWord);
}

/** The match score before modifiers. */
const baseScore = (entry, q) => (q.cjk ? hanScore(entry, q) : latinScore(entry, q));

/**
 * Rank the whole dictionary, then cap.
 *
 * @param {object[]} entries prepared entries
 * @param {string} rawQuery
 * @param {{ lookup?: (simp: string, pinyinNum: string) => object|undefined }} [deck]
 * @param {number} [limit]
 */
export function rankResults(entries, rawQuery, deck, limit = 50) {
  const q = compileQuery(rawQuery);
  if (!q.query) return [];

  const lookup = deck?.lookup;
  const scored = [];

  for (const entry of entries) {
    // Score first, look up second: the deck lookup builds a key string, and doing that
    // for every non-matching entry costs more than the whole rest of the scan.
    const base = baseScore(entry, q);
    if (base <= 0) continue;

    const deckWord = lookup ? lookup(entry.simp, entry.pinyinNum) : undefined;
    const score = base + modifiers(entry, deckWord);
    // A reference-only hit can score below zero; keeping it would rank noise.
    if (score > 0) scored.push({ entry, score, inDeck: Boolean(deckWord) });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.inDeck) - Number(a.inDeck) ||
      [...a.entry.simp].length - [...b.entry.simp].length ||
      (a.entry.simp < b.entry.simp ? -1 : a.entry.simp > b.entry.simp ? 1 : 0),
  );

  return scored.slice(0, limit).map((row) => row.entry);
}
