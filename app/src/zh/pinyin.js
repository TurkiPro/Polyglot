/**
 * Numbered pinyin → tone-marked pinyin, and tone extraction for coloring.
 *
 * This is the single implementation; `packs/zh/lib/pinyin.js` re-exports it so the
 * pipeline and the client can never disagree about how a syllable is rendered.
 *
 * Rules (§7):
 *   - tone 5 (and toneless) get no mark; `u:` and `v` both mean `ü`
 *   - mark placement: an `a` wins; else an `e`; else the `o` of `ou`; else the last vowel
 */

/** Marked forms indexed by tone 1..4; index 0 is the bare vowel. */
const MARKS = {
  a: 'aāáǎà',
  e: 'eēéěè',
  i: 'iīíǐì',
  o: 'oōóǒò',
  u: 'uūúǔù',
  ü: 'üǖǘǚǜ',
};

const VOWELS = 'aeiouü';

/** Strip a trailing tone digit. @returns {{ base: string, tone: number }} */
function splitTone(syllable) {
  const m = /^(.*?)([1-5])$/.exec(syllable);
  if (!m) return { base: syllable, tone: 0 };
  return { base: m[1], tone: Number(m[2]) };
}

/** Normalize the two ASCII spellings of ü. */
function normalizeU(base) {
  return base.replace(/u:/g, 'ü').replace(/U:/g, 'Ü').replace(/v/g, 'ü').replace(/V/g, 'Ü');
}

/** Index of the vowel that carries the tone mark, or -1. */
function markIndex(base) {
  const lower = base.toLowerCase();
  const a = lower.indexOf('a');
  if (a !== -1) return a;
  const e = lower.indexOf('e');
  if (e !== -1) return e;
  const ou = lower.indexOf('ou');
  if (ou !== -1) return ou;
  for (let i = lower.length - 1; i >= 0; i--) {
    if (VOWELS.includes(lower[i])) return i;
  }
  return -1;
}

/**
 * Convert one numbered syllable, e.g. `"hao3"` → `"hǎo"`, `"lu:4"` → `"lǜ"`.
 * Input without a tone digit, or without a vowel, passes through (ü spellings aside).
 */
export function syllableToMarks(syllable) {
  const { base, tone } = splitTone(String(syllable));
  const normalized = normalizeU(base);
  if (tone < 1 || tone > 4) return normalized;

  const i = markIndex(normalized);
  if (i === -1) return normalized;

  const ch = normalized[i];
  const lower = ch.toLowerCase();
  const marked = MARKS[lower]?.[tone];
  if (!marked) return normalized;

  return normalized.slice(0, i) + (ch === lower ? marked : marked.toUpperCase()) + normalized.slice(i + 1);
}

/**
 * Convert a whitespace-separated numbered-pinyin string into tone-marked pinyin.
 * Syllables are joined without spaces: `"chuan2 tong3"` → `"chuántǒng"`.
 * Pass `{ separator: ' ' }` for sentence pinyin, which stays spaced.
 */
export function numToMarks(pinyinNum, { separator = '' } = {}) {
  return String(pinyinNum)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(syllableToMarks)
    .join(separator);
}

/**
 * Tone of a numbered syllable, for `--t1..--t5` coloring.
 * `"hao3"` → 3; a toneless syllable → 5 (neutral); anything with no vowel → 0.
 */
export function syllableTone(syllable) {
  const { base, tone } = splitTone(String(syllable));
  if (tone >= 1 && tone <= 5) return tone;
  return markIndex(normalizeU(base)) === -1 ? 0 : 5;
}
