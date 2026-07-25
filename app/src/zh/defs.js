/**
 * CC-CEDICT definition text: the parts meant for people, and the parts meant for parsers.
 *
 * A definition list can carry a classifier entry — `CL:個|个[ge4],片[pian4]` — which is
 * data, not a gloss. Search rows strip it; the word page renders it properly (§3.3.4).
 *
 * CEDICT also embeds cross-reference readings as numbered pinyin — `您[nin2]`. People read
 * tone marks, not `nin2`, so those are converted for display (never in the stored deck).
 */
import { numToMarks } from './pinyin.js';

/** A definition that is really a classifier list. */
const CLASSIFIER_RE = /^CL:/;

/** A `[nin2]` / `[nin2 hao3]` reading inside a gloss — numbered pinyin worth prettifying. */
const READING_RE = /\[([a-zü:\s1-5]+?)\]/gi;

/** Replace bracketed numbered readings with tone marks: `您[nin2]` → `您[nín]`. */
export function prettyReadings(text) {
  return String(text).replace(READING_RE, (whole, inner) =>
    /[1-5]/.test(inner) ? `[${numToMarks(inner.trim(), { separator: ' ' })}]` : whole,
  );
}

/** `個|个[ge4]` → `个`; `片[pian4]` → `片`. Simplified wins where both are given. */
function classifierForm(token) {
  const withoutReading = token.replace(/\[[^\]]*\]/g, '').trim();
  const [trad, simp] = withoutReading.split('|');
  return (simp ?? trad ?? '').trim();
}

/** The reading inside `片[pian4]`, if present. */
function classifierReading(token) {
  return /\[([^\]]*)\]/.exec(token)?.[1]?.trim() ?? '';
}

/** Definitions with classifier entries removed and readings prettified — what a person reads. */
export const humanDefs = (defs = []) =>
  defs.filter((def) => !CLASSIFIER_RE.test(def)).map(prettyReadings);

/**
 * The measure words a definition list declares.
 * @returns {Array<{ form: string, reading: string }>}
 */
export function classifiers(defs = []) {
  const found = [];
  for (const def of defs) {
    if (!CLASSIFIER_RE.test(def)) continue;
    for (const token of def.replace(CLASSIFIER_RE, '').split(',')) {
      const form = classifierForm(token);
      if (form) found.push({ form, reading: classifierReading(token) });
    }
  }
  return found;
}

/** A one-line summary for a search row: glosses only, classifiers dropped. */
export const summarize = (defs = [], limit = 3) => humanDefs(defs).slice(0, limit).join('; ');
