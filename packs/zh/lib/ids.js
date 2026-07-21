/**
 * Deck word ids (§5.1): `zh:<simp>:<pinyinNum, spaces → _>`.
 *
 * Ids are permanent — they key every review event and card in IndexedDB and in D1.
 * Never change how they are formed; on collision append `~2`, `~3`, … in build order.
 */

/** @param {string} lang @param {string} simp @param {string} pinyinNum */
export function baseId(lang, simp, pinyinNum) {
  return `${lang}:${simp}:${String(pinyinNum).trim().replace(/\s+/g, '_')}`;
}

/** Hands out unique ids, suffixing duplicates `~2`, `~3`, … */
export class IdAssigner {
  constructor(lang) {
    this.lang = lang;
    /** @type {Map<string, number>} */
    this.seen = new Map();
    this.collisions = 0;
  }

  /** @returns {string} */
  assign(simp, pinyinNum) {
    const base = baseId(this.lang, simp, pinyinNum);
    const count = this.seen.get(base) ?? 0;
    this.seen.set(base, count + 1);
    if (count === 0) return base;
    this.collisions++;
    return `${base}~${count + 1}`;
  }
}
