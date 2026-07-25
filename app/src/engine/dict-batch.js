/**
 * Shaping CC-CEDICT rows for IndexedDB, in batches (audit F3).
 *
 * The dictionary is ~120k entries. Parsing and reshaping it on the main thread froze
 * phones at first Browse, so the work moved into `dict-worker.js`. This module is the
 * pure half of that worker — no `self`, no `fetch` — so the batching can be unit-tested
 * without a Worker at all.
 */

/** Entries per message. Large enough to keep the postMessage count low, small enough that
 *  one IndexedDB write between animation frames stays imperceptible. */
export const DICT_BATCH = 2000;

/** The stored per-entry array `[simp, trad, pinyinNum, defs]` → the `dict` store shape (§5.2). */
export function shapeRow([simp, trad, pinyinNum, defs]) {
  return { simp, trad, pinyinNum, defs };
}

/**
 * Split the parsed dictionary into shaped, IndexedDB-ready batches.
 * @param {Array<[string, string, string, string[]]>} entries
 * @param {number} [size]
 * @returns {Generator<Array<{ simp: string, trad: string, pinyinNum: string, defs: string[] }>>}
 */
export function* dictBatches(entries, size = DICT_BATCH) {
  for (let i = 0; i < entries.length; i += size) {
    yield entries.slice(i, i + size).map(shapeRow);
  }
}
