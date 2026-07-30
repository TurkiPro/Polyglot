/**
 * Course progress (Phase 9 §3–4), derived — never stored.
 *
 * Like everything else in the engine, a unit's status is a pure function of the event
 * streams: which words the review log has introduced, and which units the practice log's
 * checkpoints have cleared. No course state is persisted, so import and sync can never leave
 * the path disagreeing with history.
 *
 * Language-agnostic; it reads card states and ids, nothing zh-specific.
 */
import { config } from '../../../config/app.config.js';
import { parseCardId } from './deck.js';
import { lessonSpans, lessonState } from './lessons.js';

/** Words the learner has actually met — their REC card has been graded at least once. */
export function introducedSet(states) {
  const set = new Set();
  for (const [cardId, state] of states) {
    if (cardId.endsWith('#REC') && (state.reps ?? 0) > 0) {
      set.add(state.wordId ?? parseCardId(cardId).wordId);
    }
  }
  return set;
}

/**
 * The same "introduced" set, read straight from the raw event log (Phase 10 A3).
 *
 * A word is introduced the moment its REC card is graded, so a single REC event proves it —
 * no replay needed. This lets `courseProgress` be a pure function of the two streams, which is
 * what the replay-determinism suite splices practice events through.
 */
export function introducedFromEvents(events) {
  const set = new Set();
  for (const event of events ?? []) {
    const id = event.cardId;
    if (typeof id === 'string' && id.endsWith('#REC')) set.add(id.slice(0, id.lastIndexOf('#')));
  }
  return set;
}

/** A unit's headline status, for the tiles: gold/cleared/checkpoint/started/locked. */
function unitHeadline(unit, count, total, cleared, gold) {
  if (gold.has(unit.id)) return 'gold';
  if (cleared.has(unit.id)) return 'cleared';
  if (total > 0 && count === total) return 'checkpoint'; // all met, awaiting its quiz
  if (count > 0) return 'started';
  return 'locked';
}

/**
 * The whole course, resolved to per-step states, per-unit %, and an overall % (Phase 10 A3).
 *
 * A pure function of the two streams — the review log (which words are introduced) and the
 * practice log (which units are cleared/gold) — so it is derived, never stored, and survives
 * export → wipe → import and sync. The syllabus rail, the Home CTA, and the checkpoint gate all
 * read this one function; nothing computes course position anywhere else.
 *
 * Step states walk a single frontier — the furthest anchor (a WORD introduced, or a CHECKPOINT
 * cleared) the learner has provably reached:
 *   - `done`     — a passed step (an introduced word, a cleared checkpoint, or any transient
 *                  phrase/practice behind the frontier)
 *   - `current`  — the first not-done step ahead of the frontier that can be acted on
 *   - `skipped`  — a not-done step jumped past (behind current), a quiet state, not a shame one
 *   - `locked`   — only a checkpoint whose unit words aren't all introduced yet
 *   - `upcoming` — everything else ahead
 *
 * @param {object} deck the deck (accepted for symmetry with the streams; membership is the pack's)
 * @param {{ units: object[] }} course
 * @param {object[]} events review events (REC grades = introductions)
 * @param {object[]} practiceEvents checkpoint results
 */
export function courseProgress(deck, course, events, practiceEvents) {
  const units = course?.units ?? [];
  const introduced = introducedFromEvents(events);
  // Direct clears (a checkpoint event for THIS unit id) plus grandfathered ones — a new unit
  // whose words already carry QUIZ_PASS-equivalent practice evidence counts cleared, so the
  // Phase 11 §2 re-org (which changed unit ids and membership) devalues nobody's history.
  const direct = clearedSets(practiceEvents);
  const grand = grandfatheredClears(units, practiceEvents);
  const cleared = new Set([...direct.cleared, ...grand.cleared]);
  const gold = new Set([...direct.gold, ...grand.gold]);
  const allWordsIn = (unit) => unit.wordIds.every((id) => introduced.has(id));

  // Flatten every step so the frontier is a single pass across the whole course.
  const flat = [];
  for (const unit of units) (unit.steps ?? []).forEach((step) => flat.push({ unit, step }));

  const anchorDone = ({ unit, step }) =>
    step.kind === 'WORD' ? introduced.has(step.wordId)
      : step.kind === 'CHECKPOINT' ? cleared.has(unit.id)
        : null; // phrase / practice are transient

  let frontier = -1;
  flat.forEach((entry, idx) => { if (anchorDone(entry) === true) frontier = idx; });

  const done = flat.map((entry, idx) => {
    const a = anchorDone(entry);
    return a === null ? idx <= frontier : a; // transient steps are done once behind the frontier
  });

  const lockable = ({ unit, step }) => step.kind === 'CHECKPOINT' && !allWordsIn(unit);
  let currentIndex = -1;
  for (let idx = frontier + 1; idx < flat.length; idx += 1) {
    if (!done[idx] && !lockable(flat[idx])) { currentIndex = idx; break; }
  }

  const stateAt = (idx) => {
    if (done[idx]) return 'done';
    if (lockable(flat[idx])) return 'locked';
    if (idx === currentIndex) return 'current';
    if (currentIndex === -1 || idx < currentIndex) return 'skipped';
    return 'upcoming';
  };

  // Re-group the flat states back onto their units.
  let cursor = 0;
  let doneSteps = 0;
  const rows = units.map((unit) => {
    const steps = (unit.steps ?? []).map((step) => {
      const state = stateAt(cursor);
      cursor += 1;
      if (state === 'done') doneSteps += 1;
      return { ...step, state };
    });
    const count = unit.wordIds.filter((id) => introduced.has(id)).length;
    const stepDone = steps.filter((s) => s.state === 'done').length;

    // §12: the sittings the syllabus lists. A pure fold over step states already computed —
    // no second frontier pass, and purely additive to the row contract.
    const lessons = lessonSpans(unit).map((span) => {
      const mine = steps.slice(span.from, span.to);
      const finished = mine.filter((s) => s.state === 'done').length;
      const words = mine.filter((s) => s.kind === 'WORD');
      return {
        ...span,
        steps: mine,
        state: lessonState(mine),
        wordIds: words.map((s) => s.wordId),
        done: words.filter((s) => s.state === 'done').length,
        total: words.length,
        percent: mine.length ? Math.round((finished / mine.length) * 100) : 0,
      };
    });

    return {
      ...unit,
      steps,
      lessons,
      introduced: count,
      total: unit.wordIds.length,
      stepDone,
      stepTotal: steps.length,
      percent: steps.length ? Math.round((stepDone / steps.length) * 100) : 0,
      status: unitHeadline(unit, count, unit.wordIds.length, cleared, gold),
    };
  });

  // The current step's within-unit index: its flat index minus where its unit starts.
  let current = null;
  if (currentIndex >= 0) {
    const currentUnit = flat[currentIndex].unit;
    let start = 0;
    for (const unit of units) {
      if (unit === currentUnit) break;
      start += (unit.steps ?? []).length;
    }
    current = { unitId: currentUnit.id, index: currentIndex - start };
  }

  // The lesson holding the current step. Deliberately NOT a key on `current`: that object is
  // asserted by exact match in the tests, and its shape is part of the §10 A3 contract.
  const currentRow = current ? rows.find((row) => row.id === current.unitId) : null;
  const currentLesson = currentRow?.lessons.find((l) => l.state === 'current') ?? null;

  return {
    rows,
    currentId: current?.unitId ?? null,
    current,
    currentLessonIndex: currentLesson ? currentLesson.index : -1,
    overall: {
      percent: flat.length ? Math.round((doneSteps / flat.length) * 100) : 0,
      done: doneSteps,
      total: flat.length,
    },
  };
}

/**
 * Cleared and gold units, read from the practice log itself (§4: no stored course state to
 * drift). A passed checkpoint appends a `CHECKPOINT` event, a gold one `CHECKPOINT_GOLD`; both
 * are append-only, so status is monotonic and survives export → wipe → import and sync.
 */
export function clearedSets(practiceEvents) {
  const cleared = new Set();
  const gold = new Set();
  for (const event of practiceEvents ?? []) {
    if (event.type === 'CHECKPOINT' || event.type === 'CHECKPOINT_GOLD') cleared.add(event.unitId);
    if (event.type === 'CHECKPOINT_GOLD') gold.add(event.unitId);
  }
  return { cleared, gold };
}

/**
 * Grandfathered clears (Phase 11 §4): a unit whose words already carry QUIZ_PASS-equivalent
 * practice evidence counts cleared even without a checkpoint event for its (new) id.
 *
 * When §2 re-cut the course, unit ids and membership changed, so a learner's old checkpoint rows
 * no longer name any current unit. Rather than migrate the log (it is append-only), this reads
 * the word-level practice — the per-item exercise results, checkpoint summaries excluded — and
 * clears a new unit when most of its words have been practised at pass-level accuracy. Word/card
 * ids never changed, so that evidence is intact by construction. Pure and monotonic-friendly.
 *
 * @param {{ id: string, wordIds: string[] }[]} units
 * @param {object[]} practiceEvents
 */
export function grandfatheredClears(units, practiceEvents, {
  pass = config.course.quizPass, gold = config.course.quizGold,
} = {}) {
  const byWord = new Map();
  for (const event of practiceEvents ?? []) {
    if (typeof event.type === 'string' && event.type.startsWith('CHECKPOINT')) continue; // summaries, not word evidence
    const tally = byWord.get(event.wordId) ?? { attempts: 0, correct: 0 };
    tally.attempts += 1;
    tally.correct += event.correct ? 1 : 0;
    byWord.set(event.wordId, tally);
  }

  const cleared = new Set();
  const goldSet = new Set();
  for (const unit of units) {
    const words = unit.wordIds ?? [];
    if (!words.length) continue;
    const practiced = words.map((id) => byWord.get(id)).filter(Boolean);
    if (!practiced.length) continue;
    const coverage = practiced.length / words.length;
    const attempts = practiced.reduce((n, t) => n + t.attempts, 0);
    const correct = practiced.reduce((n, t) => n + t.correct, 0);
    const accuracy = attempts ? correct / attempts : 0;
    if (coverage >= pass && accuracy >= pass) {
      cleared.add(unit.id);
      if (accuracy >= gold) goldSet.add(unit.id);
    }
  }
  return { cleared, gold: goldSet };
}

/** How many times this unit's checkpoint has been attempted — seeds a retake's regeneration. */
export function attemptCount(practiceEvents, unitId) {
  return (practiceEvents ?? []).filter(
    (event) => event.unitId === unitId && String(event.type).startsWith('CHECKPOINT'),
  ).length;
}

/** The best checkpoint fraction is not stored; cleared/gold are enough. This just reads them. */
export function unitStatus(rows, unitId) {
  return rows.find((row) => row.id === unitId)?.status ?? 'locked';
}

/** A unit's still-unintroduced words, in the deck's introRank order (its wordIds order). */
export function unintroduced(unit, introduced) {
  return unit.wordIds.filter((id) => !introduced.has(id));
}

/** The words of a unit the learner has met — the pool exercises may draw on. */
export function metWords(unit, introduced) {
  return unit.wordIds.filter((id) => introduced.has(id));
}
