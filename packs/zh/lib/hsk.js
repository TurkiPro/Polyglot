/**
 * HSK 3.0 band lists → `word → band`.
 *
 * The source files are one word per line, with two annotation conventions:
 *   - a trailing digit marks a homograph (`和1`, `花2` are separate senses of 和 / 花)
 *   - full-width parentheses mark an optional part (`没（有）`, `有时（候）`)
 * Neither is part of the word, so each line expands to ordered candidate spellings and
 * the caller picks the first one the dictionary actually knows.
 *
 * Levels are read in ascending order and the first assignment wins, so a word that
 * reappears in a higher list keeps its lowest band — the band a learner first meets it.
 */

/** The 7-9 list collapses to band 7 (§5.1). */
export function bandFromFilename(filename) {
  const m = /HSK_Level_(\d+)(?:-\d+)?_words/.exec(filename);
  if (!m) throw new Error(`hsk: cannot read a band from "${filename}"`);
  return Number(m[1]);
}

/**
 * Candidate spellings for one raw list entry, most complete first.
 * `没（有）` → `['没有', '没']`; `和1` → `['和']`.
 * @param {string} raw
 * @returns {string[]}
 */
export function wordVariants(raw) {
  const stripped = raw.trim().replace(/[0-9]+$/, '');
  if (!stripped) return [];

  const full = stripped.replace(/[（(]([^）)]*)[）)]/g, '$1');
  const short = stripped.replace(/[（(][^）)]*[）)]/g, '');

  const variants = [];
  for (const v of [full, short]) {
    if (v && !variants.includes(v)) variants.push(v);
  }
  return variants;
}

/**
 * @param {Array<{ filename: string, text: string }>} files in ascending band order
 * @returns {{ entries: Array<{ raw: string, variants: string[], band: number }>, listed: number }}
 */
export function parseHsk(files) {
  const entries = [];
  let listed = 0;

  for (const { filename, text } of files) {
    const band = bandFromFilename(filename);
    for (const rawLine of text.split('\n')) {
      const raw = rawLine.trim();
      if (!raw || raw.startsWith('#')) continue;
      listed++;
      const variants = wordVariants(raw);
      if (variants.length) entries.push({ raw, variants, band });
    }
  }

  return { entries, listed };
}
