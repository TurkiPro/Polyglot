# Audit fix pack — findings F1–F8 (binding)

From a read-only audit at commit `4755eb8` (443 tests green at baseline). Work
top-down — the order is leverage. Every fix lands with its tests, a DECISIONS.md
line, and the CLAUDE.md patch where noted. Deck bytes and card ids untouchable, as
always. F8 is investigate-first: report before building anything sized M or larger.

## F1 — Account deletion must include practice_events

**Evidence:** `worker/src/api/me.js:29-33` deletes review_events, custom_words,
sessions, users — not `practice_events`. `export.js` includes practice. D1 does not
enforce foreign keys (documented repo lesson), so the rows orphan forever.
**Why:** §1.5 — deletion removes everything. Currently it doesn't.
**Do:** add the delete to the batch. Then add the symmetry test that makes this
class impossible to repeat: enumerate every user-scoped table from `schema.sql` in
the test itself and assert `DELETE /api/me` leaves zero rows in each — a future
table missing from the delete list fails the suite the day its schema lands.
**Accept:** api-tests: create practice events, delete account, count = 0 in every
user-scoped table.

## F2 — Make the reward renderer unable to fail blank

**Evidence:** DECISIONS (home-redesign entry) records `neonIgnite`'s animation
"flickered out intermittently… never reliable" — the 语 hero was removed for it —
yet the same renderer still powers the two most load-bearing moments:
`review.js:118` (nightly hardest-word sign) and `quiz.js:92` (checkpoint clear).
**Why:** an earned reward that sometimes renders as nothing is worse than no reward.
**Do:** root-cause first — likely a lifecycle race (HanziWriter animating into a
node that detaches, or char data resolving after the element left the DOM). Rework
`neonIgnite` to: preload char data BEFORE touching the DOM; verify the target is
connected before starting; and on ANY failure or timeout (~2s) render the static
steady-glow glyph instead — the fallback is a visible character with `--glow-sm`,
never an empty box. Log which path ran at debug level.
**Accept:** jsdom tests: ignite on a detached node → static glyph present; char-data
rejection → static glyph present; happy path unchanged. Manual: ten consecutive
session-done screens, zero blanks.

## F3 — Move the dictionary import off the main thread

**Evidence:** `views/browse.js:30` — `await res.json()` of the full ~120k-entry
CC-CEDICT file, then import, on the main thread at first Browse. Multi-second
freeze on phones at a first-impression moment.
**Do:** a module Web Worker (`app/src/engine/dict-worker.js`) fetches, parses, and
posts entries in batches (~2,000) which the main thread writes to IndexedDB between
frames; Browse shows the existing progress indicator driven by batch messages.
`scripts/build.mjs` gains the second esbuild entry for the worker bundle. CSP is
`default-src 'self'` — same-origin workers are already permitted; verify no CSP
change is needed and say so in DECISIONS.
**Accept:** import completes with the UI interactive throughout (manual: scroll
during import); unit tests for the batch parser; existing search tests unchanged.

## F4 — Add ESLint with the rules that would have caught our bugs

**Evidence:** no linter in devDependencies; the `stage` shadow bug shipped and was
caught only by Windows test ordering (`flipStage` fix in history).
**Do:** `eslint` (flat config) as a dev dependency — approved onto the allowlist by
this document, §4.3 satisfied. Rules: `no-shadow: error`, `no-undef`,
`no-unused-vars`, `eqeqeq`, `no-var`, `prefer-const`; environments for browser,
worker, and node script contexts. `npm run lint`; CI runs it in every job before
tests. Fix what it flags — expect mechanical items only; anything non-mechanical
gets reported, not improvised. CLAUDE.md: §4 gains the lint gate, §6 acceptance
gains the command.
**Accept:** `npm run lint` clean; CI red on an injected shadow (prove once locally,
then remove the probe).


## F5 — Replace the rate-limit cleanup lottery

**Evidence:** `mw/ratelimit.js:48` purges expired rows only when `count === 1 &&
Math.random() < 0.02` — unbounded slow growth between lucky draws.
**Do:** on each window rollover for a key (the existing insert path), delete that
key's expired rows unconditionally — one indexed delete, no lottery, no scheduler.
**Accept:** unit test — after simulating N windows for a key, at most one row for
it remains.

## F6 — Tighten the audio route's filename gate

**Evidence:** `worker/src/index.js:221-225` accepts any flat name; every garbage
request costs an R2 lookup.
**Do:** filenames are content hashes with one extension — enforce
`/^[a-f0-9]{16,64}\.ogg$/` before touching R2. A manifest-membership set was
considered and rejected: bundling ~11k hashes into the worker pushes against the
free-tier size cap for marginal gain; record that in DECISIONS so it isn't
re-proposed.
**Accept:** api-tests: garbage names → 404 with no R2 binding call (assert via a
counting stub in the unit suite); valid manifest names unchanged.

## F7 — Accessibility inventory (investigate first, then fix small items)

**Evidence:** 26 aria/role occurrences across ~12k lines of UI; the custom widgets
(bottom tab bar, grade bar, card flip/reveal, match tiles, quiz choices, dialogs)
predate any a11y pass.
**Do:** inventory those six surfaces for keyboard operability, roles/names/labels,
and focus visibility. Write the findings into DECISIONS. Fix only S-sized items in
this pack (missing `aria-label`s, `role`/`aria-pressed` on toggles, tab-bar
`aria-current`); anything M or larger — focus-trap dialogs, full SR flows for the
flip — comes back as a report for prioritization, not an improvisation.
**Accept:** the inventory exists in DECISIONS; keyboard-only user can navigate
tabs, grade a card, and answer an MCQ; `npm test` green throughout.

---

Recommended order: F1 → F4 → F2 → F3 → F5 → F6 → F7 (F4 early so the linter
guards the later diffs). Report per finding with DECISIONS.md lines as usual.