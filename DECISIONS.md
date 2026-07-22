# Decisions

One line per decision made while implementing, per §4.8 of `CLAUDE.md`.

- Phase 0: declarative manifests (`package.json`, `worker/wrangler.toml`,
  `app/manifest.webmanifest`) may restate identity values from §0 because their formats
  require literals; all executable code imports `config/app.config.js` instead.
- Phase 0: added `auth.turnstile.siteKey` (empty placeholder) to the config — §13.4 says
  the public site key lives in config; the secret stays in Wrangler.
- Phase 0: `config/app.config.js` groups §0 values into nested objects rather than flat
  SCREAMING_CASE constants; grouping matches §0's own section headings.
- Phase 1: Tatoeba links come from `per_language/cmn/cmn-eng_links.tsv.bz2` (477 KB)
  instead of `links.tar.bz2` (148 MB) — identical cmn↔eng pairs, no tar to unpack.
- Phase 1: wrote `packs/zh/lib/bunzip2.js` ourselves because the Tatoeba exports are
  bzip2, Node's zlib cannot read it, and §4.3 caps the dependency allowlist. Verified
  byte-identical to `bzip2 1.0.8` on all three real exports and on committed fixtures.
- Phase 1: `app/src/zh/pinyin.js` is the only pinyin implementation; the pipeline's
  `packs/zh/lib/pinyin.js` re-exports it so the deck is built with the code that renders
  it, rather than a copy that can drift.
- Phase 1: a headword with several readings (好 = hǎo/hào) contributes one deck word —
  the reading with the most CC-CEDICT definitions, ties broken by file order.
- Phase 1: HSK list entries carry annotations (`和1` homographs, `没（有）` optional
  parts); each line expands to ordered candidate spellings and the first one CC-CEDICT
  knows wins. Without this, 97 words were dropped and band 1 held only 292 of 300.
- Phase 1: `packVersion` is the build date (`YYYY.MM.DD`), so it moves only when the pack
  is actually rebuilt.
- Phase 1: `packs/zh/overrides.json` holds hand-written deck-word entries merged over the
  generated deck — after HSK resolution so overrides win, before sentences and strokes so
  an added word is finished like a generated one.
- Phase 1: an HSK homograph marker (`别1`/`别2`) does **not** automatically mint a second
  deck word. Of 41 marked spellings only 12 have enough distinct readings to split, and
  assigning readings in marker order is wrong where it matters (`会2` is band 3 "meeting",
  huì, but frequency order hands it kuài "accounting"). Every marked entry and its
  untaught readings are listed in `report.txt`; genuine splits are curated in
  overrides.json. Eight are seeded there (别 为 调 露 过去 打 省 称).
- Phase 1: the `~N` id-collision path is unreachable from HSK resolution — words are
  deduplicated by resolved spelling before ids are assigned. It remains as a guard for
  overrides.
- Phase 1: `altReadings` is display-only data (pinyin + one-line gloss) for card backs;
  no cards, no ids, no scheduling effect. Readings taught as their own deck word are
  excluded so a split reading never repeats on its sibling's card back.
- Phase 1: when a spelling is taught as several words, only the primary reading gets the
  shared example sentences. The sentence index matches on spelling and cannot tell 别 bié
  from 别 biè, so the others get none — and therefore no SENT card (§5.4) — rather than a
  sentence in the wrong reading. Currently 8 words.
- Phase 1: split groups are emitted per §5.4 as `splitGroup` (the sibling ids) plus
  `splitPrimary` on exactly one member — the CC-CEDICT primary reading, which is what
  greedy segmentation assumed and what `speechSynthesis` will actually say. The engine
  gives non-primary members no LIS card and no TTS button. `splitPrimary` is not in §5.4,
  but "non-primary" has to be recorded somewhere and deriving it from the empty sentence
  list would be accidental.
- Phase 1: the four reviewed-and-declined homograph candidates (会 和 喂 乘) live in
  `overrides.json` under `declinedSplits`, each with its reason. `report.txt` prints them
  as DECLINED rather than re-raising them as candidates on every rebuild.
- Phase 2: `enable_fuzz: false` on the FSRS scheduler. Fuzz randomizes intervals, which
  would make `rebuildFromEvents` non-deterministic and break the sync merge (§2). It
  happens to be the ts-fsrs default; we set it explicitly so an upstream default change
  cannot silently corrupt sync.
- Phase 2: `applyEvent(deck, states, event)` is the single definition of what a review
  does. A live session calls it per answer and `rebuildFromEvents` folds it over the log,
  so there is no second implementation to drift from the one sync and import trust.
- Phase 2: `db.js` is the only module that performs IO; queue, replay, srs, deck and
  events take plain objects. That is what lets §8's behaviour be tested headless under
  vitest, where IndexedDB does not exist and the dependency allowlist rules out a fake.
- Phase 2: the grading adapters (PROD normalizer, WRITE mistake mapping) live in `srs.js`
  rather than a new file, keeping the §3 engine listing exact. Local-day helpers live in
  `replay.js` beside bury, which is their only current caller.
- Phase 2: unlocking is one-way — a later lapse does not re-suspend a word's non-REC
  cards, because the learner has already met them. Now written into §5.4 of CLAUDE.md.
- Phase 2: `stateHash` covers the durable scheduling fields plus `suspended`, and
  deliberately **excludes** `buriedUntil`. Bury is derived from the device's local
  midnight, so two devices in different timezones compute different values from the same
  log — legitimately, since bury is ephemeral session state. Had it stayed in the hash,
  the determinism test would pass in one timezone while a real cross-device sync looked
  corrupted the first time someone reviewed while travelling. `HASHED_FIELDS` is exported
  and pinned by a test, including a replay under three timezones.
- Phase 2: `fake-indexeddb` added as a **dev-only** dependency with explicit human
  approval per §4.3, to test `db.js`. It never ships — the runtime dependency list is
  unchanged, so §1.2 and the no-third-party-requests rule are untouched. Writing our own
  IndexedDB fake would have given false confidence: a fake that quietly diverges from the
  real semantics is worse than no test.
- Phase 3: `app/src/store.js` holds the db handle, deck and live card states; views never
  touch `db.js`. It sits beside `main.js` rather than in `engine/`, which stays pure and
  headless-testable.
- Phase 3: `views/card.js` holds the per-mode fronts and backs, split from `review.js`
  (which owns the session loop) to stay under the §4.6 file cap. Same reason,
  `packs/zh/lib/report.js` was split out of `build.mjs`.
- Phase 3: `sw.js` is now a build artifact (`app/src/sw.js` → `app/sw.js`, gitignored like
  `bundle.js`) so it can import §0 values from config instead of restating them. The pack
  version it keys its cache on is injected at build time by `scripts/build.mjs`, because
  packVersion is generated data rather than configuration. `npm run build` therefore runs
  that script instead of a bare esbuild call.
- Phase 3: `jsdom` added as a **dev-only** dependency with explicit human approval per
  §4.3. **Scope**: opted into per file with a `@vitest-environment jsdom` docblock, never
  globally, and used only to assert rendered DOM — logic that can be tested without a
  document stays in a node suite. It never ships; runtime dependencies are unchanged.
  With `fake-indexeddb` it also covers the review loop end to end (store → engine → db),
  which moved the keyboard shortcuts, the §9 front/back table, the split-word audio rule
  and durability-across-reload out of CHECKLIST.md and into assertions.
- Phase 3: icons are human-supplied PNGs (180/192/512, plain and maskable) with the SVG
  kept only as a favicon. PNG is what iOS needs for `apple-touch-icon` and what makes
  installability predictable; the maskable variants inset the glyph into the safe zone.
- Phase 3: event ids come from `uuidv4()` in `events.js`, not `crypto.randomUUID`
  directly. `randomUUID` is `[SecureContext]`, so it is missing over plain HTTP from a
  LAN address — which is how the app gets tested on a phone. `crypto.getRandomValues`
  carries no such restriction, so the v4 is assembled from it when the shortcut is absent.
  Node and localhost both have `randomUUID`, which is why every test passed while grading
  was broken on a real device; both suites now force the fallback path.
- Phase 3: the service worker precaches **only** the app shell and `deck.zh.json`. The
  10 MB dictionary and the 3,087 stroke files are runtime-cached on first use, cache-first
  thereafter. Precaching everything would make first load ~29 MB for every new user.
  Now written into §9 of CLAUDE.md.
- Phase 3.1A: dictionary search scores every entry, then ranks, then truncates.
  Match-then-truncate let the first 50 store-order substring hits decide relevance, so
  "play" returned footballers ("...soccer player Cristiano Ronaldo") above 玩. Scoring
  lives in `app/src/views/search.js`, tested against the real 124k-entry dictionary.
- Phase 3.1A: the proper-noun penalty keys off a **capitalized reading**, not a
  capitalized definition as specified. CC-CEDICT capitalizes the pinyin of proper nouns
  (`C罗` [C Luo2], `加索尔` [Jia1 suo3 er3]) — 20,269 entries — which is exactly the
  footballer signal. Capitalized *defs* (19,409 entries) instead catch classifier
  annotations (`CL:場|场[chang3]`) and glosses like "Chinese opera", which demoted 表演
  "play" and 戏 "drama; play" — the two best answers for the query that prompted the fix.
  Same stated intent, accurate field.
- Phase 3.1A: a typed tone is treated as deliberate — "hao3" scores 好 above 号, which
  tie otherwise once tones are stripped. Not in the spec; without it "hao3" ranked 号
  first on codepoint order alone.
- Phase 3.1A: `deck.lookup(simp, pinyinNum)` is a prebuilt index on `createDeck`, and the
  scan skips it entirely for non-matching entries — building a key string 124k times per
  keystroke cost more than the rest of the scan. 19 ms per query against a 50 ms budget.
- Phase 3.1B: `#words` ("My Words") makes adding a word visible. Adding already worked —
  customWord and cards were created — but nothing listed them and the word queued behind
  curriculum order, so the feature read as broken.
- Phase 3.1B: custom words go to the **front** of the new-card queue, newest first
  (CLAUDE.md §8 patched). Explicit user intent outranks curriculum order;
  NEW_CARDS_PER_DAY still caps the total.
- Phase 3.1B: removing a custom word writes a tombstone (`deleted: 1`) so Phase 6 sync can
  propagate it, deletes its cards, and **leaves its events** — the log is immutable (§2)
  and `rebuildFromEvents` skips events whose word the deck no longer has. Review totals
  therefore survive a removal.
- Phase 3.1B: custom words are flagged `custom: true` at add time rather than inferred
  from `band === 0`; the queue rule and My Words both key off it, and inference would
  quietly capture any future band-0 pack word.
- Phase 3.1C: design tokens replaced per the C spec. Two deviations, both authorised by
  its own "shade within the same family if a pair fails" clause: `--accent` is #cc3b2f
  rather than #e34234 (white-on-accent was 4.12:1, below 4.5 for button labels), and a
  second `--accent-text` (#fa4939) carries accent-coloured *text*, because no single
  vermilion clears 4.5:1 both against white and against the dark background. `--danger`
  moved #d3453f → #cf443e for the same reason (4.47 → 4.62).
- Phase 3.1C: **tone colours still fail contrast** on both themes (t4 2.63:1 on dark,
  t5 2.44:1 on light) and are left unchanged — §0 owns them and the C spec freezes them.
  Recorded in CHECKLIST.md as a decision the maintainer has to make; it predates v2.
- Phase 3.1C: on mobile the tab bar is hidden during review (`data-route="review"`) so
  the grade bar owns the thumb zone. Two fixed bars at the bottom would stack, pushing
  grading out of reach.
- Phase 3.1C: `ui/icons.js` draws six glyphs as inline SVG DOM — no icon library (the
  allowlist holds) and no markup strings (§11's CSP).
- Phase 3.1C: grade buttons preview intervals from ts-fsrs's `repeat()`, which computes
  all four schedules in one pass, so the previews are the same values `gradeCard`
  produces rather than an estimate. A card with no stored state previews from a fresh
  card — which is exactly what grading it would create, and covers most of a first
  session. A jsdom test caught that case rendering no previews at all.
- Phase 3.2 §2: palettes replaced with paper (light, now the default) and night ink.
  Three in-family tunings, per "tune within the hue family only": paper t2 #2f7d3f →
  #2d783c (4.36:1 on paper, under 4.5), night --accent #d64533 → #cd4231 (white-on-accent
  was 4.41), night --danger #e0564a → #c54c41 (white-on was 3.75). Paper --danger is
  #ad3429 rather than #b3362b so a destructive control is not byte-identical to tone 1.
- Phase 3.2 §2: night seal red reads 3.73:1 against the page — that is fine because §1
  restricts it to stamps, CTAs and active states, all UI chrome at 3:1. It is never body
  text, and `tests/contrast.test.js` asserts the chrome bar rather than the text bar.
- Phase 3.2 §2: tone colours are per-theme pairs in config, applied by
  `applyToneColors(theme)`. `ui/theme.js` owns theme switching so `main.js` and
  `settings.js` do not import each other — wiring it through `main.js` created a cycle.
- Phase 3.2 §2: `tests/contrast.test.js` parses the real stylesheet and the real config,
  so a token edit that breaks legibility fails the suite. It asserts the tone variables
  are never *declared* in CSS rather than that their values are unique — paper's t5
  deliberately equals --fg-dim.

