/**
 * The Course (Phase 9 §1): units carved from the introRank spine.
 *
 * Units do not re-order anything — they are contiguous slices of the existing n+1
 * introduction order, so the course teaches words in the same dependency order the review
 * queue already uses. Seams are nudged by a few words to keep a topic cluster whole, titles
 * are drafted from a unit's dominant topic, and everything is overridable in
 * `course-overrides.json` — the same reviewable-data pattern as topics.json and overrides.json.
 *
 * Pure and deterministic: the same words, topics and overrides yield a byte-identical course.
 */
import { config } from '../../../config/app.config.js';

/** How far a unit seam may slide to land on a topic boundary (§1) — the ±3 of UNIT_SIZE ±3. */
const SEAM_NUDGE = 3;

/** A "new phrase" beat is offered no sooner than this many words after the last one (§10 A1). */
const PHRASE_GAP = 2;

/** Punctuation the segmenter skips — matches the client segmenter in exercises.js. */
const PUNCT = /[\s，。！？、；：""''（）,.!?]/;

/**
 * Greedy longest-match segmentation against a set of headwords (Phase 10 A1, build-time).
 * Deliberately mirrors `segment()` in `app/src/engine/exercises.js` so a PHRASE the pipeline
 * emits is exactly one the runtime can build — the segmentation is not the sequencer, only the
 * eligibility check for a step the single `steps[]` list then drives.
 */
function segmentDeckWords(text, bySimp, maxLen) {
  const chars = [...text];
  const tiles = [];
  let i = 0;
  while (i < chars.length) {
    if (PUNCT.test(chars[i])) { i += 1; continue; }
    let matched = null;
    for (let len = Math.min(maxLen, chars.length - i); len >= 1; len--) {
      const candidate = chars.slice(i, i + len).join('');
      if (bySimp.has(candidate)) { matched = candidate; break; }
    }
    if (matched) { tiles.push({ simp: matched, deck: true }); i += [...matched].length; }
    else { tiles.push({ simp: chars[i], deck: false }); i += 1; }
  }
  return tiles;
}

/**
 * The `src` of a sentence of `word` every one of whose deck-words is already known, if any —
 * the sentence a PHRASE step spotlights. "Known" is structural (introRank position), never a
 * user's history, so the derivation stays a pure function of the pack.
 */
function phraseSrc(word, bySimp, maxLen, knownSimp) {
  for (const sentence of word.sentences ?? []) {
    const deckTiles = segmentDeckWords(sentence.zh, bySimp, maxLen).filter((t) => t.deck);
    if (deckTiles.length >= 3 && deckTiles.length <= 8 &&
        deckTiles.every((t) => knownSimp.has(t.simp)) &&
        deckTiles.some((t) => t.simp === word.simp)) {
      return sentence.src ?? sentence.zh;
    }
  }
  return null;
}

/**
 * A unit's ordered `steps[]` — the ONE sequence the syllabus and the lesson runner both read
 * (Phase 10 A1). Kinds: WORD (teach + first practice, in introRank order), PHRASE (a sentence
 * spotlight when one is now buildable, a beat every 2–3 words), PRACTICE (a mixed set every
 * LESSON_WORDS words), and CHECKPOINT (always last). Derived, deterministic, resequences
 * nothing — it only names structure over the unchanged word order.
 *
 * @param {object[]} unitWords the unit's words, in order
 * @param {Set<string>} knownSimp simp of every word introduced up to this unit (mutated as we go)
 * @param {Map<string, object>} bySimp deck lookup by spelling
 * @param {number} maxLen longest headword, for the segmenter
 * @param {number} lessonWords LESSON_WORDS
 */
function deriveSteps(unitWords, knownSimp, bySimp, maxLen, lessonWords) {
  const steps = [];
  let sincePhrase = 0;
  let sincePractice = 0;
  unitWords.forEach((word, index) => {
    steps.push({ kind: 'WORD', wordId: word.id });
    knownSimp.add(word.simp);
    sincePhrase += 1;
    sincePractice += 1;

    if (sincePhrase >= PHRASE_GAP) {
      const src = phraseSrc(word, bySimp, maxLen, knownSimp);
      if (src) {
        steps.push({ kind: 'PHRASE', wordId: word.id, src });
        sincePhrase = 0;
      }
    }
    // A mixed practice set after each full LESSON_WORDS, but never immediately before the
    // checkpoint (the last word's set would duplicate it).
    if (sincePractice >= lessonWords && index < unitWords.length - 1) {
      steps.push({ kind: 'PRACTICE' });
      sincePractice = 0;
    }
  });
  steps.push({ kind: 'CHECKPOINT' });
  return steps;
}

/** `u007` — zero-padded so ids sort lexically and stay stable once shipped (§1). */
export const unitId = (index) => `u${String(index + 1).padStart(3, '0')}`;

/** Every topic a word belongs to, as a Map<wordId, Set<topic>>. */
function topicIndex(topics) {
  const index = new Map();
  for (const [topic, ids] of Object.entries(topics ?? {})) {
    for (const id of ids) {
      if (!index.has(id)) index.set(id, new Set());
      index.get(id).add(topic);
    }
  }
  return index;
}

/**
 * Cut points for `unitCount` units over `total` words, each internal cut slid up to
 * SEAM_NUDGE toward a topic boundary — a place where the topic sets on either side are
 * disjoint and at least one is non-empty. Bands past the topic-mapped range (4+) simply
 * have no seams, so those cuts stay on their even spacing.
 */
function boundaries(words, unitCount, topicsOf) {
  const total = words.length;
  const bounds = [0];
  for (let k = 1; k < unitCount; k++) bounds.push(Math.round((k * total) / unitCount));
  bounds.push(total);

  const isSeam = (i) => {
    const before = topicsOf(words[i - 1]?.id);
    const after = topicsOf(words[i]?.id);
    if (!before.size && !after.size) return false;
    for (const topic of before) if (after.has(topic)) return false;
    return true;
  };

  for (let k = 1; k < unitCount; k++) {
    const nominal = bounds[k];
    let best = nominal;
    let bestDist = Infinity;
    for (let offset = -SEAM_NUDGE; offset <= SEAM_NUDGE; offset++) {
      const i = nominal + offset;
      // Keep both neighbouring units comfortably sized while nudging.
      if (i <= bounds[k - 1] + SEAM_NUDGE || i >= bounds[k + 1] - SEAM_NUDGE) continue;
      if (isSeam(i) && Math.abs(offset) < bestDist) {
        best = i;
        bestDist = Math.abs(offset);
      }
    }
    bounds[k] = best;
  }
  return bounds;
}

/** The band that most of a unit's words belong to; ties go to the lower band. */
function dominantBand(unitWords) {
  const counts = new Map();
  for (const word of unitWords) counts.set(word.band, (counts.get(word.band) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** The topic most of a unit's words share, or null; ties go to the first-declared topic. */
function dominantTopic(unitWords, topicsOf, topicOrder) {
  const counts = new Map();
  for (const word of unitWords) for (const topic of topicsOf(word.id)) {
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  if (!counts.size) return null;
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || topicOrder.indexOf(a[0]) - topicOrder.indexOf(b[0]),
  )[0][0];
}

/**
 * Build the course.
 *
 * @param {object[]} words deck words (need `id`, `introRank`, `band`)
 * @param {{ topics?: Record<string, string[]>, labels?: Record<string, string> }} topicsFile
 * @param {{ titles?: Record<string, string>, notes?: Record<string, string>, courseBands?: number[], unitSize?: number }} [options]
 */
export function buildCourse(words, topicsFile = {}, options = {}) {
  const {
    titles = {},
    notes = {},
    courseBands = config.course.courseBands,
    unitSize = config.course.unitSize,
    lessonWords = config.course.lessonWords,
    soundsUnit = null, // Phase 10 B: prepend Unit 0 "The Sounds" when the caller supplies it
  } = options;
  const topics = topicsFile.topics ?? {};
  const labels = topicsFile.labels ?? {};
  const topicOrder = Object.keys(topics);
  const index = topicIndex(topics);
  const topicsOf = (id) => index.get(id) ?? new Set();

  // One deck lookup for the PHRASE segmenter, over every word (not just this unit's).
  const bySimp = new Map();
  let maxLen = 1;
  for (const word of words) {
    if (!bySimp.has(word.simp)) bySimp.set(word.simp, word);
    maxLen = Math.max(maxLen, [...word.simp].length);
  }
  const knownSimp = new Set(); // grows across units, in introRank order

  const ordered = [...words].sort((a, b) => a.introRank - b.introRank);
  const unitCount = Math.max(1, Math.round(ordered.length / unitSize));
  const bounds = boundaries(ordered, unitCount, topicsOf);
  const maxAuthored = Math.max(...courseBands);

  const perBandCount = new Map(); // band → how many auto-units seen, for "Unit N"
  const units = [];

  for (let k = 0; k < unitCount; k++) {
    const slice = ordered.slice(bounds[k], bounds[k + 1]);
    if (!slice.length) continue;
    const id = unitId(units.length);
    const band = dominantBand(slice);

    let title;
    if (band <= maxAuthored) {
      const topic = dominantTopic(slice, topicsOf, topicOrder);
      title = topic ? labels[topic] ?? topic : `Unit ${units.length + 1}`;
    } else {
      const n = (perBandCount.get(band) ?? 0) + 1;
      perBandCount.set(band, n);
      title = `Band ${band} · Unit ${n}`;
    }

    const unit = { id, title: titles[id] ?? title, wordIds: slice.map((w) => w.id), band };
    const note = notes[id];
    if (note) unit.note = note;
    unit.steps = deriveSteps(slice, knownSimp, bySimp, maxLen, lessonWords);
    units.push(unit);
  }

  // Unit sizes are measured over the word-bearing units, before Unit 0 (wordless) joins them.
  const wordUnits = units;
  const sizes = {
    min: Math.min(...wordUnits.map((u) => u.wordIds.length)),
    max: Math.max(...wordUnits.map((u) => u.wordIds.length)),
  };
  const all = soundsUnit ? [soundsUnit, ...units] : units;

  const stepTotals = { WORD: 0, PHRASE: 0, PRACTICE: 0, CHECKPOINT: 0 };
  for (const unit of all) for (const step of unit.steps) stepTotals[step.kind] = (stepTotals[step.kind] ?? 0) + 1;

  return {
    units: all,
    stats: {
      units: all.length,
      authored: units.filter((u) => u.band <= maxAuthored).length,
      withNote: units.filter((u) => u.note).length,
      sizes,
      steps: stepTotals,
    },
  };
}
