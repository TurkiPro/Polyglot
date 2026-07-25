# Phase 11 — Curriculum coherence (binding)

Two defects: topics.json mis-tags pollute the dictionary and the unit titler
(telephone among numbers), and units are introRank slices wearing topical titles they
don't earn ("Numbers & time" opening with 男, 男朋友). The fix: honest tags, then
theme-FIRST units scheduled under dependency constraints, with the pedagogical price
measured, capped, and reported. Card ids and deck words untouchable; course ids/
membership WILL change — progress is grandfathered (§4). Work the sections in order.

## 1. topics.json quality pass

- Diagnose the current tagger first: reproduce how 电话 landed in numbers (suspected
  definition-substring matching — "phone number"). Record the mechanism in DECISIONS.
- Re-tag with rules, not raw substrings: match on definition head terms; a trap list
  of known poison substrings ("number" inside "phone number", "time" inside
  "sometimes", etc. — grow it from what the report surfaces); a word's home topic is
  single (the strongest match); secondary topics allowed for Browse only.
- Function/structure words (particles, copulas, measure words, pronouns,
  conjunctions) are explicitly topic-less: they belong to CORE (see §2).
- `orderedTopics` addition: topics with inherent order carry an explicit sequence —
  numbers by value (一 二 三 … 十 百 千 万), weekdays and months by calendar, time
  words by scale. Browse and unit-internal display honor it.
- Report: full per-topic word lists for bands 1–2 plus every changed tag, formatted
  for a human skim. THE MAINTAINER REVIEWS THIS LIST before §2 builds on it — his
  eyeball caught both original defects; it is the acceptance instrument here.

## 2. Theme-first units under dependency constraints

Replace the slice-then-title generator with a scheduler:

- **State:** the known-set (starts with seedOrder), per-topic pools of unintroduced
  words, and the CORE pool.
- **Ready** = a word whose intro sentence (best available against the CURRENT order)
  is ≥ N+1 clean, or that has no sentence dependency.
- **Loop:** open a unit for the topic with the most ready words (ties: lower average
  band, then frequency). Fill it with that topic's ready words in dependency order,
  re-evaluating readiness as each lands, up to UNIT_SIZE; close early when the
  topic's ready pool dries (short units are fine — coherence beats padding). Return
  to a topic in later units as more of it becomes ready ("Numbers 2" now means MORE
  NUMBERS, nothing else).
- **CORE units:** interleaved automatically — a core word's priority is demand (how
  many near-future sentences/words it unblocks); when accumulated demand crosses a
  threshold, emit a short "Core words" unit. These are the connective-tissue lessons
  and are titled as such; no topical costume.
- **Unit membership is now literal:** every word in "Numbers & time" IS a numbers-or-
  time word. The dominant-topic titler is deleted, not improved.
- Bands 4+ keep today's spine-ordered auto-units — coherence effort goes where the
  learner lives.

## 3. The measured trade-off

Re-run intro-sentence attachment against the new global order and emit, in the build
report, side-by-side with the old numbers: clean-n+1 %, relaxed %, bare % for bands
1–3. Floors: band 1 clean-n+1 ≥ 80%, bands 1–3 ≥ 75%. Below floor, raise the new
config knob `TOPIC_COHESION` mechanics (allow the scheduler to defer a topic's
stragglers further / interleave core earlier) and rebuild until floors hold. Paste
the before/after table into DECISIONS — the price of coherence gets paid in public.

## 4. Progress grandfathering

Unit ids and membership change; nobody's history may be devalued:
- Word-level everything (FSRS state, introductions, practice) is keyed to word/card
  ids — untouched by construction.
- Unit clears re-derive: a NEW unit counts cleared when the learner's practice
  history over ITS words meets QUIZ_PASS-equivalent evidence; GOLD likewise for
  medallions. Implemented inside `courseProgress` (pure, tested), not as a stored
  migration. Old unitId practice rows remain in the log untouched (append-only law).
- Add the test: a synthetic history that cleared old-u07 yields cleared state on the
  new unit(s) covering those same words.

## 5. Dictionary surfaces

Browse topic lists consume the re-tagged topics.json; within a topic: orderedTopics
sequence where defined, else band → frequency. The 八-then-电话 class becomes
impossible because 电话 is no longer a number and 八 sorts by value.

## Acceptance

Machine: scheduler determinism (same inputs ⇒ identical course), readiness/cohesion
unit tests, floors enforced in the build, grandfather tests, id-stability assertion
extended to fail on any deck-word change. Human — the instrument that caught both
bugs: the maintainer reads the §1 report (bands 1–2 topic lists) AND walks the first
eight units of the new syllabus start to finish; every unit's words must belong to
its name, numbers must count in order, and 男朋友 must live among people, where he
does. Report per section with DECISIONS.md lines as usual.