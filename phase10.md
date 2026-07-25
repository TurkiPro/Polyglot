# Phase 10 — The Syllabus (binding)

The course becomes fully legible: a 0-to-100 walkthrough where every step of the whole
journey is visible, not just the next one. Three parts: the syllabus itself (A), the
old onboarding reborn as ordinary course content (B), and design-consistency fixes
from the conformance audit (C). Usual laws: tests first, DECISIONS lines, CLAUDE.md
patches ride the commits, ids and deck bytes untouchable, replay stays the single
source of progress truth.

## A. The Syllabus

### A1. Steps become data — one source for path and runner
`course.zh.json` units gain a generated `steps[]`; the pipeline derives them
deterministically and BOTH the syllabus and the lesson runner consume this one list —
no second sequencing logic anywhere. Step kinds:

- `WORD`   — one word's teach + first practice (unit words in introRank order)
- `PHRASE` — a sentence spotlight: reorder or cloze on a sentence whose every word is
  now known (the "new phrase" beats between words; generated where such a sentence
  exists after each 2–3 words)
- `PRACTICE` — a short mixed exercise set over the unit so far (after every
  LESSON_WORDS words)
- `CHECKPOINT` — the unit quiz, always last

Report gains per-unit step counts. Unit ids and word membership are untouched — this
adds structure, never resequences.

### A2. The syllabus surface
- Desktop (>900px): a persistent left rail on `#course`, `#lesson`, and `#quiz` — the
  full course as a collapsible tree (Unit 0 … Unit N), every step listed with its kind
  icon and state; the current step pinned/highlighted; sticky unit headers; overall
  0–100% at top, per-unit % on each header. The Udemy pattern, in night-market skin
  (tool surface: legible rows, glow only on the current marker).
- Mobile: `#course` IS the syllabus (full-screen tree, same states); inside a lesson,
  a compact header strip — "Unit 4 · step 7 of 18" — tappable to open the tree as a
  sheet.
- States, derived by replay from the event streams (never stored): `done`, `current`
  (first not-done), `skipped`, `upcoming`, `locked` only where a checkpoint's words
  aren't yet introduced.
- Navigation is free: any step is tappable. Jumping ahead past undone steps marks the
  skipped ones `skipped` (a quiet state, not a shame state); word introductions still
  honor the daily cap and ramp exactly as today — the syllabus never becomes a cap
  bypass. Add the test.

### A3. Progress truth
`courseProgress(deck, course, events, practiceEvents)` — pure, in the engine, unit
tested: returns per-step states, per-unit %, overall %. The rail, the Home CTA, and
the checkpoint gating all call it. Extend the replay-determinism suite to cover it.

## B. Unit 0 — "The Sounds" (onboarding, reborn)

The welcome flow died for three stated reasons: forced, half-baked, bad UX. The cure
is not a better modal — it is making onboarding ordinary course content:

- A generated **Unit 0** at the top of the syllabus: tone lessons as steps (the
  existing gym drills, packaged: singles → pairs with 2/3 emphasis), pinyin steps
  (the crash-intro screens as syllabus steps), and a mini-CHECKPOINT. Same runner,
  same UI language, same skip semantics as every other unit — nothing is forced,
  it is simply where the course begins, and skipping it is one tap like anywhere else.
- New accounts: Home's CTA reads "Start the course · Unit 0 — The Sounds". Existing
  accounts see Unit 0 in the tree, marked by their history (tone-gym usage counts
  toward its steps where derivable; otherwise it sits politely done-able).
- The writing-track choice leaves onboarding: it lives in Settings, plus a one-time
  inline prompt the first time a WRITE card would unlock ("Want handwriting practice?
  You can change this in Settings.").
- Retire the old flow: remove the `#welcome` route, `views/welcome.js`, and dead
  auto-flow remnants in `main.js`; `#tones` (the gym) stays, now also linked from
  Unit 0. CLAUDE.md's onboarding section is rewritten to describe Unit 0.

## C. Design-consistency fixes (conformance audit D1–D4)

- **D1** `zh/writer.js:61-63` — cssVar fallbacks are v1's dead palette (`#6ea8fe` et
  al). Fallbacks become the current night-market values, sourced from one exported
  constant beside the theme code so they can't fossilize again.
- **D2** `styles.css` — 11 transition/animation durations hardcoded in ms, bypassing
  `--dur`; they also ignore reduced-motion's zeroing. Every duration becomes `var(--dur)`
  or a multiple via `calc()`; the reduced-motion block zeroes them all. Add the
  contrast-suite-style check: a test greps the stylesheet for `\dms` outside the
  token definitions and fails on any hit.
- **D3** The sanctioned-glow registry drifted: course-path signs (9b/9c) use glow
  legitimately but were never added to the law. Update CLAUDE.md's glow list to the
  actual sanctioned set (hero, done-sign, teach components, tone gym, checkpoint
  clear, course-path current/cleared signs, signboard hover) and assert in a test
  that `--glow` appears in no view files outside that set.
- **D4** Button-variant sprawl: `lesson-leave`, `tone-sample`, `sign`,
  `reorder-tile`, `match-item` ride through the button component as ad-hoc variants.
  The component's variant set becomes closed (`btn-primary`, `btn-quiet`, size/width
  modifiers); feature-specific styling moves to wrapper classes on the container.
  Pure refactor — zero visual change intended; eyeball each surface after.

## Acceptance
Machine: steps[] deterministic and id-stable; `courseProgress` unit + replay-extended
tests; skip-marking and cap-honoring tests; D2/D3 stylesheet assertions; lint (F4)
green across all of it. Human: the whole course readable top-to-bottom in the rail
with your position obvious at a glance; jumping around feels free, never punished;
Unit 0 reads as the course's beginning, not a gate; a phone user can always answer
"where am I, what's next, how far along am I" in one look. Report per section with
DECISIONS.md lines as usual.