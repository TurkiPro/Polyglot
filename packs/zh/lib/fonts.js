/**
 * Subset Noto Serif SC to the characters this pack actually uses.
 *
 * The full variable font is ~25 MB; the deck needs about 3,100 characters, so subsetting
 * brings each weight down to something a phone can fetch. Self-hosted, because §1.2 bans
 * third-party requests at runtime.
 *
 * Dictionary results outside the subset fall back down the `--font-han` stack — a rare
 * character rendering in the system serif is acceptable (§3.2.3).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import subsetFont from 'subset-font';

/** The weights the design uses: body and emphasis. */
export const WEIGHTS = [400, 700];

/** Han characters, so Latin UI text does not drag glyphs into the subset. */
const HAN = /\p{Script=Han}/u;

/**
 * Every character the pack needs in the serif face: deck words and their sentences,
 * plus any hanzi hard-coded in UI strings (the 学 watermark, the 语 mark).
 *
 * @param {object[]} words deck words
 * @param {string} uiText concatenated UI strings
 * @returns {string} sorted unique characters
 */
export function collectCharacters(words, uiText = '') {
  const chars = new Set();
  const add = (text) => {
    for (const ch of String(text ?? '')) if (HAN.test(ch)) chars.add(ch);
  };

  for (const word of words) {
    add(word.simp);
    add(word.trad);
    for (const sentence of word.sentences ?? []) add(sentence.zh);
  }
  add(uiText);

  return [...chars].sort().join('');
}

/**
 * Write one woff2 per weight.
 *
 * @param {Buffer} source the variable font
 * @param {string} characters
 * @param {URL} outDir
 * @returns {Promise<Array<{ weight: number, file: string, bytes: number }>>}
 */
export async function subsetWeights(source, characters, outDir) {
  await mkdir(outDir, { recursive: true });
  const written = [];

  for (const weight of WEIGHTS) {
    const buffer = await subsetFont(source, characters, {
      targetFormat: 'woff2',
      // Pin the variable axis, so each file is a static instance of one weight.
      variationAxes: { wght: weight },
    });
    const file = `noto-serif-sc-${weight}.woff2`;
    await writeFile(new URL(file, outDir), buffer);
    written.push({ weight, file, bytes: buffer.length });
  }

  return written;
}

/** Read the downloaded variable font. */
export const readSourceFont = (path) => readFile(path);

/** Count the characters in a subset string, for the report. */
export const characterCount = (characters) => [...characters].length;
