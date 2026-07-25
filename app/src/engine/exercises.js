/**
 * Exercises (Phase 9 §2): six pure item generators and their graders.
 *
 * Every generator is `(candidates, ctx) → item | null` and every grade is
 * `(item, response) → { correct, ... }` — no DOM, no storage, no audio, so the whole engine
 * runs headless under vitest. Randomness comes only from the injected seeded RNG, so a given
 * quiz attempt reproduces exactly (§2).
 *
 * Distractors are drawn by *similarity* — same band, a shared component, close pinyin, or the
 * same tone pattern — because confusable options are where the interleaving evidence says the
 * learning happens (§2). This is language-agnostic mechanics over the pack's data shape; the
 * only zh-specific thing borrowed is the PROD pinyin normaliser, reused verbatim (§8).
 */
import { config } from '../../../config/app.config.js';
import { gradeProduction } from './srs.js';

export const EXERCISE_TYPES = Object.freeze([
  'MATCH',
  'MCQ_MEANING',
  'MCQ_AUDIO',
  'TYPE_PINYIN',
  'REORDER',
  'CLOZE',
]);

/** mulberry32 — a tiny, fast, seedable PRNG. Deterministic per seed. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 32-bit seed from a string, so `unitId + attempt` reproduces a quiz. */
export function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < String(text).length; i++) {
    h ^= String(text).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic Fisher–Yates using the injected rng; returns a new array. */
export function shuffle(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ── Similarity, for distractors ────────────────────────── */

const toneSig = (word) => (String(word.pinyinNum ?? '').match(/[1-5]/g) ?? []).join('');
const noTone = (word) => String(word.pinyinNum ?? '').replace(/[1-5\s]/g, '');

/** Component part characters of a word, for the "shared component" signal. */
function componentChars(word) {
  const chars = new Set();
  for (const component of word.components ?? []) {
    if (component.char) chars.add(component.char);
    for (const part of component.parts ?? []) if (part.char) chars.add(part.char);
  }
  return chars;
}

const levenshtein = (a, b) => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
};

/** How confusable `b` is as a distractor for `a` — higher is more confusable. */
export function similarity(a, b) {
  let score = 0;
  if (a.band === b.band) score += 1;
  const ta = toneSig(a);
  if (ta && ta === toneSig(b)) score += 3;
  const ca = componentChars(a);
  for (const char of componentChars(b)) if (ca.has(char)) { score += 2; break; }
  const pa = noTone(a);
  const pb = noTone(b);
  if (pa && pb) score += 2 * (1 - levenshtein(pa, pb) / Math.max(pa.length, pb.length));
  return score;
}

/**
 * `count` distractor words for `target`, ranked by similarity then sampled for variety.
 * Deterministic: the ranking is a pure sort (ties broken by id) and the sample uses `rng`.
 */
export function pickDistractors(target, ctx, count, rng, exclude = new Set()) {
  let pool = ctx.byBand.get(target.band) ?? [];
  if (pool.length < count * 4) pool = ctx.words; // widen when a band is too thin
  const scored = pool
    .filter((w) => w.id !== target.id && !exclude.has(w.id) && (w.defs?.length ?? 0) > 0)
    .map((w) => ({ w, s: similarity(target, w) }))
    .sort((x, y) => y.s - x.s || (x.w.id < y.w.id ? -1 : 1));
  const topK = scored.slice(0, Math.max(count * 4, count)).map((x) => x.w);
  return shuffle(topK, rng).slice(0, count);
}

/* ── Sentence segmentation, for REORDER and CLOZE ────────── */

/** Split a sentence into deck-word tiles by greedy longest match; unknown runs pass through. */
export function segment(text, ctx) {
  const tiles = [];
  const chars = [...text];
  let i = 0;
  while (i < chars.length) {
    if (/[\s，。！？、；：""''（）,.!?]/.test(chars[i])) { i += 1; continue; }
    let matched = null;
    for (let len = Math.min(ctx.maxLen, chars.length - i); len >= 1; len--) {
      const candidate = chars.slice(i, i + len).join('');
      if (ctx.bySimp.has(candidate)) { matched = candidate; break; }
    }
    if (matched) {
      tiles.push({ simp: matched, known: ctx.bySimp.has(matched) });
      i += [...matched].length;
    } else {
      tiles.push({ simp: chars[i], known: false });
      i += 1;
    }
  }
  return tiles;
}

/* ── Generators ─────────────────────────────────────────── */

const firstDef = (word) => word.defs?.[0] ?? word.simp;

/** MATCH — five hanzi to connect to their meaning or pinyin; the axis is chosen by rng. */
function genMatch(candidates, ctx, rng) {
  const picks = candidates.slice(0, 5);
  if (picks.length < 3) return null; // too few to make a matching worthwhile
  const axis = ['meaning', 'pinyin'][Math.floor(rng() * 2)];
  const left = picks.map((word) => ({ id: word.id, simp: word.simp }));
  const right = picks.map((word) => ({ id: word.id, text: axis === 'meaning' ? firstDef(word) : word.pinyin }));
  return { type: 'MATCH', axis, left, right: shuffle(right, rng), answer: picks.map((w) => w.id) };
}

/** A four-way MCQ: the target plus three similar distractors, options shuffled. */
function mcq(type, target, ctx, rng, choices) {
  const distractors = pickDistractors(target, ctx, choices - 1, rng);
  if (distractors.length < choices - 1) return null;
  const options = shuffle([target, ...distractors], rng).map((word) => ({
    id: word.id,
    simp: word.simp,
    text: firstDef(word),
  }));
  return { type, wordId: target.id, prompt: target.simp, options, answer: target.id };
}

/** REORDER / CLOZE need a sentence every one of whose words the learner has met. */
function eligibleSentence(word, ctx, known) {
  for (const sentence of word.sentences ?? []) {
    const tiles = segment(sentence.zh, ctx).filter((t) => ctx.bySimp.has(t.simp));
    if (tiles.length >= 3 && tiles.length <= 8 &&
        tiles.every((t) => known.has(t.simp)) &&
        tiles.some((t) => t.simp === word.simp)) {
      return { sentence, tiles };
    }
  }
  return null;
}

function genReorder(candidates, ctx, rng, known) {
  for (const word of candidates) {
    const hit = eligibleSentence(word, ctx, known);
    if (!hit) continue;
    const order = hit.tiles.map((t, i) => ({ i, simp: t.simp }));
    return {
      type: 'REORDER',
      wordId: word.id,
      en: hit.sentence.en,
      tiles: shuffle(order, rng),
      answer: order.map((t) => t.i),
    };
  }
  return null;
}

function genCloze(candidates, ctx, rng, known) {
  for (const word of candidates) {
    const hit = eligibleSentence(word, ctx, known);
    if (!hit) continue;
    const blankAt = hit.tiles.findIndex((t) => t.simp === word.simp);
    const distractors = pickDistractors(word, ctx, 3, rng);
    if (distractors.length < 3) continue;
    const options = shuffle([word, ...distractors], rng).map((w) => ({ id: w.id, simp: w.simp }));
    return {
      type: 'CLOZE',
      wordId: word.id,
      blankAt,
      tiles: hit.tiles.map((t) => t.simp),
      en: hit.sentence.en,
      options,
      answer: word.id,
      pinyinNum: word.pinyinNum,
    };
  }
  return null;
}

/**
 * Build one item of `type` from `candidates` (met words, in the caller's order), or null if
 * this type cannot be built from them right now (the caller then tries another).
 */
export function generate(type, { candidates, ctx, rng, known = new Set(), choices = config.course.mcqChoices }) {
  const ordered = shuffle(candidates, rng);
  switch (type) {
    case 'MATCH':
      return genMatch(ordered, ctx, rng);
    case 'MCQ_MEANING':
      return mcq('MCQ_MEANING', ordered[0], ctx, rng, choices);
    case 'MCQ_AUDIO':
      return mcq('MCQ_AUDIO', ordered[0], ctx, rng, choices);
    case 'TYPE_PINYIN':
      return ordered[0]
        ? { type, wordId: ordered[0].id, prompt: ordered[0].simp, meaning: firstDef(ordered[0]), answer: ordered[0].pinyinNum }
        : null;
    case 'REORDER':
      return genReorder(ordered, ctx, rng, known);
    case 'CLOZE':
      return genCloze(ordered, ctx, rng, known);
    default:
      return null;
  }
}

/* ── Grading ────────────────────────────────────────────── */

/** Grade a response against an item. Pure; never touches FSRS (§2 firewall). */
export function grade(item, response) {
  switch (item.type) {
    case 'MATCH': {
      const pairing = response ?? {};
      const correct = item.answer.every((id) => pairing[id] === id);
      return { correct, correctAnswer: item.answer };
    }
    case 'MCQ_MEANING':
    case 'MCQ_AUDIO':
    case 'CLOZE':
      return { correct: response === item.answer, correctAnswer: item.answer };
    case 'TYPE_PINYIN':
      return { correct: gradeProduction(response ?? '', item.answer).correct, correctAnswer: item.answer };
    case 'REORDER': {
      const same = Array.isArray(response) &&
        response.length === item.answer.length &&
        response.every((v, i) => v === item.answer[i]);
      return { correct: same, correctAnswer: item.answer };
    }
    default:
      return { correct: false };
  }
}

/**
 * Index a word list for the generators: lookup by id, by band, by spelling, and the longest
 * headword length for the segmenter. Built once by the caller, reused across items.
 */
export function prepareExercises(words) {
  const byId = new Map();
  const byBand = new Map();
  const bySimp = new Map();
  let maxLen = 1;
  for (const word of words) {
    byId.set(word.id, word);
    if (!byBand.has(word.band)) byBand.set(word.band, []);
    byBand.get(word.band).push(word);
    if (!bySimp.has(word.simp)) bySimp.set(word.simp, word);
    maxLen = Math.max(maxLen, [...word.simp].length);
  }
  return { words, byId, byBand, bySimp, maxLen };
}
