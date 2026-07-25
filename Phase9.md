# Phase 9 — The Course (binding)

polyglot gains a guided curriculum: units, lessons, varied exercises, and checkpoint
quizzes, layered ON TOP of the SRS — never replacing it. The evidence stance from the
Learn Mode research holds: free-recall retrieval on the FSRS schedule is the retention
engine; the course is the structured, motivating path that INTRODUCES words and adds
varied practice. Deliver in three reviewable stages (9a → 9b → 9c), tests first,
CLAUDE.md patches with each commit, card ids untouchable as always.

## 0. Config additions (§0 patch)

```
UNIT_SIZE            = 22        # words per unit (±3 to land on topic seams)
COURSE_BANDS         = 1,2,3     # authored course; bands 4+ auto-generate plain units
LESSON_WORDS         = 6         # new words introduced per lesson sitting
QUIZ_PASS            = 0.80      # unit clear threshold
QUIZ_GOLD            = 0.95      # medallion threshold
QUIZ_LENGTH          = 12        # items per checkpoint, mixed types
MCQ_CHOICES          = 4
```

## 1. Data — `packs/zh/course.zh.json` (pipeline, 9a)

Units are slices of the EXISTING introRank order (the n+1 spine stays the sequencer),
sized UNIT_SIZE, with seams nudged ±3 words to keep topics.json clusters together.
Per unit: `{ id: "u07", title, wordIds[], note?, band }`.

- **Titles**: generated draft from the unit's dominant topics ("Family & people",
  "Numbers & time"), overridable in a committed `packs/zh/course-overrides.json` —
  same reviewable-data pattern as topics.json. Report lists every unit with its title
  and word count for the maintainer's skim.
- **`note`** (optional, ≤1 sentence): a pattern observation for units whose sentences
  showcase one ("了 after a verb marks a completed action"). You draft ~45 of these as
  reviewable data; genuinely pattern-less units get none. This is the entire extent of
  grammar authoring — no lessons, no expansion, the old scope law stands.
- Bands 4+: auto-units titled by number only ("Band 5 · Unit 12") — the open road.
- Determinism: same inputs ⇒ byte-identical course file; id-stability assertion
  extends to unit ids once shipped.

## 2. Exercise engine (9a) — `app/src/engine/exercises.js`, headless, pure

Six exercise types, each a pure generator `(words, deck, rng) → item` and a pure
grader. Distractors are drawn deterministically by similarity — same band, shared
component, similar pinyin, or same tone pattern — because confusable options are where
the interleaving evidence says the learning is:

1. **MATCH** — 5 pairs, hanzi↔meaning or hanzi↔pinyin or audio↔hanzi (tap to pair).
2. **MCQ_MEANING** — see the character, pick the meaning (MCQ_CHOICES options).
3. **MCQ_AUDIO** — hear the word (pack audio), pick the hanzi.
4. **TYPE_PINYIN** — see hanzi + meaning, type the pinyin (reuses the PROD normalizer
   verbatim — do not fork it).
5. **REORDER** — the word tiles of a known intro sentence, shuffled; arrange them.
   Only sentences whose every word is introduced qualify.
6. **CLOZE** — an intro sentence with the target word blanked; pick or type it.

Every item gives immediate feedback with the correct answer (the >75% retrieval-success
sweet spot is engineered by drawing quiz words from material the learner has met).
Seeded RNG so a given quiz attempt is reproducible in tests.

**The scheduler firewall (binding):** exercise results log to a NEW append-only
`practice_events` stream — `{ id, unitId, type, wordId, correct, ts }` — synced with
the same cursor pattern as review_events (new D1 table + mirrored endpoints, 9a). They
feed XP, mastery, and adaptivity. They NEVER touch FSRS state: cued recognition (MCQ,
matching) is easier than free recall, and grading the scheduler on it inflates
stability and quietly rots retention. Log the rationale in DECISIONS; it will be
questioned forever.

## 3. Lessons and the path (9b)

- Route `#course`: the unit path as a stage surface — the Browse-signboard language,
  units as neon signs lighting up as they clear, current unit prominent. Replaces the
  bare "Start review" as the Home CTA for accounts with an unfinished course
  ("Continue · Unit 7 — Family & people"); Reviews keep their own equal CTA.
- Route `#lesson/:unit`: a lesson sitting = teach screens for the next LESSON_WORDS
  unintroduced words (existing Phase 7 teach flow, unchanged) interleaved with 2–3
  exercises over words met so far. Introducing words here counts against the daily
  new-card cap and ramp — the course paces THROUGH the evidence-based limits, never
  around them; when the cap is spent, the lesson says so warmly and offers exercises
  or reviews instead.
- A unit's words all introduced ⇒ its checkpoint unlocks.

## 4. Checkpoints and mastery (9c)

- Route `#quiz/:unit`: QUIZ_LENGTH items, mixed types weighted toward the unit's
  weakest words (from practice_events + review history). No timer — speed pressure has
  no evidence and plenty of anxiety.
- Score ≥ QUIZ_PASS clears the unit (path sign ignites — reuse `neonIgnite`);
  ≥ QUIZ_GOLD earns the unit's medallion. Best score kept; retakes unlimited and
  regenerate items from the seed + attempt count.
- Band completion = existing band-clear badge, now awarded at the path milestone
  moment with the arcade treatment.
- Mastery, like everything, derives from the event streams via replay — no stored
  course state that can drift; extend `rebuildFromEvents`'s determinism test to cover
  practice_events.

## 5. What this deliberately is not

No AI-generated exercises at runtime (generators are deterministic data transforms).
No hearts/lives/streak-freezes/paywall theatre. No speaking assessment (browser mics
+ tone grading is a research project, not a phase). No grammar course — six exercise
types over n+1 sentences ARE the grammar instruction, per the comprehensible-input
evidence.

## 6. Acceptance

Machine: generators/graders unit-tested incl. distractor determinism and seeded
reproducibility; firewall test proves a practice_event never mutates FSRS state;
course.json validates (every word in exactly one unit, unit sizes within bounds);
sync round-trip for practice_events; replay determinism extended. Human: fresh guest
walks Unit 1 start-to-medallion — teach, exercises, checkpoint, sign ignition — and
day one reads as "begin the course", not "here is a queue"; the daily cap interrupts
a lesson gracefully; a cleared unit survives export → wipe → import. Report per stage
with DECISIONS.md lines as usual.