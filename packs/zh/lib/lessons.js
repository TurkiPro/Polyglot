/**
 * Lessons — a unit's words cut into sittings (Phase 12).
 *
 * A unit is a theme (~22 words); a LESSON is one sitting inside it (~LESSON_WORDS words), and it
 * is what the syllabus lists and the runner runs. Before this, the tree listed every step, so a
 * 22-word unit was ~29 rows and each "lesson" was a single card — 16,002 rows across the course.
 *
 * Cutting is semantic first, mechanical second. An authored group in `lessons.json` ("Counting to
 * ten": 零一二三四五六七八九十) is taken WHOLE, because counting split across two sittings is not
 * counting; everything else falls into `target`-sized chunks. Respected courses cut the same way:
 * HSK Standard Course 1 is 15 lessons over 150 words, each a single situation.
 *
 * Pure and deterministic: same words + same groups ⇒ identical lessons.
 */

/** How far past `target` an authored group may run before it is chunked anyway. */
const OVERRUN = 3;

/** Fewest members that must land in a unit for a group to name a lesson there. */
const MIN_MEMBERS = 2;

/**
 * Index authored groups by the word ids they name, so a unit can be asked "does a group start
 * here, and is all of it present?" without rescanning the file.
 *
 * @param {{ groups?: { title: string, words: string[] }[] }} file  `lessons.json`
 * @param {Map<string, object>} bySimp deck words by spelling
 * @returns {{ groups: { title: string, wordIds: string[] }[], unresolved: string[] }}
 */
export function indexGroups(file, bySimp) {
  const unresolved = [];
  const groups = [];
  for (const group of file?.groups ?? []) {
    const wordIds = [];
    for (const simp of group.words ?? []) {
      const word = bySimp.get(simp);
      if (word) wordIds.push(word.id);
      else unresolved.push(`${group.title}:${simp}`);
    }
    if (wordIds.length) groups.push({ title: group.title, wordIds });
  }
  return { groups, unresolved };
}

/**
 * Cut one unit's words into lessons.
 *
 * A group applies to whatever members land in this unit. Units are cut by readiness, so a semantic
 * group often straddles a boundary (the six family words arrive across two units); refusing it
 * outright would throw away the grouping entirely, so a partial group still names its lesson — the
 * syllabus already numbers recurring titles, so it reads "Immediate family 1 / 2". A group needs
 * `MIN_MEMBERS` here to claim a title, so one stray word never names a lesson after its siblings.
 *
 * Applied groups keep the unit's own word order and never move a word across units, so the global
 * introduction order — and the §3 floors measured over it — is untouched.
 *
 * @param {string[]} wordIds the unit's words, in course order
 * @param {{ title: string, wordIds: string[] }[]} groups authored groups (from `indexGroups`)
 * @param {{ target: number }} opts
 * @returns {{ lessons: { title?: string, wordIds: string[] }[], split: string[] }}
 */
export function planLessons(wordIds, groups, { target }) {
  const present = new Set(wordIds);
  const split = [];

  const claimed = new Map(); // wordId -> group
  for (const group of groups) {
    const inside = group.wordIds.filter((id) => present.has(id));
    if (inside.length < MIN_MEMBERS) continue; // too little of it here to be worth a name
    if (inside.length > target + OVERRUN) continue; // would make a monster lesson
    if (inside.length < group.wordIds.length) split.push(group.title);
    for (const id of inside) claimed.set(id, group);
  }

  // Build each lesson whole, then order lessons by where they start. Extracting a group in place
  // would strand the words around it as one- and two-word fragments — the very "one card per
  // lesson" problem this exists to end. Gathering first keeps every lesson contiguous. Words move
  // only WITHIN their unit, so the course order is preserved at unit granularity; the §3 floors
  // are re-measured over the emitted order to price whatever the reshuffle costs.
  const built = [];
  const seen = new Set();

  for (const id of wordIds) {
    const group = claimed.get(id);
    if (!group || seen.has(id)) continue;
    const members = wordIds.filter((w) => claimed.get(w) === group);
    members.forEach((w) => seen.add(w));
    built.push({ at: wordIds.indexOf(members[0]), title: group.title, wordIds: members });
  }

  // Everything unclaimed, in the unit's own order, chunked at the target.
  const leftovers = wordIds.filter((id) => !claimed.has(id));
  for (let i = 0; i < leftovers.length; i += target) {
    const chunk = leftovers.slice(i, i + target);
    built.push({ at: wordIds.indexOf(chunk[0]), wordIds: chunk });
  }

  built.sort((a, b) => a.at - b.at);
  const lessons = built.map(({ at, ...lesson }) => lesson);

  return { lessons, split };
}
