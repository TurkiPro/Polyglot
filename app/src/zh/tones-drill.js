/**
 * Tone drills (Phase 7 §1.2, §1 "Tone gym").
 *
 * Tone is the thing adult learners most reliably fail to acquire by exposure alone, and
 * the pair 2/3 is the most confusable — so drills over-sample it, and the weighting adapts
 * to the learner's own error history.
 *
 * Pure: no DOM, no audio, no storage. The view plays the syllable and records the answer.
 */

/** The archetype syllable: mā má mǎ mà · ma. One word, five meanings. */
export const ARCHETYPE = Object.freeze([
  { tone: 1, pinyin: 'mā', pinyinNum: 'ma1', gloss: 'mother' },
  { tone: 2, pinyin: 'má', pinyinNum: 'ma2', gloss: 'hemp' },
  { tone: 3, pinyin: 'mǎ', pinyinNum: 'ma3', gloss: 'horse' },
  { tone: 4, pinyin: 'mà', pinyinNum: 'ma4', gloss: 'to scold' },
  { tone: 5, pinyin: 'ma', pinyinNum: 'ma5', gloss: '(question particle)' },
]);

/** Syllables the drills draw on — common, and unambiguous to hear. */
const SYLLABLES = ['ma', 'ba', 'shi', 'yi', 'wen', 'tang', 'shu', 'bao', 'jia', 'qi'];

/** Tones 2 and 3 are the pair adult learners confuse most; they get extra weight. */
const HARD_PAIR = [2, 3];
const BASE_WEIGHT = 1;
const HARD_WEIGHT = 2;

/**
 * Weight each tone by how much this learner needs it.
 *
 * Base weighting already favours 2 and 3; an error history on top of that pushes further
 * toward whatever the learner is actually getting wrong.
 *
 * @param {object|null} stats `store.toneStats`
 * @returns {Map<number, number>}
 */
export function toneWeights(stats) {
  const weights = new Map();

  for (const tone of [1, 2, 3, 4, 5]) {
    let weight = HARD_PAIR.includes(tone) ? HARD_WEIGHT : BASE_WEIGHT;

    const seen = stats?.byTone?.[tone];
    if (seen && seen.attempts >= 4) {
      // Accuracy 1.0 → no extra weight; 0.0 → double. Getting it right stops drilling it.
      const accuracy = seen.correct / seen.attempts;
      weight *= 1 + (1 - accuracy);
    }

    weights.set(tone, weight);
  }

  return weights;
}

/** Pick one tone, honouring the weights. `random` is injectable so tests are stable. */
export function weightedTone(weights, random = Math.random) {
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;
  for (const [tone, weight] of weights) {
    roll -= weight;
    if (roll <= 0) return tone;
  }
  return [...weights.keys()].at(-1);
}

/**
 * Build a drill set.
 *
 * @param {{ size?: number, pairs?: boolean, stats?: object, random?: () => number }} options
 * @returns {Array<{ syllables: Array<{ syllable: string, tone: number }>, answer: number[] }>}
 */
export function buildDrillSet({ size = 10, pairs = false, stats = null, random = Math.random } = {}) {
  const weights = toneWeights(stats);
  const drills = [];

  for (let i = 0; i < size; i++) {
    const count = pairs ? 2 : 1;
    const syllables = [];

    for (let n = 0; n < count; n++) {
      const tone = weightedTone(weights, random);
      const syllable = SYLLABLES[Math.floor(random() * SYLLABLES.length)];
      syllables.push({ syllable, tone, pinyinNum: `${syllable}${tone}` });
    }

    drills.push({ syllables, answer: syllables.map((s) => s.tone) });
  }

  return drills;
}

/** Did the learner's choice match? Compared as a sequence, so pairs need both. */
export const isCorrect = (drill, chosen) =>
  drill.answer.length === chosen.length && drill.answer.every((tone, i) => tone === chosen[i]);

/** Accuracy per tone, for the results screen. */
export function summarize(stats) {
  if (!stats?.attempts) return null;
  const perTone = [1, 2, 3, 4, 5].map((tone) => {
    const seen = stats.byTone?.[tone];
    return {
      tone,
      attempts: seen?.attempts ?? 0,
      accuracy: seen?.attempts ? seen.correct / seen.attempts : null,
    };
  });
  return { attempts: stats.attempts, accuracy: stats.correct / stats.attempts, perTone };
}
