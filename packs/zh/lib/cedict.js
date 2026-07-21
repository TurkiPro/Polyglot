/**
 * CC-CEDICT parser.
 *
 * Line format: `傳統 传统 [chuan2 tong3] /tradition/traditional/`
 * Lines starting with `#` are comments/metadata.
 */

/** Definitions that only point at another headword. */
const CROSS_REF =
  /^(?:(?:old|archaic|erhua|Taiwan|Japanese|surname)\s+)?(?:variant of|see also|see|same as|also written|abbr\. for|equivalent of)\b/i;

/** A CEDICT line, split into fields. */
const LINE = /^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\/(.*)\/\s*$/;

/**
 * @typedef {{ trad: string, simp: string, pinyinNum: string, defs: string[] }} CedictEntry
 */

/**
 * Drop pure cross-references, but never return an empty list — if every definition is a
 * cross-reference, the cross-references are all the meaning there is.
 * @param {string[]} defs
 */
export function pruneCrossRefs(defs) {
  const kept = defs.filter((d) => !CROSS_REF.test(d));
  return kept.length > 0 ? kept : defs;
}

/**
 * @param {string} text
 * @returns {{ entries: CedictEntry[], bySimp: Map<string, CedictEntry[]>, skipped: number }}
 */
export function parseCedict(text) {
  const entries = [];
  const bySimp = new Map();
  let skipped = 0;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const m = LINE.exec(line);
    if (!m) {
      skipped++;
      continue;
    }

    const [, trad, simp, pinyinNum, defsRaw] = m;
    const defs = pruneCrossRefs(defsRaw.split('/').map((d) => d.trim()).filter(Boolean));
    if (defs.length === 0) {
      skipped++;
      continue;
    }

    const entry = { trad, simp, pinyinNum: pinyinNum.trim(), defs };
    entries.push(entry);
    const list = bySimp.get(simp);
    if (list) list.push(entry);
    else bySimp.set(simp, [entry]);
  }

  return { entries, bySimp, skipped };
}

/**
 * Pick the entry a learner means by a bare headword.
 *
 * A simplified form often has several readings (好 = hǎo "good" and hào "to be fond of").
 * The deck carries one word per HSK entry, so we take the reading with the most
 * definitions — a reliable proxy for the dominant sense — and break ties by file order
 * to stay deterministic across rebuilds.
 *
 * @param {CedictEntry[]} candidates
 * @returns {CedictEntry | undefined}
 */
export function pickPrimary(candidates) {
  if (!candidates || candidates.length === 0) return undefined;
  let best = candidates[0];
  for (const entry of candidates.slice(1)) {
    if (entry.defs.length > best.defs.length) best = entry;
  }
  return best;
}
