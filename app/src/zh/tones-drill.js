/**
 * Tone drills (Phase 7 §1.2, §1 "Tone gym").
 *
 * Tone is the thing adult learners most reliably fail to acquire by exposure alone, and
 * the pair 2/3 is the most confusable — so drills over-sample it, and the weighting adapts
 * to the learner's own error history.
 *
 * Pure: no DOM, no audio, no storage. The view plays the syllable and records the answer.
 */

/**
 * The archetype syllable: mā má mǎ mà · ma. One word, five meanings.
 *
 * `simp` is the character so the sample can speak pack audio; the view resolves it to a
 * pack key through the deck (§9). Where the deck has no matching reading — 妈 is only in the
 * deck as 妈妈, and 吗 is catalogued as má not neutral ma — the sample falls back to browser
 * speech rather than playing the wrong tone.
 */
export const ARCHETYPE = Object.freeze([
  { tone: 1, pinyin: 'mā', pinyinNum: 'ma1', gloss: 'mother', simp: '妈' },
  { tone: 2, pinyin: 'má', pinyinNum: 'ma2', gloss: 'hemp', simp: '麻' },
  { tone: 3, pinyin: 'mǎ', pinyinNum: 'ma3', gloss: 'horse', simp: '马' },
  { tone: 4, pinyin: 'mà', pinyinNum: 'ma4', gloss: 'to scold', simp: '骂' },
  { tone: 5, pinyin: 'ma', pinyinNum: 'ma5', gloss: '(question particle)', simp: '吗' },
]);

/** Syllables the drills fall back on when no pack pool is available — toneless in TTS. */
const SYLLABLES = ['ma', 'ba', 'shi', 'yi', 'wen', 'tang', 'shu', 'bao', 'jia', 'qi'];

/**
 * Group single-character deck words that have pack audio by tone, so drills can play a real
 * word spoken with a real tone instead of a toneless synthesised syllable. This is the
 * whole reason the tone gym stopped sounding flat: browser TTS gives every drill the same
 * dead pitch, which for a tone drill teaches nothing.
 *
 * @param {object[]} words deck words
 * @param {(id: string) => boolean} hasAudio whether the pack has audio for a word id
 * @returns {Record<number, Array<{ tone: number, key: string, text: string }>>}
 */
export function buildTonePool(words, hasAudio) {
  const pool = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const word of words ?? []) {
    if (!word?.simp || [...word.simp].length !== 1) continue;
    if (typeof hasAudio === 'function' && !hasAudio(word.id)) continue;
    const tone = String(word.pinyinNum ?? '').match(/([1-5])$/)?.[1];
    if (tone) pool[+tone].push({ tone: +tone, key: word.id, text: word.simp });
  }
  return pool;
}

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
 * One drill syllable for a tone: drawn from the pack pool when one is given (a real word,
 * with a `key` the view resolves to pack audio), else a toneless fallback syllable.
 */
function pickSyllable(tone, pool, random) {
  const bucket = pool?.[tone];
  if (bucket && bucket.length) {
    const item = bucket[Math.floor(random() * bucket.length)];
    return { tone, key: item.key, text: item.text };
  }
  const syllable = SYLLABLES[Math.floor(random() * SYLLABLES.length)];
  return { tone, text: syllable, pinyinNum: `${syllable}${tone}` };
}

/**
 * Build a drill set.
 *
 * @param {{ size?: number, pairs?: boolean, stats?: object, pool?: object, random?: () => number }} options
 *   `pool` is `buildTonePool`'s output; without it, drills use toneless fallback syllables.
 * @returns {Array<{ syllables: Array<{ tone: number, key?: string, text: string }>, answer: number[] }>}
 */
export function buildDrillSet({ size = 10, pairs = false, stats = null, pool = null, random = Math.random } = {}) {
  const weights = toneWeights(stats);
  const drills = [];

  for (let i = 0; i < size; i++) {
    const count = pairs ? 2 : 1;
    const syllables = [];

    for (let n = 0; n < count; n++) {
      const tone = weightedTone(weights, random);
      syllables.push(pickSyllable(tone, pool, random));
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
