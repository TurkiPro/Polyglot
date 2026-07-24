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
- Phase 3.2 §3: `subset-font` added as a **dev-only** dependency (§4.3 approval granted in
  the phase brief) and Noto Serif SC is subset at build time to the 4,558 characters the
  pack uses — deck words, their sentences, and any hanzi baked into `ui/strings.js`.
  887 KB (400) + 915 KB (700) of woff2 from a 24 MB variable source. `variationAxes`
  pins the weight axis, so each file is a static instance. OFL recorded in CREDITS by the
  pipeline; the deck rebuild is byte-identical apart from its timestamp.
- Phase 3.2 §3: the fonts are runtime-cached rather than precached. 1.8 MB at install
  would double the first load, and `font-display: swap` means the app is fully usable
  before they arrive.
- Phase 3.2 §4: lucide icons are vendored as static SVG files under
  `app/assets/icons/ui/`, inlined by `components.icon()` via DOMParser rather than
  innerHTML. Upstream has renamed two of the requested glyphs — `home` is now `house`
  and `bar-chart-3` is now `chart-column`; both are saved under the requested filenames
  so the mapping in `ui/icons.js` reads as specified.
- Phase 3.2 §4: `ui/icons.js` is now only a route/mode → filename mapping; the 3.1
  hand-drawn paths are gone.
- Phase 3.2 §5: the review screen is a sheet — surface, radius, shadow, hairline border —
  with the grade bar as its footer on desktop and fixed in the thumb zone on mobile. The
  tab bar stays visible during review, reversing the 3.1 rule that hid it: §5 puts the
  grade bar "above the tab bar", and 3.2 wins where it contradicts 3.1.
- Phase 3.2 §5: the 田字格 is four dashed rules plus a border — no images, no gradients.
  The diagonals are a full-width rule rotated 45° about the centre at 141.42% width, the
  square's diagonal length.
- Phase 3.2 §5: "23 left" became "7 of 30". The same number framed as progress rather
  than as a backlog.
- Phase 3.2 §5: the SENT target word is underlined in `--grid`, not the accent — seal red
  is reserved for marks, CTAs and active states (§1).
- Phase 3.2 §6: the app-bar active link underlines in ink (`--fg`) while the active tab
  uses seal red, exactly as §6 and §8 specify — the bar is chrome, the tab is a state.
- Phase 3.2 §7: empty screens name an action rather than a lack ("Search the dictionary
  to add your first word"). The My Words test now asserts against `strings` rather than a
  literal, so a copy pass does not break tests that are not about copy.
- Phase 3.3 §1: the flip handler ignores clicks whose target is inside a
  `button, a, input, [data-no-flip]`. "Play again" was bubbling into it and revealing the
  answer. Caught by a failing jsdom test written first; the back-audio case already
  passed but is asserted so the §3 grading guard cannot regress it.
- Phase 3.3 §2: LIS fronts reuse PROD's typed-pinyin control and judge verbatim — same
  normalizer, same contract (§8). An empty answer still reveals and is self-graded, so
  nothing forces typing. REC and SENT are unchanged: their answers are meanings, which no
  normalizer can judge. CLAUDE.md §9's LIS row patched.
- Phase 3.3 §3: the reveal is one flip rather than a stamp — the back no longer carries
  `stamp-in`. Grading is blocked while `session.flipping` is true, so a fast "Space, 3"
  cannot grade a card nobody has seen; that guard is tested directly. The stage height is
  measured from an off-screen clone and transitioned, so the sheet grows rather than
  snaps. `--dur` is read from the stylesheet so motion timing stays in one place.
- Phase 3.3 §3: making the reveal asynchronous broke six existing tests that pressed
  Space and immediately asserted the rating row. They now wait for the turn to finish,
  which is what a person does — the failures were the guard working, not a regression.
- Phase 3.3 §4: "Already in your deck" is replaced by a chip that names which thing the
  word is — "HSK · band N" for curriculum words, "In My Words" with the seal check for
  your own. The model is unchanged; only the language was confusing.
- Phase 3.3 §4: `app/src/zh/defs.js` separates CC-CEDICT glosses from classifier fields.
  Rows show `humanDefs`, the word page renders `classifiers()` as "Measure word — 个 · 片".
  Simplified wins where CC-CEDICT gives both forms; readings are kept in the data.
- Phase 3.3 §5: the seal-red sweep found four violations beyond the search input — the
  settings sliders' `accent-color`, the banner's left rule, credit/word links, and the
  stats progress fill. All are ink now. Focus rings are `--fg` everywhere, including the
  suggested-rating ring, which is a state rather than a call to action.
- Phase 3.3 §6: one `emptyState(motif, text, action, { note })` component backs Words,
  Browse before searching, Stats without reviews, and the finished session, so they
  cannot drift. The 田字格 outline is the motif for the first three; the seal is the
  reward mark for a finished session.
- Phase 4: `engine/gamify.js` derives XP, level, streak, bands and badges from the deck,
  the log and replayed states. Nothing accumulates — the `meta` row is a cache that
  `refreshGamify()` overwrites, which is what makes import and sync unable to desync XP.
- Phase 4: level 0 is a real state. §10 defines the level as the highest n whose threshold
  the total meets, and LEVEL_XP_FORMULA(1) is 100, so a learner is level 0 until their
  first 100 XP. Implemented as specified; the screen shows progress to level 1 so it reads
  as a start rather than a deficit.
- Phase 4: a streak stays alive while its last counting day is today **or yesterday** —
  otherwise it would read as broken every morning before the first review. It breaks on a
  missed day and on a day that fell short of STREAK_MIN_REVIEWS.
- Phase 4: `longestStreakOf` is kept alongside the current streak so a lapsed milestone
  badge is not taken away. Earning 30 days once means having earned it.
- Phase 4: band clear counts untouched words against the band — BAND_CLEAR_RULE is about
  the band's REC cards, and a word never introduced has an interval of 0. Band 0 (custom
  words) is not a curriculum band and cannot block the all-bands badge.
- Phase 4: the heatmap encodes intensity as ink density rather than a colour ramp; the
  palette already carries meaning and a green ramp would fight the tone colours.
- Phase 4: earned badge marks use seal red. §3.2.1 lists "badge earned" as a stamp moment,
  so this is inside the sweep rule even though §3.2.8's shorthand list did not enumerate it.
- Phase 4: `passRate` and per-band progress moved from `views/stats.js` into
  `engine/gamify.js`; the view now holds only presentation.
- Phase 5: `run_worker_first` changed from `["/api/*"]` to `true`. With the narrow form,
  asset requests were served by the asset server and never reached the Worker, so
  `mw/security.js` never ran and `/` shipped with **no CSP at all** — §11's acceptance
  check caught it. §3 describes the router as "`/api/*` → handlers, else static assets",
  which is the same reading.
- Phase 5: `.dev.vars` lives in `worker/`, beside `wrangler.toml`, not at the repo root —
  wrangler resolves it relative to the config file, and at the root it was silently
  ignored, which showed up as `/api/auth/dev` returning 404 with DEV_MODE apparently set.
- Phase 5: `scripts/api-tests.sh` clears the local `rate_limits` table before running. The
  suite deliberately trips the auth limiter, so without a reset it passes once and then
  429s on every later run.
- Phase 5: `DELETE /api/me` removes child rows explicitly rather than relying on
  `ON DELETE CASCADE`. D1 does not enforce foreign keys unless they are switched on, so
  the cascade in the schema is documentation, not behaviour — and §1.5 promises deletion
  actually deletes.
- Phase 5: `received_at` is `max(now, previousMax + 1)` plus the row's index, so it is
  strictly increasing per user even for two batches inside one millisecond. A cursor that
  could repeat a value would silently hide events from a device that had already read it.
- Phase 5: provider access tokens are used once — to read an id — and discarded. Nothing
  from the provider is stored beyond the id and display name, and there is no refresh
  token to leak.
- Phase 5: Turnstile fails **closed** when no secret is configured; `DEV_MODE=1` is the
  only bypass, because a local machine has no widget to solve. A misconfigured production
  deploy therefore refuses logins rather than quietly accepting unverified ones.
- Phase 5: added `GET /api/auth/providers`, which is not in §11's table. The login page
  has to know which buttons to render, and asking the server beats hardcoding a list that
  can disagree with which secrets are actually set. Phase 6 consumes it.
- Phase 6: `sync/client.js` takes both collaborators as ports — `local` for storage,
  `api` for the network — so the whole orchestration is testable without IndexedDB or a
  server, including two devices converging on one state hash.
- Phase 6: sync pushes before it pulls. A device returning from offline should contribute
  before it consumes, so a second device syncing straight afterwards sees everything in
  one pass rather than two.
- Phase 6: guest → account migration needed no code. A guest's log is a log with nothing
  marked synced, so the first sign-in pushes all of it down the ordinary path; the test
  asserts that path rather than a special case, because there is not one.
- Phase 6: **Turnstile is the one place §1.2 could not hold as written.** §11 mandates the
  widget, and it is a script served by Cloudflare, which `script-src 'self'` forbids. The
  resolution is to bound it: the client loads it only when a site key is configured *and*
  only when someone presses sign-in on Settings, and the Worker widens its CSP to
  `challenges.cloudflare.com` only when `TURNSTILE_SECRET` is set. A guest, a review, an
  offline session and a Turnstile-less deploy all stay exactly as third-party-free as
  before. §14's "zero third-party requests except OAuth redirects" needs amending to say
  "except OAuth redirects and, when configured, Turnstile".
- Phase 6: `secure(response, env)` now takes env, because whether the policy widens is a
  deployment fact rather than a constant. The strict policy is still the default and is
  what an unconfigured deploy serves.
- Phase 6: signing out clears the sync cursors as well as the account. Leaving them would
  make the next account on that device skip everything the previous one had already
  pulled.

- Hardening (patch series authored by the reviewing model, applied by the maintainer):
  scripts are Node-only — `dev.mjs` and `api-tests.mjs` replace the bash pair, because
  the maintainer's shell is PowerShell and CI is not the only place code must run.
- Hardening: `validEvent` gained size and sanity bounds (id ≤ 64, cardId ≤ 120, ts within
  a week of server time, durMs ≤ 1h). Invariants, not tunables, so they live beside the
  validator rather than in §0.
- Hardening: the rate limiter keys on `cf-connecting-ip` alone. `x-forwarded-for` is
  client-writable, and a spoofable limiter key is a limiter bypass.
- Hardening: login deletes the user's expired sessions and caps live ones at
  MAX_SESSIONS_PER_USER (§0), newest kept — the table stays bounded with no cron.
- Hardening: deploy gates on a Windows test job and the live API suite, not unit tests
  alone; the workflow may use bash internally because runners are pinned environments,
  unlike contributor machines.
- Phase 3.4.1: the §8 queue rule generalizes from "custom words lead" to "user-prioritized
  words lead". `priorityOf()` treats a custom word as prioritized at the moment it was
  added and a "Study next" press as prioritized then, so both share one lane with no
  migration and no second sort key. Priorities are local intent stored in `meta`, not
  synced: which device you asked on is where it applies.
- Phase 3.4.2: audio lives in one `audioControl()` component, so "every face that shows
  hanzi or a sentence has audio" is structural rather than remembered. Card backs get it
  through the meta row, which is why REC, PROD, SENT and WRITE all gained it at once.
- Phase 3.4.3: the card-body flip listener is gone entirely. Tapping the hanzi now speaks
  it; revealing is Show answer or Space. The two jsdom tests that asserted tap-to-flip
  were updated rather than deleted — they now assert the opposite, which is the point.
- Phase 3.4.4: the chosen voice is stored by `voiceURI` and re-applied at boot before the
  first listening card. A voice that has been uninstalled falls back to zh-CN rather than
  going silent, because a profile can move between machines.
- Phase 3.4.5: backs show the *shortest* example, not the first — a back is a glance, and
  the shortest sentence is the one that can be read in one. LIS and SENT are excluded
  because they already lead with a sentence.
- Phase 3.4.6: "Practice writing" mounts the same Hanzi Writer quiz as a WRITE card but
  records no event and touches no card state, so it cannot affect scheduling. It is on the
  word page rather than in review, where an ungraded card would be a contradiction.
- **Phase 3.4.7: frequency collections are NOT shipped — bands only, per the fallback the
  spec names.** SUBTLEX-CH publishes no licence: its page asks only that you cite the
  paper "if you use the frequencies for your research", which is a citation request scoped
  to research, not a grant to redistribute derived ranks in an AGPL app. The BCC list has
  no redistributable published form I could find — `bcc.blcu.edu.cn` is a query interface,
  and the GitHub mirrors named for it 404. So neither fits, and §7's own instruction is to
  ship bands and log it.
  One candidate does fit if you want frequency later: `hermitdave/FrequencyWords`
  (MIT, `content/2018/zh_cn/zh_cn_50k.txt`, derived from OpenSubtitles). It is not
  SUBTLEX-CH or BCC, so adopting it is a source substitution that needs your approval
  under §4.
- Phase 3.4.7: **the deck was not rebuilt** — no `freqRank`, so no pipeline change and no
  pack diff. `app/assets/packs/` is byte-identical to its Phase 3.3 state.
- Phase 3.4 (incidental): `scripts/api-tests.mjs` could not reset the rate-limit table on
  Windows. `spawnSync` with `shell: true` concatenates arguments unescaped, so
  `--command "DELETE FROM rate_limits"` arrived as three arguments and wrangler rejected
  it — which made the suite pass once and then 429 on every later run. It now writes the
  statement to a temp file and uses `--file`, which has no spaces to lose.
- Phase 7 §2: **the n+1 pass shipped, and the numbers are good.** Of bands 1-3
  (989 words): **93.3% clean** — introduced in a sentence whose every other word is
  already known — **4.4% relaxed** (one extra unknown), **2.2% with no sentence at all**.
  Across the whole deck: 12 seeded, 5309 clean, 1545 relaxed, 4038 bare (the tail is
  band 7, where Tatoeba coverage thins out).
- Phase 7 §2: **zero card ids changed.** The build now refuses to write a deck that loses
  an id, and reported 10,904 preserved. `introRank` is a new field, not a new identity —
  reordering introduction cannot orphan anyone's review history.
- Phase 7 §2: the greedy loop restarts its scan each round rather than making one pass.
  That is what makes it dependency-ordered instead of merely filtered: a word that could
  not be introduced in round 1 often can be by round 3, once its prerequisites land.
- Phase 7 §3: `dictionary.txt` from makemeahanzi is **LGPL-3.0-or-later** (per the
  project's COPYING; derived from Unihan and CJKlib) — redistributable and compatible with
  our AGPL-3.0. Pinned to commit `bddc96d4`. Credited by the pipeline like every source.
- Phase 7 §3: component breakdowns use only the top level of the decomposition. Recursing
  to atoms turns 好 into a tree nobody reads in twenty seconds; one line per visible part
  is the point.
- Phase 7 §1.4: the writing track is a `modesForWord` option rather than stored card data,
  so replay stays pure and deterministic. Toggling it replays the log instead of patching
  state — turning it on introduces WRITE siblings for every started word, off drops them,
  and the event log is untouched either way, so the decision is reversible.
- Phase 7 §1.4: migration keys off history, not a version flag: an account with events
  chose writing by using the app as it was, so it keeps WRITE cards **and** skips
  onboarding. Only a genuinely empty account takes the new default.
- Phase 7 §1.5: the ramp counts **active days** (days with at least one review), not
  calendar days since signup. Someone who studies twice in a fortnight is still on day 2
  of learning, and should not be handed a full load for having owned the app a while.
  It can only ever lower the cap, and an explicit slider move disables it permanently.
- Phase 7 §1.2: tone results are counters in `meta`, never FSRS cards — a perceptual drill
  has no spacing schedule, and minting cards would pollute both the review queue and the
  XP derived from it. Weighting starts biased toward 2/3 and adapts from there, ignoring
  samples under four attempts so noise cannot drive it.
- Phase 7 §4: initial encoding stays blocked and this predates the phase — a new word gets
  its teach screen and first REC card in the same session, siblings stay buried same-day
  and staggered by interval (§5.4). Deliberately not "improved": blocked initial encoding
  then interleaved retrieval is what the evidence actually supports.
- Phase 7 §6: **XP stays volume-of-retrieval, never correctness.** Paying for "correct"
  turns honest self-grading into a scoring decision — the learner starts pressing Good to
  protect a number, and the scheduler silently rots because its input is now a lie. The
  streak stays as-is; no leaderboards, no multipliers, no loss-aversion mechanics.
- Phase 7 §5: voice rotation is opt-in per call (`speak(text, { rotate: true })`), used by
  drills and teach screens only. Ordinary review keeps the chosen voice, so it stays
  predictable, and a device with one voice degrades to exactly the previous behaviour.
- Design v3 §1: night market is the default theme and paper is unchanged from v2. The
  signage pink is split by role, exactly as v2 split vermilion: white on `#ff3d68` is
  3.43:1, under the 4.5 a button label needs. `--accent` keeps the bright value wherever
  the colour is *seen* — chrome, text on dark, every glow — and `--accent-fill` (#d93458)
  carries white labels. Same for `--danger` / `--danger-fill` (#cc4242, from #ff5252 at
  3.19:1). The contrast suite is the wall, so the palette bent rather than the suite.
- Design v3 §1: the existing night tone colours all clear 4.5:1 on the new darker ground
  (t1 5.68, t2 8.53, t3 7.84, t4 7.97, t5 6.88), so they were left alone. Retuning them
  toward neon was permitted but not required, and they are semantics, not decoration.
- Design v3 §2: `neonIgnite(host, char, opts)` is the single implementation, in
  `zh/writer.js`, reusing the stroke data the handwriting quiz already ships — an ordered
  set of paths is exactly what a tube sign needs. Reduced motion or reduce-effects renders
  the finished character at steady glow with no animation.
- Design v3 §2.2: the session-done sign lights the word with the most Again presses today,
  ties to the newest, and shows **nothing** on a day with no struggle. A sign that lights
  every time means nothing; this one is earned by definition.
- Design v3 §3: every effect is gated on one attribute, `data-effects`, set by the
  Settings switch and asserted in CSS by a test — "reduce effects removes every glow" is
  checkable rather than promised. Scanlines are additionally disabled on paper regardless.
- Design v3 §3: a broken streak renders as an em dash. No shake, no red, no "you lost it"
  — the loss-aversion note in Phase 7 §6 is about extrinsic pressure, and that reasoning
  applies to visuals as much as to XP.
- Design v3 §4: the review sheet gained exactly the four sanctioned accents, and a test
  asserts the card interior, the hanzi and the 田字格 carry no glow rule at all. The 田字格
  is reading furniture; lighting it would be the exact failure the stage/tool law names.
- Design v3 §5.1: `packs/zh/topics.json` maps 1,239 of 1,979 band 1-4 words across the 15
  topics, drafted from English definitions plus a hand-written seed list for words a gloss
  cannot classify (pronouns, greetings, directions). 27 band-1 words are unmapped and all
  of them are grammar (不, 都, 个, 很, 太, 也, 一下 …) — that list is in report.txt for
  review, and the build refuses any id the deck does not have.
- **Design v3 §5.2: the frequency row is NOT shipped, because `freqRank` does not exist.**
  §5.2 cites "3.4 §7's freqRank", but Phase 3.4 §7 explicitly did not ship it — no
  frequency list we could find permits redistributing derived ranks (SUBTLEX-CH has no
  licence; no redistributable BCC list exists). The signboard renders the row
  automatically the moment the deck carries the field, so this is one pipeline change
  away. `hermitdave/FrequencyWords` (MIT) remains the candidate, and adopting it is still
  a source substitution needing approval under §4.
- **Phase 8 §1: the licence check changed which Piper voice the bake-off uses.** Engine
  licences are the easy part — Piper and MeloTTS are both MIT, and MeloTTS-Chinese is MIT.
  The *training datasets* are where it nearly went wrong. Piper's best-known Chinese voice,
  `zh_CN-huayan`, states its dataset licence as **"Unknown"**, which is not a grant;
  `zh_CN-xiao_ya` is explicitly **non-commercial**, which AGPL cannot accept. Only
  `zh_CN-chaowen` (dataset **CC0**) is clean, so that is what the bake-off renders.
- **Phase 8 §1: Piper's Chinese path is not the lightweight option its reputation
  suggests.** Getting it to speak Mandarin needs `piper-tts` + `g2pw` + **torch** +
  `requests` + `unicode_rbnf` + `sentence_stream`, and G2PW downloads a model of its own
  on first use. I installed all of it on this machine and `phonemize('你好')` still
  returned an empty phoneme list, so no samples were produced. MeloTTS also needs torch.
  The "Piper is lighter" premise does not survive contact with Chinese — worth knowing
  before the pick.
- Phase 8 §1: the bake-off **fails loudly** rather than writing 25 silent files. An empty
  phoneme list is checked before rendering, because silent audio that looks successful is
  worse than an obvious failure.
- Phase 8 §2: 17,001 items (10,904 words + 6,097 intro sentences), estimated 0.13-0.20 GB
  at 8-12 KB each.
- Phase 8 §3: **R2 free tier verified 2026-07-24 — 10 GB-month storage, 1M Class A ops,
  10M Class B ops per month.** The pack is ~2% of storage; the one-time upload is ~17k
  Class A ops, under 2% of the monthly allowance; playback is Class B and the service
  worker caches each file forever after first play. It fits comfortably.
- Phase 8 §3: `/audio/:file` needs no session. It is public data — the same audio anyone
  can regenerate from the committed manifest — and requiring a session would break guest
  mode (§1.3). Traversal is refused by rejecting any name containing `/` or `..`, verified
  against percent-encoded attempts as well.
- Phase 8 §4: `zh/audio.js` wraps `tts.js` rather than replacing it, and re-exports its
  whole surface, so every existing audio control kept working with no markup change. The
  resolver returns *which* source spoke, which is what makes the fallback chain testable
  rather than merely hoped for.
- Phase 8 §4: slow replay is the same file at `playbackRate` 0.6 with `preservesPitch`, so
  a slowed word is the same voice rather than a lower one — and there is no second file to
  generate, store or upload.
- Phase 8: the audio pack is **optional by design**. No manifest means browser speech, not
  silence, so a deploy without R2 — or a fork that never runs the generator — still works.
  The three manifest-contract tests skip themselves until a pack exists.

