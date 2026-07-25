/**
 * Tone colouring: wrap each syllable in `<span class="t1…t5">` (§9).
 *
 * Colours are CSS variables fed from config at boot (see main.js), never literals here.
 */
import { syllableTone, syllableToMarks } from './pinyin.js';

/**
 * Colour a numbered-pinyin string.
 * @param {string} pinyinNum e.g. `"chuan2 tong3"`
 * @param {{ separator?: string }} [options] `''` for words, `' '` for sentences
 * @returns {DocumentFragment}
 */
export function colorPinyin(pinyinNum, { separator = '' } = {}) {
  const fragment = document.createDocumentFragment();
  const syllables = String(pinyinNum ?? '').trim().split(/\s+/).filter(Boolean);

  syllables.forEach((syllable, index) => {
    if (index > 0 && separator) fragment.append(document.createTextNode(separator));
    const tone = syllableTone(syllable);
    const span = document.createElement('span');
    if (tone >= 1 && tone <= 5) span.className = `t${tone}`;
    span.textContent = syllableToMarks(syllable);
    fragment.append(span);
  });

  return fragment;
}

/**
 * Colour already-marked sentence pinyin (the pack stores it pre-converted).
 * Tone is read back from the diacritic, so this works without the numbered form.
 */
export function colorMarkedPinyin(marked) {
  const fragment = document.createDocumentFragment();
  for (const token of String(marked ?? '').split(/(\s+)/)) {
    if (!token) continue;
    if (/^\s+$/.test(token)) {
      fragment.append(document.createTextNode(token));
      continue;
    }
    const span = document.createElement('span');
    const tone = toneFromMarks(token);
    if (tone) span.className = `t${tone}`;
    span.textContent = token;
    fragment.append(span);
  }
  return fragment;
}

/** Tone marks by tone number, for reading a tone back off a marked syllable. */
const MARKED = ['āēīōūǖĀĒĪŌŪǕ', 'áéíóúǘÁÉÍÓÚǗ', 'ǎěǐǒǔǚǍĚǏǑǓǙ', 'àèìòùǜÀÈÌÒÙǛ'];

/** @returns {number} 1-4, 5 for an unmarked syllable, 0 when there is no letter at all. */
export function toneFromMarks(syllable) {
  for (const ch of String(syllable)) {
    for (let tone = 0; tone < MARKED.length; tone++) {
      if (MARKED[tone].includes(ch)) return tone + 1;
    }
  }
  return /\p{Letter}/u.test(String(syllable)) ? 5 : 0;
}

/** Wrap each CJK character of a run in a hoverable gloss span; punctuation passes through. */
function glossRun(text, fragment) {
  for (const ch of text) {
    if (/[㐀-鿿]/u.test(ch)) {
      const span = document.createElement('span');
      span.className = 'gloss';
      span.dataset.gloss = ch;
      span.textContent = ch;
      fragment.append(span);
    } else {
      fragment.append(document.createTextNode(ch));
    }
  }
}

/**
 * A sentence with the target word marked, for SENT fronts (§9). Every character is a hover
 * gloss (feedback #1); the target run is one span so it keeps its highlight and glosses as
 * the whole word.
 * @returns {DocumentFragment}
 */
export function highlightWord(sentence, word) {
  const fragment = document.createDocumentFragment();
  const text = String(sentence ?? '');
  const needle = String(word ?? '');

  if (!needle) {
    glossRun(text, fragment);
    return fragment;
  }

  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) break;
    if (at > from) glossRun(text.slice(from, at), fragment);
    const mark = document.createElement('span');
    mark.className = 'target gloss';
    mark.dataset.gloss = needle;
    mark.textContent = needle;
    fragment.append(mark);
    from = at + needle.length;
  }
  if (from < text.length) glossRun(text.slice(from), fragment);
  return fragment;
}
