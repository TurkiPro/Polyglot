/**
 * Example sentences from the Tatoeba exports.
 *
 * Sentence files: `<id>\t<lang>\t<text>`. Links file: `<cmn id>\t<eng id>`.
 *
 * The matching is inverted on purpose: rather than searching ~100k sentences for each of
 * ~11k deck words (a billion substring tests), each sentence is scanned once for the
 * deck words it contains, which is linear in sentence length.
 */
import { decodeUtf8, forEachLine, leadingInt } from './download.js';

const TAB = 0x09;

/** Characters after the text column, mapped for the romanized line. */
const PUNCT = new Map(Object.entries({
  '。': '.', '，': ',', '、': ',', '？': '?', '！': '!', '：': ':', '；': ';',
  '（': '(', '）': ')', '《': '<', '》': '>', '“': '"', '”': '"', '‘': "'", '’': "'",
  '—': '-', '…': '…', '·': '·',
}));

/** Count code points, so a rare character outside the BMP still counts as one. */
export const charLength = (text) => [...text].length;

/**
 * Read a `<id>\t<lang>\t<text>` export, keeping only rows the caller wants.
 * @param {Uint8Array} bytes
 * @param {(id: number) => boolean} keep
 * @returns {Map<number, string>}
 */
export function parseSentences(bytes, keep) {
  const out = new Map();
  forEachLine(bytes, (line) => {
    const id = leadingInt(line);
    if (id < 0 || !keep(id)) return;
    // Skip the id and lang columns without decoding them.
    let tab1 = -1;
    let tab2 = -1;
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== TAB) continue;
      if (tab1 === -1) tab1 = i;
      else {
        tab2 = i;
        break;
      }
    }
    if (tab2 === -1) return;
    out.set(id, decodeUtf8(line.subarray(tab2 + 1)));
  });
  return out;
}

/**
 * Read `<cmn id>\t<eng id>` pairs.
 * @returns {Map<number, number[]>} cmn id → linked eng ids, ascending
 */
export function parseLinks(bytes, keepCmn) {
  const out = new Map();
  forEachLine(bytes, (line) => {
    const cmnId = leadingInt(line);
    if (cmnId < 0 || !keepCmn(cmnId)) return;
    let tab = -1;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === TAB) {
        tab = i;
        break;
      }
    }
    if (tab === -1) return;
    const engId = leadingInt(line.subarray(tab + 1));
    if (engId < 0) return;
    const list = out.get(cmnId);
    if (list) list.push(engId);
    else out.set(cmnId, [engId]);
  });
  for (const list of out.values()) list.sort((a, b) => a - b);
  return out;
}

/**
 * Index which sentences contain which deck words.
 * @param {Map<number, string>} sentences
 * @param {Set<string>} words
 * @param {number} maxWordLen
 * @returns {Map<string, number[]>}
 */
export function indexWordSentences(sentences, words, maxWordLen) {
  const index = new Map();
  for (const [id, text] of sentences) {
    const chars = [...text];
    const seen = new Set();
    for (let i = 0; i < chars.length; i++) {
      let candidate = '';
      for (let len = 1; len <= maxWordLen && i + len <= chars.length; len++) {
        candidate += chars[i + len - 1];
        if (seen.has(candidate) || !words.has(candidate)) continue;
        seen.add(candidate);
        const list = index.get(candidate);
        if (list) list.push(id);
        else index.set(candidate, [id]);
      }
    }
  }
  return index;
}

/**
 * Greedy longest-match segmentation against CEDICT headwords, so a sentence gets the
 * reading its words actually have (的 in 目的 is `di4`, not the particle `de`).
 * Unknown characters pass through unchanged. Always paired with `pinyinAuto: true`.
 *
 * @param {string} text
 * @param {(word: string) => string | undefined} readingOf returns numbered pinyin
 * @param {(pinyinNum: string) => string} toMarks
 * @param {number} maxWordLen
 */
export function sentencePinyin(text, readingOf, toMarks, maxWordLen) {
  const chars = [...text];
  const parts = [];

  for (let i = 0; i < chars.length; ) {
    let matched = null;
    for (let len = Math.min(maxWordLen, chars.length - i); len >= 1; len--) {
      const candidate = chars.slice(i, i + len).join('');
      const reading = readingOf(candidate);
      if (reading) {
        matched = { reading, len };
        break;
      }
    }

    if (matched) {
      parts.push({ text: toMarks(matched.reading), glue: false });
      i += matched.len;
      continue;
    }

    const ch = chars[i++];
    const mapped = PUNCT.get(ch);
    if (mapped !== undefined) parts.push({ text: mapped, glue: true });
    else if (/\s/.test(ch)) continue;
    else parts.push({ text: ch, glue: false });
  }

  // Join with spaces, but never leave a space before punctuation.
  let out = '';
  for (const part of parts) {
    if (out && !part.glue) out += ' ';
    out += part.text;
  }
  return out;
}

/**
 * Choose the example sentences for one word: shortest first, ties broken by id so
 * rebuilds are deterministic.
 *
 * @param {number[]} candidateIds
 * @param {Map<number, string>} cmn
 * @param {number} limit
 */
export function pickSentences(candidateIds, cmn, limit) {
  return [...new Set(candidateIds)]
    .map((id) => ({ id, text: cmn.get(id) ?? '' }))
    .filter((s) => s.text)
    .sort((a, b) => charLength(a.text) - charLength(b.text) || a.id - b.id)
    .slice(0, limit);
}
