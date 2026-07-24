/**
 * Dependency-ordered introduction — the n+1 pass (Phase 7 §2).
 *
 * Band order teaches 300 unrelated band-1 words before a learner can read one sentence.
 * This orders words so each one debuts inside a sentence whose every *other* word is
 * already known, keeping first exposure in the 90-98% known band that comprehensible-input
 * research points at.
 *
 * Pure: sentences and words in, ranks out. The build script owns the IO.
 */

/** How far we relax before giving up on a clean introduction. */
const RELAXED_UNKNOWN = 1;

/**
 * Greedy segmentation of a sentence into known-vocabulary units.
 *
 * Longest match wins, which is the same rule the sentence-pinyin pass uses, so a
 * sentence is read the same way in both places. Characters no word covers are returned
 * as single-character tokens — they still count as unknown.
 */
export function segment(text, vocabulary, maxWordLength = 8) {
  const tokens = [];
  const chars = [...text];

  for (let i = 0; i < chars.length; ) {
    // Punctuation and spacing are not vocabulary.
    if (!/\p{Script=Han}/u.test(chars[i])) {
      i += 1;
      continue;
    }

    let matched = null;
    for (let length = Math.min(maxWordLength, chars.length - i); length > 0; length--) {
      const candidate = chars.slice(i, i + length).join('');
      if (vocabulary.has(candidate)) {
        matched = candidate;
        break;
      }
    }

    tokens.push(matched ?? chars[i]);
    i += matched ? [...matched].length : 1;
  }

  return tokens;
}

/**
 * The words in a sentence that are not yet known, excluding the candidate itself.
 * @returns {Set<string>}
 */
function unknownIn(sentence, candidate, known, vocabulary, maxWordLength) {
  const unknown = new Set();
  for (const token of segment(sentence.zh, vocabulary, maxWordLength)) {
    if (token === candidate || known.has(token)) continue;
    unknown.add(token);
  }
  return unknown;
}

/**
 * Order the deck so every word debuts in a sentence the learner can already read.
 *
 * @param {object[]} words deck words, each with `simp`, `band`, `sentences`
 * @param {string[]} seedOrder the bootstrap words no sentence can precede
 * @returns {{ ranked: object[], stats: object }}
 */
export function orderByIntroduction(words, seedOrder = []) {
  const bySimp = new Map(words.map((word) => [word.simp, word]));
  const vocabulary = new Set(bySimp.keys());
  const maxWordLength = words.reduce((max, word) => Math.max(max, [...word.simp].length), 1);

  const known = new Set();
  const ranked = [];
  const stats = { seeded: 0, clean: 0, relaxed: 0, none: 0 };

  /** Give a word its rank, and let everything after it assume the word is known. */
  const place = (word, sentence, quality) => {
    word.introRank = ranked.length + 1;
    if (sentence) word.introSentence = sentence.src;
    word.introQuality = quality;
    known.add(word.simp);
    ranked.push(word);
    stats[quality] += 1;
  };

  // 1. The seeds: bootstrap vocabulary, in the order given. Nothing can precede them.
  for (const simp of seedOrder) {
    const word = bySimp.get(simp);
    if (!word || word.introRank) continue;
    place(word, null, 'seeded');
  }

  // 2. Everything else, in band-then-deck order, taking the first word that can be
  //    introduced cleanly. Restarting the scan each round is what makes it dependency
  //    ordered rather than merely filtered.
  const remaining = words
    .filter((word) => !word.introRank)
    .sort((a, b) => (a.band ?? 99) - (b.band ?? 99) || words.indexOf(a) - words.indexOf(b));

  const pending = new Set(remaining);

  for (const maxUnknown of [0, RELAXED_UNKNOWN]) {
    let progress = true;
    while (progress) {
      progress = false;
      for (const word of remaining) {
        if (!pending.has(word)) continue;

        for (const sentence of word.sentences ?? []) {
          const unknown = unknownIn(sentence, word.simp, known, vocabulary, maxWordLength);
          if (unknown.size <= maxUnknown) {
            place(word, sentence, maxUnknown === 0 ? 'clean' : 'relaxed');
            pending.delete(word);
            progress = true;
            break;
          }
        }
      }
    }
  }

  // 3. Whatever is left has no sentence that fits — introduced bare, in curriculum order.
  for (const word of remaining) {
    if (pending.has(word)) place(word, null, 'none');
  }

  return { ranked, stats };
}

/** Introduction quality for bands 1-3, where a beginner actually lives. */
export function earlyBandMetrics(words, maxBand = 3) {
  const early = words.filter((word) => (word.band ?? 99) <= maxBand && (word.band ?? 0) > 0);
  const count = (quality) => early.filter((word) => word.introQuality === quality).length;
  const total = early.length || 1;
  const pct = (n) => Math.round((n / total) * 1000) / 10;

  return {
    total: early.length,
    seeded: count('seeded'),
    clean: count('clean'),
    relaxed: count('relaxed'),
    none: count('none'),
    cleanPct: pct(count('clean') + count('seeded')),
    relaxedPct: pct(count('relaxed')),
    nonePct: pct(count('none')),
  };
}
