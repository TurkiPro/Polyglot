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
  } = options;
  const topics = topicsFile.topics ?? {};
  const labels = topicsFile.labels ?? {};
  const topicOrder = Object.keys(topics);
  const index = topicIndex(topics);
  const topicsOf = (id) => index.get(id) ?? new Set();

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
    units.push(unit);
  }

  return {
    units,
    stats: {
      units: units.length,
      authored: units.filter((u) => u.band <= maxAuthored).length,
      withNote: units.filter((u) => u.note).length,
      sizes: { min: Math.min(...units.map((u) => u.wordIds.length)), max: Math.max(...units.map((u) => u.wordIds.length)) },
    },
  };
}
