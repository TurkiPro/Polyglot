/**
 * The Course (Phase 9 §1, Phase 11 §2): theme-first units under dependency constraints.
 *
 * The early bands the learner lives in are scheduled by `schedule.js` so a unit's membership is
 * literal — every word in "Numbers" is a number; function words ride "Core words" units. Bands
 * past the coherence effort keep spine-ordered auto-units. Titles name what a unit contains;
 * the dominant-topic titler is gone. Everything is overridable in `course-overrides.json`.
 *
 * Pure and deterministic: the same words, topics and overrides yield a byte-identical course.
 */
import { config } from '../../../config/app.config.js';
import { tagTopics } from './topics.js';
import { scheduleUnits } from './schedule.js';

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

/** The band that most of a unit's words belong to; ties go to the lower band. */
function dominantBand(unitWords) {
  const counts = new Map();
  for (const word of unitWords) counts.set(word.band, (counts.get(word.band) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** Bands past the coherence effort keep today's spine-ordered auto-units (§2). */
function autoUnits(lateWords, unitSize) {
  const ordered = [...lateWords].sort((a, b) => a.introRank - b.introRank);
  const perBand = new Map();
  const out = [];
  for (let i = 0; i < ordered.length; i += unitSize) {
    const slice = ordered.slice(i, i + unitSize);
    const band = dominantBand(slice);
    const n = (perBand.get(band) ?? 0) + 1;
    perBand.set(band, n);
    out.push({ title: `Band ${band} · Unit ${n}`, band, wordIds: slice.map((w) => w.id) });
  }
  return out;
}

/**
 * Build the course (Phase 11 §2): theme-first units for the early bands the learner lives in,
 * spine-ordered auto-units beyond. The dominant-topic titler is gone — a unit's title names what
 * it literally contains: `Numbers`, `Core words`, or `Band N · Unit M`.
 *
 * @param {object[]} words deck words (need `id`, `simp`, `introRank`, `band`, `sentences`)
 * @param {{ topics?: Record<string, string[]>, labels?: Record<string, string> }} topicsFile
 * @param {{ titles?, notes?, courseBands?, unitSize?, lessonWords?, cohesion?, seedOrder?, soundsUnit? }} [options]
 */
export function buildCourse(words, topicsFile = {}, options = {}) {
  const {
    titles = {},
    notes = {},
    courseBands = config.course.courseBands,
    unitSize = config.course.unitSize,
    lessonWords = config.course.lessonWords,
    cohesion = config.course.topicCohesion,
    seedOrder = [],
    soundsUnit = null, // Phase 10 B: prepend Unit 0 "The Sounds" when the caller supplies it
  } = options;
  const labels = topicsFile.labels ?? {};
  const coreLabel = 'Core words';

  // One deck lookup for the PHRASE segmenter, over every word (not just this unit's).
  const bySimp = new Map();
  let maxLen = 1;
  for (const word of words) {
    if (!bySimp.has(word.simp)) bySimp.set(word.simp, word);
    maxLen = Math.max(maxLen, [...word.simp].length);
  }
  const byId = new Map(words.map((w) => [w.id, w]));
  const knownSimp = new Set(); // grows across units, in the scheduled order

  const maxAuthored = Math.max(...courseBands);
  // Topic assignment comes from the same tagger that wrote topics.json; callers (tests) may
  // inject it to schedule synthetic words that carry no definitions.
  const tagged = options.home && options.core
    ? { home: options.home, core: options.core, orderedTopics: options.orderedTopics ?? {} }
    : tagTopics(words);
  const { home, core, orderedTopics } = tagged;

  // §2: schedule the early bands theme-first; keep bands 4+ as spine slices.
  const early = words.filter((w) => (w.band ?? 99) >= 1 && (w.band ?? 99) <= maxAuthored);
  const late = words.filter((w) => (w.band ?? 99) > maxAuthored);
  const scheduled = scheduleUnits(early, words, {
    home, core, seedOrder, unitSize, cohesion, orderedTopics,
  });

  const titleFor = (topic) => (topic === 'core' ? coreLabel : labels[topic] ?? topic);
  const raw = [
    ...scheduled.units.map((u) => ({ title: titleFor(u.topic), band: 1, wordIds: u.wordIds })),
    ...autoUnits(late, unitSize),
  ];

  const units = [];
  for (const r of raw) {
    if (!r.wordIds.length) continue;
    const id = unitId(units.length);
    const slice = r.wordIds.map((wid) => byId.get(wid)).filter(Boolean);
    const band = r.band <= maxAuthored ? dominantBand(slice) : r.band;
    const unit = { id, title: titles[id] ?? r.title, wordIds: r.wordIds, band };
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
      themed: scheduled.units.length,
      core: scheduled.stats.core,
      auto: units.length - scheduled.units.length,
      withNote: units.filter((u) => u.note).length,
      sizes,
      steps: stepTotals,
      order: scheduled.order, // the new global introduction order over the early bands
    },
  };
}
