/**
 * Character decomposition, from makemeahanzi's `dictionary.txt` (Phase 7 §3).
 *
 * The teach screen shows what a character is made of — 好 = 女 woman + 子 child — because
 * a character with visible parts is a structure rather than a squiggle to memorise.
 *
 * Source is LGPL-3.0-or-later, derived from Unihan and CJKlib; redistributable and
 * compatible with this project's AGPL-3.0. Credited via the pipeline like every source.
 */

/** Ideographic Description Characters, which describe layout rather than content. */
const IDC = /[⿰-⿿]/gu;
/** makemeahanzi writes an unknown component as `？`. */
const UNKNOWN = '？';

/**
 * Parse `dictionary.txt` — one JSON object per line.
 * @returns {Map<string, { decomposition: string, radical: string, definition?: string }>}
 */
export function parseDecomposition(text) {
  const byChar = new Map();

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue; // A malformed line is not worth failing a build over.
    }
    if (!entry?.character) continue;

    byChar.set(entry.character, {
      decomposition: entry.decomposition ?? '',
      radical: entry.radical ?? '',
      definition: entry.definition ?? undefined,
    });
  }

  return byChar;
}

/**
 * The components of one character: the parts, without the layout operators.
 *
 * Only the top level is used. Recursing to atoms turns 好 into a tree nobody reads on a
 * teach screen; one line per visible part is the point.
 *
 * @returns {Array<{ char: string, meaning?: string, radical?: boolean }>}
 */
export function componentsOf(char, byChar) {
  const entry = byChar.get(char);
  if (!entry?.decomposition) return [];

  const parts = [...entry.decomposition.replace(IDC, '')]
    .filter((part) => part !== UNKNOWN && part !== char);

  const seen = new Set();
  const components = [];

  for (const part of parts) {
    if (seen.has(part)) continue;
    seen.add(part);

    const info = byChar.get(part);
    components.push({
      char: part,
      // Component glosses are one word or two; a full definition would swamp the screen.
      meaning: info?.definition ? shortMeaning(info.definition) : undefined,
      radical: part === entry.radical || undefined,
    });
  }

  return components;
}

/** The first sense only, trimmed — a component is a hint, not a dictionary entry. */
function shortMeaning(definition) {
  const first = String(definition).split(/[;,]/)[0].trim();
  return first.length > 40 ? `${first.slice(0, 39)}…` : first;
}

/**
 * Attach `components` to every deck word that has any.
 *
 * Single-character words get their own breakdown; multi-character words get one entry
 * per character, so 学习 explains both halves.
 *
 * @returns {{ withComponents: number, charsCovered: number }}
 */
export function attachComponents(words, byChar) {
  let withComponents = 0;
  const covered = new Set();

  for (const word of words) {
    const chars = [...word.simp].filter((char) => /\p{Script=Han}/u.test(char));
    const breakdown = [];

    for (const char of chars) {
      const parts = componentsOf(char, byChar);
      const info = byChar.get(char);
      if (parts.length === 0 && !info?.definition) continue;

      covered.add(char);
      breakdown.push({
        char,
        meaning: info?.definition ? shortMeaning(info.definition) : undefined,
        parts: parts.length ? parts : undefined,
      });
    }

    if (breakdown.length) {
      word.components = breakdown;
      withComponents += 1;
    }
  }

  return { withComponents, charsCovered: covered.size };
}
