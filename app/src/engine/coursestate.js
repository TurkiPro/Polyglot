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
import { parseCardId } from './deck.js';

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
  const { cleared, gold } = clearedSets(practiceEvents);
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
    return {
      ...unit,
      steps,
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

  return {
    rows,
    currentId: current?.unitId ?? null,
    current,
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
