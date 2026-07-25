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
 * A status for every unit and the id of the one to continue.
 *
 * `cleared` / `gold` come from checkpoint results (§4, filled in 9c); until a unit is
 * cleared its status reflects introduction progress. The current unit is simply the earliest
 * one not yet cleared — the path is walked in order.
 *
 * @param {{ id: string, title: string, band: number, note?: string, wordIds: string[] }[]} units
 * @param {{ introduced: Set<string>, cleared?: Set<string>, gold?: Set<string> }} progress
 */
export function courseProgress(units, { introduced, cleared = new Set(), gold = new Set() }) {
  const rows = units.map((unit) => {
    const count = unit.wordIds.filter((id) => introduced.has(id)).length;
    const total = unit.wordIds.length;
    let status;
    if (gold.has(unit.id)) status = 'gold';
    else if (cleared.has(unit.id)) status = 'cleared';
    else if (count === total) status = 'checkpoint'; // all met, awaiting its quiz
    else if (count > 0) status = 'started';
    else status = 'locked';
    return { ...unit, introduced: count, total, status };
  });

  const current = rows.find((r) => r.status !== 'cleared' && r.status !== 'gold') ?? null;
  return { rows, currentId: current?.id ?? null };
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
