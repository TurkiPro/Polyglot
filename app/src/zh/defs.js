/**
 * CC-CEDICT definition text: the parts meant for people, and the parts meant for parsers.
 *
 * A definition list can carry a classifier entry — `CL:個|个[ge4],片[pian4]` — which is
 * data, not a gloss. Search rows strip it; the word page renders it properly (§3.3.4).
 */

/** A definition that is really a classifier list. */
const CLASSIFIER_RE = /^CL:/;

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

/** Definitions with classifier entries removed — what a person wants to read. */
export const humanDefs = (defs = []) => defs.filter((def) => !CLASSIFIER_RE.test(def));

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
