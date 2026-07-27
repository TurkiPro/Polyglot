/**
 * The measured price of coherence (Phase 11 §3).
 *
 * The theme-first scheduler introduces words in a new global order, which can push a word ahead
 * of the sentence that would have introduced it cleanly. This measures the intro quality UNDER a
 * given order — the same clean-n+1 / relaxed / bare classification the deck's n+1 pass uses — so
 * the build can report the trade-off side by side and enforce floors. Pure.
 */
import { segment } from './intro.js';

/**
 * Classify each word's introduction as it lands in `order`, and return the bands-1-3 mix plus
 * the band-1-only clean rate.
 *
 * @param {string[]} order word ids, in introduction order
 * @param {object[]} allWords the whole deck (for the segmenter's vocabulary and lookup)
 * @param {{ seedOrder?: string[], maxBand?: number }} [opts]
 */
export function measureIntro(order, allWords, { seedOrder = [], maxBand = 3 } = {}) {
  const byId = new Map(allWords.map((w) => [w.id, w]));
  const vocab = new Set(allWords.map((w) => w.simp));
  const maxLen = allWords.reduce((m, w) => Math.max(m, [...w.simp].length), 1);
  const seed = new Set(seedOrder);

  const known = new Set();
  const early = { seeded: 0, clean: 0, relaxed: 0, none: 0, total: 0 };
  const band1 = { clean: 0, total: 0 };

  for (const id of order) {
    const word = byId.get(id);
    if (!word) continue;

    let cls;
    if (seed.has(word.simp)) cls = 'seeded';
    else {
      let best = Infinity;
      for (const sentence of word.sentences ?? []) {
        let unknown = 0;
        for (const token of segment(sentence.zh, vocab, maxLen)) {
          if (token !== word.simp && !known.has(token)) unknown += 1;
        }
        best = Math.min(best, unknown);
        if (best === 0) break;
      }
      cls = best === 0 ? 'clean' : best === 1 ? 'relaxed' : 'none';
    }
    known.add(word.simp);

    const b = word.band ?? 99;
    if (b >= 1 && b <= maxBand) { early[cls] += 1; early.total += 1; }
    if (b === 1) { band1.total += 1; if (cls === 'clean' || cls === 'seeded') band1.clean += 1; }
  }

  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  return {
    band1CleanPct: pct(band1.clean, band1.total),
    cleanPct: pct(early.clean + early.seeded, early.total),
    relaxedPct: pct(early.relaxed, early.total),
    nonePct: pct(early.none, early.total),
    counts: early,
  };
}

/** The deck's own n+1 order (the "before"), for a side-by-side with the scheduled order. */
export function introRankOrder(words, maxBand = 3) {
  return words
    .filter((w) => (w.band ?? 99) >= 1 && (w.band ?? 99) <= maxBand)
    .sort((a, b) => a.introRank - b.introRank)
    .map((w) => w.id);
}
