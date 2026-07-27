/**
 * Theme-first unit scheduler (Phase 11 §2).
 *
 * The Phase-9 course sliced the introRank spine into 22-word units and titled each by its
 * dominant topic, so a "Numbers" unit opened with 好玩儿 and the cardinals scattered across
 * unrelated units. This replaces that with a scheduler whose unit membership is LITERAL: every
 * word in "Numbers" is a number.
 *
 * It walks a growing known-set (seeded with the bootstrap vocabulary) and, each round, opens a
 * unit for the topic with the most READY words — a word is ready when one of its intro sentences
 * has every other word already known (n+1 clean), or it has no sentence dependency. Function
 * words carry no topic; they are introduced in short "Core words" units whenever their DEMAND
 * (how many topic words they would unblock) is highest. Topics are returned to in later units as
 * more of them ripens — "Numbers 2" then means more numbers, nothing else.
 *
 * Pure and deterministic: same words + rules ⇒ identical schedule. `intro.js`'s segmenter is
 * reused so readiness is read exactly as the deck's n+1 pass reads it.
 */
import { segment } from './intro.js';

/** How far readiness relaxes (extra unknowns tolerated) when a topic would otherwise stall. */
const RELAX_MAX = 1;

/**
 * Schedule theme-first units over `scope` (the early-band words), using the full deck as the
 * segmentation vocabulary.
 *
 * @param {object[]} scope words to schedule (bands ≤ course bands), each `id/simp/band/introRank/sentences`
 * @param {object[]} allWords the whole deck, for the segmenter's vocabulary
 * @param {{ home: Record<string,string>, core: Set<string>|string[], seedOrder?: string[],
 *   unitSize: number, cohesion: number, orderedTopics?: Record<string,string[]> }} opts
 * @returns {{ units: { topic: string, wordIds: string[] }[], order: string[], stats: object }}
 */
export function scheduleUnits(scope, allWords, {
  home, core, seedOrder = [], unitSize, cohesion, orderedTopics = {},
}) {
  const coreSet = new Set(core);
  const vocab = new Set(allWords.map((w) => w.simp));
  const maxLen = allWords.reduce((m, w) => Math.max(m, [...w.simp].length), 1);

  const known = new Set();
  const introduced = new Set();

  // Pools: one per topic (home), plus the core pool. Ordered topics sort by their sequence,
  // the rest by band then introRank (a frequency proxy), so a unit fills in a sensible order.
  const seqRank = (topic) => {
    const seq = orderedTopics[topic];
    if (!seq) return null;
    const m = new Map(seq.map((s, i) => [s, i]));
    return (w) => m.get(w.simp) ?? seq.length;
  };
  const topicPools = new Map();
  const corePool = [];
  for (const w of scope) {
    if (coreSet.has(w.id)) { corePool.push(w); continue; }
    const t = home[w.id];
    if (!t) { corePool.push(w); continue; } // an unmapped early word rides with the core
    if (!topicPools.has(t)) topicPools.set(t, []);
    topicPools.get(t).push(w);
  }
  for (const [t, arr] of topicPools) {
    const rank = seqRank(t);
    arr.sort((a, b) => (rank ? rank(a) - rank(b) : 0) || a.band - b.band || a.introRank - b.introRank);
  }
  corePool.sort((a, b) => a.band - b.band || a.introRank - b.introRank);

  /** A word is ready if one sentence leaves ≤ maxUnknown other words unknown (or it has none). */
  const ready = (w, maxUnknown) => {
    const sentences = w.sentences ?? [];
    if (!sentences.length) return true;
    for (const sentence of sentences) {
      let unknown = 0;
      for (const token of segment(sentence.zh, vocab, maxLen)) {
        if (token === w.simp || known.has(token)) continue;
        if (++unknown > maxUnknown) break;
      }
      if (unknown <= maxUnknown) return true;
    }
    return false;
  };
  const introduce = (w) => { known.add(w.simp); introduced.add(w.id); };
  const drop = (arr, w) => { const i = arr.indexOf(w); if (i >= 0) arr.splice(i, 1); };
  const readyCount = (pool, maxU) => pool.reduce((n, w) => n + (ready(w, maxU) ? 1 : 0), 0);
  const avgBand = (pool) => pool.reduce((s, w) => s + w.band, 0) / (pool.length || 1);
  const isOrdered = (t) => Array.isArray(orderedTopics[t]) && orderedTopics[t].length > 0;

  /** Fill a unit from one topic's pool, in pool order, re-checking readiness as known grows. */
  const fillTopic = (t, maxU) => {
    const pool = topicPools.get(t);
    const taken = [];
    while (taken.length < unitSize) {
      const w = pool.find((x) => ready(x, maxU));
      if (!w) break;
      introduce(w); drop(pool, w); taken.push(w.id);
    }
    return taken;
  };

  /**
   * Open a topic into one or more units. An ORDERED topic (numbers, time) is drained WHOLE in
   * sequence, readiness ignored — a learner counts 一 二 三 …, never a readiness-shuffled subset
   * split across units; that sequence coherence is worth the few relaxed intros §3 measures. A
   * plain topic fills one unit with its ready words. Returns true if any unit was emitted.
   */
  const openTopic = (t, maxU) => {
    if (isOrdered(t)) {
      const pool = topicPools.get(t);
      let emitted = false;
      while (pool.length) {
        const taken = pool.splice(0, unitSize);
        taken.forEach(introduce);
        pushUnit(t, taken.map((w) => w.id));
        emitted = true;
      }
      return emitted;
    }
    const taken = fillTopic(t, maxU);
    if (taken.length) { pushUnit(t, taken); return true; }
    return false;
  };

  const anyTopicWords = () => [...topicPools.values()].some((p) => p.length);

  /** The unknown other-word tokens in a word's easiest sentence (its remaining dependencies). */
  const bestUnknowns = (w) => {
    const sentences = w.sentences ?? [];
    if (!sentences.length) return null; // no dependency
    let best = null;
    for (const sentence of sentences) {
      const unknown = new Set();
      for (const token of segment(sentence.zh, vocab, maxLen)) {
        if (token !== w.simp && !known.has(token)) unknown.add(token);
      }
      if (!best || unknown.size < best.size) best = unknown;
      if (unknown.size === 0) break;
    }
    return best;
  };

  /**
   * Core-word demand: how many pending topic words each not-yet-known token still blocks (it
   * appears among their easiest sentence's unknowns). High-demand function words — 有, 是, 个 —
   * are the connective tissue; introducing them ripens many topic words at once.
   */
  const coreDemand = () => {
    const demand = new Map();
    for (const pool of topicPools.values()) {
      for (const w of pool) {
        const unknown = bestUnknowns(w);
        if (!unknown) continue;
        for (const token of unknown) demand.set(token, (demand.get(token) ?? 0) + 1);
      }
    }
    return demand;
  };

  const units = [];
  const order = [];
  const pushUnit = (topic, wordIds) => { units.push({ topic, wordIds }); order.push(...wordIds); };

  // Bootstrap: the seed words open the course, in their given order, and seed the known-set —
  // they are pre-known for everyone else's readiness, but must still be introduced themselves.
  const seedWords = [];
  const seen = new Set();
  for (const simp of seedOrder) {
    const w = scope.find((x) => x.simp === simp && !seen.has(x.id));
    if (w) { seedWords.push(w); seen.add(w.id); }
  }
  for (const w of seedWords) {
    introduce(w);
    if (coreSet.has(w.id) || !home[w.id]) drop(corePool, w); else drop(topicPools.get(home[w.id]), w);
  }
  for (let i = 0; i < seedWords.length; i += unitSize) {
    pushUnit('core', seedWords.slice(i, i + unitSize).map((w) => w.id));
  }

  let guard = scope.length * 4;
  while (introduced.size < scope.length && guard-- > 0) {
    // No topic words left: batch the remaining core into full units rather than dribbling them
    // out one at a time (the connective-tissue tail, or a degenerate all-core scope).
    if (!anyTopicWords()) {
      while (corePool.length) pushUnit('core', corePool.splice(0, unitSize).map((w) => w.id));
      break;
    }

    // The topic with the most ready words (used by the later fallback tiers too).
    let best = null; let bestReady = 0; let bestBand = Infinity;
    for (const [t, pool] of topicPools) {
      if (!pool.length) continue;
      const rc = readyCount(pool, 0);
      const ab = avgBand(pool);
      if (rc > bestReady || (rc === bestReady && ab < bestBand)) { best = t; bestReady = rc; bestBand = ab; }
    }

    // 1. Open a topic that has reached its gate. A plain topic opens at the cohesion threshold; an
    //    ORDERED topic waits until most of its words have ripened, because it is drained whole in
    //    sequence — opening it late keeps the counting sequence AND most of its intros clean.
    const openGate = (t, pool) => (isOrdered(t) ? Math.max(cohesion, Math.ceil(pool.length * 0.6)) : cohesion);
    let gated = null; let gatedReady = 0; let gatedBand = Infinity;
    for (const [t, pool] of topicPools) {
      const rc = readyCount(pool, 0);
      if (!pool.length || rc < openGate(t, pool)) continue;
      const ab = avgBand(pool);
      if (rc > gatedReady || (rc === gatedReady && ab < gatedBand)) { gated = t; gatedReady = rc; gatedBand = ab; }
    }
    if (gated) {
      if (openTopic(gated, 0)) continue;
    }

    // 2. Core words, most-demanded first, to ripen more topic words.
    const demand = coreDemand();
    const demanded = corePool
      .filter((c) => (demand.get(c.simp) ?? 0) > 0)
      .sort((a, b) => (demand.get(b.simp) - demand.get(a.simp)) || a.band - b.band || a.introRank - b.introRank);
    if (demanded.length) {
      const taken = demanded.slice(0, unitSize);
      for (const c of taken) { introduce(c); drop(corePool, c); }
      pushUnit('core', taken.map((c) => c.id));
      continue;
    }

    // 3. Below cohesion and core cannot help: open the best short topic unit anyway (clean).
    if (best && bestReady >= 1) {
      if (openTopic(best, 0)) continue;
    }

    // 4. Nothing is clean-ready: relax the intro sentence progressively (the coherence price the
    //    build report measures), so a topic's stragglers are still grouped into ITS unit rather
    //    than scattered as singletons. The first relaxation level that opens a topic wins.
    let opened = false;
    for (let maxU = RELAX_MAX; maxU <= 20 && !opened; maxU += 1) {
      let relaxed = null; let relaxedReady = 0; let relaxedBand = Infinity;
      for (const [t, pool] of topicPools) {
        if (!pool.length) continue;
        const rc = readyCount(pool, maxU);
        const ab = avgBand(pool);
        if (rc > relaxedReady || (rc === relaxedReady && ab < relaxedBand)) { relaxed = t; relaxedReady = rc; relaxedBand = ab; }
      }
      if (relaxed) opened = openTopic(relaxed, maxU);
    }
    if (opened) continue;

    // 5. A topic whose words have unusually long sentences: force its remaining pool through as a
    //    unit (bare intros), keeping the theme whole. Pick the largest remaining topic pool.
    let biggest = null;
    for (const [t, pool] of topicPools) if (pool.length && (!biggest || pool.length > topicPools.get(biggest).length)) biggest = t;
    if (biggest) {
      const pool = topicPools.get(biggest);
      const taken = pool.splice(0, unitSize);
      taken.forEach(introduce);
      pushUnit(biggest, taken.map((w) => w.id));
      continue;
    }
    break;
  }

  // Leftover core words that never crossed a demand threshold: final core unit(s).
  while (corePool.length) pushUnit('core', corePool.splice(0, unitSize).map((w) => w.id));

  const stats = {
    units: units.length,
    core: units.filter((u) => u.topic === 'core').length,
    scheduled: introduced.size,
    scope: scope.length,
  };
  return { units, order, stats };
}
