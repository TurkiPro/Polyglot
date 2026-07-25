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
- **Phase 8 §1: the bake-off rendered nothing because of the machine's locale, not the
  model.** g2pW opens its character dictionaries with no explicit encoding, so Python
  decodes them in the system ANSI codepage — cp1256 here. Every Chinese key became
  mojibake (一 arrived as `ن¸€`), no lookup matched, and the phonemizer returned `None`
  for every character *without raising*: silent output, no error, and nothing wrong with
  the 159 MB `g2pW/` folder. Same interpreter and same model, only `PYTHONUTF8` differing,
  turns `[[None, None, None]]` into `[['hao3', 'hao4', 'qiao3']]`. Both scripts now
  re-exec themselves under `-X utf8`, since `open()`'s default encoding is fixed at
  interpreter start and cannot be repaired in-process. This will bite anyone whose
  codepage is not UTF-8 — cp1252, cp936, most of the world outside en_US.
- Phase 8 §1: the suspected corrupt `bert-base-chinese` cache was **innocent**. Its 126 KB
  is exactly the three blobs g2pW needs (vocab, config, tokenizer config); the BERT weights
  are never used, because inference runs through `g2pw.onnx`.
- Phase 8 §1: two dependency traps sit in front of the engines, and both misreport
  themselves. `transformers` v5 exposes `BertTokenizer` as a fast-tokenizer wrapper needing
  `tokenizers>=0.22`, so a stale `tokenizers` makes `import transformers` fail outright.
  MeloTTS pins `librosa==0.9.1`, which imports `pkg_resources`, which setuptools >= 81
  removed — so a current venv raises `ModuleNotFoundError: pkg_resources` while `pip list`
  shows `melotts` installed. The bake-off used to report both as "MeloTTS is not
  installed"; it now names the real cause.
- Phase 8 §1: G2PW's model is resolved as `<cwd>/g2pW`, so running the scripts from
  anywhere but the repo root silently re-downloaded 159 MB. Both now pass an explicit path.
- **Phase 8 §1: both engines are stochastic, which broke a documented promise.** The
  synthesis noise is sampled inside the ONNX graph, so seeding numpy does nothing and
  identical text renders different bytes every run — verified for both. Because a file's
  name *is* its content hash, `generate.py`'s claim that "regeneration is deterministic for
  a pinned engine version" was false: a re-run after a deck update would rename all ~17k
  files, orphan the uploaded pack and invalidate every cached client. Zeroing Piper's
  `noise_scale`/`noise_w_scale` makes it bit-reproducible (25/25 files identical across
  full re-renders), so that ships as a third bake-off column, `piper-fixed`. It is a column
  rather than a silent default because it trades prosodic variation for reproducibility,
  and this phase judges voices by ear.
- **Phase 8 §1: samples are peak-levelled before the maintainer hears them.** The engines
  disagree about output gain by roughly 10×, and MeloTTS renders isolated single characters
  5–50× below its own sentence level — 女 arrived at peak 85/32767. Judging "tone accuracy"
  across a 10× loudness gap would have been a loudness test. Raw levels are measured once
  at render time and kept in a `levels.json` sidecar, because levelling is destructive and
  a later partial run would otherwise re-measure already-levelled files and erase the
  finding — a bug that appeared and was caught during this work.
- Phase 8 §1: `--engine X` no longer reports the other engines as failures. An engine that
  was not attempted keeps the audio it rendered last time, so the page still compares all
  three, and only an engine actually tried can fail the run.
- Phase 8 §2: `generate.py` levels every clip for the same reason, and checks the
  phonemizer before committing to a run — silence would otherwise be shipped 17,000 times.
- **Phase 8 §1: single-character words are rendered through a carrier phrase, not alone.**
  A lone character is three phonemes with no run-up, and the sentence-trained voice lays
  almost no tone over it — measured, it swings 130-170 Hz of pitch inside a sentence and
  only 20-40 Hz for the same character alone, so 好 / 号 / 巧 came out flat and clipped
  (the maintainer heard this and asked). The fix, in `carrier.py` and applied only to
  single characters (multi-syllable words already carry their own tone context): render
  the character at the end of `请说{}。`, where it gets a real tone, then cut the target
  syllable back out. Verified: bare syllables move 17-46 Hz with no tonal logic; cropped
  from the carrier they move tone-appropriately (T1 妈 ~9 Hz flat, T4 号/骂 ~76-80 Hz fall,
  T3 好/马 ~70-85 Hz dip).
- Phase 8 §1: the carrier ends **high** (说, tone 1) deliberately. The carrier's final
  syllable coarticulates into the target: `这是` (ending on 是, tone 4, low) flattened a
  following third tone to 0 Hz, while `请说` (ending high) let it move. `请说` beat `这是`
  on every tone tested. Coarticulation is a real cost of the approach and the reason the
  carrier choice is not arbitrary.
- **Phase 8 §1: the syllable is cut by phoneme alignment, not by energy.** The first
  attempt cropped the last voiced run, which kept whole neighbouring syllables — Chinese
  syllables run together with no silence between them, so there is no gap to cut on, and
  the maintainer correctly heard "almost a whole phrase". The alignment crop is exact
  (0.27-0.31 s single syllables). Piper's *own* Chinese alignment is broken — its
  reconciliation assumes a PAD id after every phoneme, but the zh phonemizer only pads
  after tones and punctuation, so it always reports failure — yet the raw per-id sample
  counts it returns are correct, so `carrier.py` rebuilds the phoneme→sample mapping from
  the known padding rule. Needs the `onnx` package (to patch the model for alignment
  output); without it single characters fall back to a bare render rather than breaking.
- Phase 8 §1: loading the voice with `include_alignments=True` was verified to produce
  byte-identical audio for a normal (non-cropped) render, so turning it on for the whole
  build leaves every multi-syllable and sentence hash unchanged. The carrier crop is
  itself deterministic under noise-off, so `piper-fixed`'s reproducibility guarantee holds
  for single-character words too.
- Phase 8 §1: the audio build scripts share `lib.py` (UTF-8 re-exec, levelling, silence
  trim, F0 measurement) and `carrier.py` (the single-char crop), so `bakeoff.py`,
  `generate.py` and `isolated.py` agree on one definition of each and every file stays
  under the ~300-line cap.
- **Phase 8 §3: the pack is uploaded over R2's S3 API, not `wrangler r2 object put`.** Two
  things surfaced when the maintainer ran the original wrangler-based uploader and saw
  nothing appear in the bucket. First, `wrangler r2 object put` in Wrangler 4.x defaults to
  `--local` — it was writing to the local miniflare simulation, never to Cloudflare; it
  needs an explicit `--remote`. Second, passing `--config worker/wrangler.toml` made a
  simple object put hang (>2 min) — the object commands do not need the Worker config, only
  global auth. But even fixed, wrangler boots once per file (~4 s measured), so a
  16,217-file pack would take ~18 hours. Rewritten to sign requests in-process (SigV4 via
  `node:crypto`, no dependency, verified against AWS's published test vectors) and upload
  ~24 at a time, which does the whole pack in minutes. Needs R2 S3 credentials
  (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY) rather than the wrangler OAuth
  session; documented in the script header, README and CHECKLIST.
- The deploy/operator steps (D1, OAuth apps, Turnstile, secrets) live in the README and
  CHECKLIST; there is no separate self-hosting document.
- **Phase 8 §4: the tone gym and onboarding now play pack audio, not browser TTS.** They
  spoke abstract pinyin syllables (`ma`, `shi`…) with no pack key, so every drill fell
  through to browser speech — which flattens tone, the one thing a tone drill exists to
  teach. Fixed by drawing drills from the single-character deck words that already have
  pack audio, grouped by tone (`buildTonePool`): a real word, spoken with a real contour,
  no new audio and no re-upload. The per-tone pools are healthy (389/309/298/509 for tones
  1-4) and thin but usable for the neutral tone (5 words). Pairs play their two syllables
  in sequence, spaced so each tone lands on its own.
- Phase 8 §4: the onboarding archetype (mā má mǎ mà · ma) resolves each sample to a pack
  key through the deck by spelling + reading, which self-corrects the two gaps rather than
  ever playing a wrong tone: 妈 is only in the deck as 妈妈 (no single-character entry), and
  the deck catalogues 吗 as má (tone 2), not the neutral question particle — so a lookup for
  ma1 and ma5 finds nothing and those two fall back to browser voice. 麻/马/骂 play pack
  audio. Closing the last two would mean rendering 妈 and a neutral 吗 into the pack.
- Phase 8 §4: two review-card audio controls were keyless and so TTS-only — the keyboard
  activation of a tap-to-speak character, and the LIS card front — now keyed to the word
  and to the sentence src respectively. Only the Settings voice preview stays keyless, by
  design: it is previewing a browser voice, so it must not use the pack.
- Phase 9a: course units are contiguous slices of the `introRank` spine, not a new ordering
  — the n+1 dependency order stays the single sequencer. 496 units of 19-24 words each
  (UNIT_SIZE ±3), seams nudged up to 3 words to land on a topics.json boundary. Unit ids are
  `u001`… (3-digit, zero-padded) so they sort lexically and stay stable once shipped; a test
  reproduces the committed ids from the deck, the same id-stability guard the deck has.
- Phase 9a: 45 units fall in the authored bands (1-3); the rest are auto-titled
  `Band N · Unit M`. Only **20** carry a grammar `note`, not the spec's aspirational ~45:
  the function words a note is about (了, 吗, 不, 的…) cluster into a handful of early units,
  and it is one note per unit, so the rest are topical-vocab units (Food, People, Places)
  that genuinely have no single pattern — which the spec says get none. Notes are keyed by
  unit id in `course-overrides.json`, reviewable data like topics.json.
- Phase 9a: the exercise engine is pure — six generators `(candidates, ctx) → item|null`
  and graders `(item, response) → {correct}`, a seeded mulberry32 RNG so a quiz attempt
  reproduces exactly, and distractors ranked by a similarity score (same band + shared
  component + close pinyin + same tone pattern) then sampled. REORDER/CLOZE segment the
  intro sentence by greedy longest match and only run when every word is already known.
  TYPE_PINYIN calls `gradeProduction` verbatim rather than forking the normalizer.
- **Phase 9a: the scheduler firewall is structural, not a rule to remember.** Practice
  results are a wholly separate append-only stream (`practice_events` table, own IndexedDB
  store at DB v2, `/api/sync/practice` mirroring the review endpoints). `rebuildFromEvents`
  — the FSRS oracle — never reads it, and a practice event carries no `cardId`, so even a
  leaked one is a replay no-op (`parseCardId(undefined)` → a word the deck lacks → skipped).
  Proven both ways in tests. The reason it must never feed FSRS: cued recognition (MCQ,
  matching) is far easier than the free recall the scheduler grades on, so a correct MCQ
  bumping stability would inflate intervals and quietly rot retention. This will be
  questioned forever; the answer is here.
- Phase 9a: `packs/zh/lib/course.js` and `app/src/engine/exercises.js` read their §0 values
  (UNIT_SIZE, COURSE_BANDS, MCQ_CHOICES) from config like `queue.js` does, rather than
  inlining literals, so the config-discipline grep stays clean.
- Phase 9b: course progress is derived, never stored (`engine/coursestate.js`) — a word is
  introduced once its REC card has been graded (reps > 0), and a unit is cleared/gold from
  `CHECKPOINT` / `CHECKPOINT_GOLD` practice events in the log. So the path survives export →
  wipe → import and sync with no separate course-state table to drift, exactly as §4 requires.
  Both the client export/import and the worker export carry the practice stream for this.
- Phase 9b: a lesson introduces a word through a **real REC review** (the same `recordReview`
  the review loop uses), not a side channel, so it counts against the daily new-card cap and
  ramp automatically. `remainingNewToday = ramp(activeDays) − countNewToday`, and the lesson
  takes `min(LESSON_WORDS, unintroduced, remaining)`; when that is 0 the sitting shows the
  cap-spent screen rather than pacing past the limit.
- Phase 9b: the exercise views live in `views/exercise.js`, one small renderer per type over
  the pure items from `engine/exercises.js`; the lesson (`views/lesson.js`) is a step machine
  that interleaves teach → intro card → exercise. MATCH dropped its audio axis (that is what
  MCQ_AUDIO is for), leaving hanzi↔meaning / hanzi↔pinyin which pair cleanly by tap.
- Phase 9b: the Home CTA leads with `Continue · Unit N — Title` (→ `#course`) when a course
  is unfinished, with Review kept as an equal, quieter CTA beside it — the course is the way
  in, reviews are still one tap away. When nothing is due for review the course CTA still shows.
- Phase 9b: DB bumped to v2 already carried the practice store; `wipeLocal`, export and import
  now all include the practice stream so a cleared unit is erased and restored with everything else.
- Phase 9c: a checkpoint's items are weighted toward the unit's weakest words via
  `weakestFirst` (practice accuracy, unseen-first) — a word that was reviewed but never
  practised sorts as maximally weak, which is how "practice_events + review history" folds
  in without a second scoring path. Items are `buildQuizItems`, pure and seeded by
  `hashSeed(unitId + attemptCount)`, so a retake regenerates a genuinely different paper
  while a given attempt reproduces exactly in tests.
- Phase 9c: every checkpoint attempt appends one summary event — `CHECKPOINT_GOLD`,
  `CHECKPOINT`, or `CHECKPOINT_FAIL` — so the attempt count (for the retake seed) and the
  cleared/gold sets all derive from the practice log. FAIL is recorded but ignored by
  `clearedSets`, and because events are only ever appended, cleared and gold are monotonic:
  a later worse retake never removes a badge.
- Phase 9c: the unit's sign ignites (`neonIgnite` on 过) only when the run actually clears
  it — the flourish is earned, not automatic. A band's completion reuses the existing
  band-clear badge, shown at the checkpoint milestone with the arcade treatment rather than
  minted anew, keeping one definition of "band cleared".
- Phase 9c: the replay-determinism test now splices ~60 practice events through the 150-review
  log and asserts the FSRS state hash is unchanged — the §2 firewall proven under the same
  determinism guarantee that protects sync and import, not only in isolation.


- Home redesign: the stroke-lit 语 hero was removed (it flickered out intermittently and
  the animated HanziWriter render was never reliable) in favour of the 3D gate as the
  centrepiece, which sits in its own right-hand column on desktop and above the content on a
  phone. Onboarding (#welcome) is disabled for now at the maintainer's request pending a
  redesign: new accounts land on Home rather than being routed to it, and the Home welcome
  banner is gone. The route and view code remain, just unreferenced by the auto-flow.

- Audit F1: `DELETE /api/me` now also clears `practice_events`; it was left out when the
  Phase 9 stream landed, and D1 does not enforce foreign keys, so those rows orphaned forever.
  The fix is guarded structurally: `tests/account-deletion.test.js` reads the user-scoped
  tables straight from `schema.sql` and asserts `deleteMe` deletes from each, and api-tests
  counts zero rows in every one against real D1 — a future user-scoped table missing from the
  batch fails the day its schema lands.

- Audit F4: ESLint (flat config, `eslint.config.js`) is now a build gate — rules
  `no-shadow`, `no-undef`, `no-unused-vars`, `eqeqeq`, `no-var`, `prefer-const`, run by
  `npm run lint` and by CI before tests in every job. It exists because the `stage`/`flipStage`
  shadow shipped once and was caught only by Windows test ordering; `no-shadow` would have
  stopped it at the keyboard. `eslint` plus its data-only companion `globals` (the flat-config
  environment tables `no-undef` needs) are the two dev additions — approved onto the §4.3
  allowlist by fixes.md. Globals are declared broadly rather than per directory: over-declaring
  only softens `no-undef`'s environment strictness, while under-declaring yields false positives,
  and the rules that carry their weight here do not depend on it. Two rule accommodations, both
  for intent not laxity: `eqeqeq` keeps the `x != null` idiom (`{ null: 'ignore' }`), and the
  service worker's esbuild `--define` constant `__PACK_VERSION__` is declared a read-only global
  for `app/src/sw.js`. The 26 flags it surfaced on first run were all mechanical (unused imports,
  a `let` that should be `const`, four harmless shadows) and are fixed in this commit. Generated
  trees are ignored: `app/assets/bundle.js`, `app/assets/dict-worker.js`, `app/sw.js`,
  `**/.wrangler/**`, `.venv`, `packs/zh/data`, `packs/zh/audio`.

- Audit F2: `neonIgnite` was reworked so it can no longer render an empty box. The
  intermittent blank was a lifecycle race — HanziWriter's `charDataLoader` fetched
  asynchronously, so a slow load or a node that detached mid-flight (route change, session
  teardown) could leave the SVG with no strokes and never recover. The fix removes the race
  at the root: the stroke data is fetched BEFORE any DOM is built, the target is checked
  `isConnected` before the writer starts, the loader hands HanziWriter the data synchronously,
  and every failure edge — bad data, a detached host, a HanziWriter throw, or a ~2s deadline
  with no lit stroke — lands on `.neon-fallback`, the steady-glow glyph (a visible character
  with `--glow-sm`). The path taken is recorded on `host.dataset.ignitePath` (animated|static)
  and logged with `console.debug` (local only, no beacon). `tests/neon-ignite.test.js` (jsdom)
  covers all five outcomes. This retires the reason the 语 hero was removed, though the hero
  itself stays gone in favour of the 3D gate.

- Audit F3: the dictionary import moved off the main thread. `browse.js` used to
  `await res.json()` the ~120k-entry CC-CEDICT file and reshape it inline on first Browse —
  a multi-second freeze at a first-impression moment. Now a module Web Worker
  (`app/src/engine/dict-worker.js`) fetches and parses the file and posts it back in
  2,000-entry batches (`dict-batch.js`, the pure, unit-tested core); the main thread writes
  each batch to IndexedDB with the writes serialized so they never stack on one frame, and
  the UI stays interactive throughout. A `try { new Worker(...) }` fallback keeps a
  main-thread import for platforms without module workers, so Browse never simply breaks.
  CSP needs NO change: the policy is `default-src 'self'` / `script-src 'self'` with no
  `worker-src` override, so a same-origin module worker resolves through the
  worker-src→child-src→script-src fallback to `'self'`, and the worker's own `fetch` is
  same-origin under `connect-src 'self'`. The built worker (`app/assets/dict-worker.js`) is a
  second esbuild entry, gitignored like `bundle.js`, and precached in the service worker as
  shell logic.

- Audit F5: the rate-limit table cleanup no longer runs on a `Math.random() < 0.02`
  lottery — which let the table grow unbounded between lucky draws. Cleanup now happens on
  window rollover: when the upsert opens a fresh window for an identifier (`count === 1`), one
  indexed `DELETE ... WHERE k LIKE '<scope>:<identifier>:%' AND window_start < <current>`
  drops that identifier's now-expired windows. Each returning caller sweeps its own trail, so
  no key ever keeps more than its current row — no scheduler, no randomness. The LIKE prefix
  escapes `\`, `%`, `_` so an identifier can never smuggle a wildcard. Unit tests (a pocket
  D1 fake in `worker.test.js`) prove one row per key across ten windows, that a neighbour's
  row is never swept, and that counting within a window leaves the live row intact.

- Audit F6: the `/audio/:file` route now validates the filename against
  `/^[a-f0-9]{16,64}\.ogg$/` before touching R2. Pack files are lowercase-hex content
  hashes with one `.ogg` extension (Phase 8 §3), so any other shape can never be ours — and
  now it costs no R2 lookup, where the old `includes('..')`/`includes('/')` guard let every
  garbage name through to a bucket read. A manifest-membership set (bundling the ~11k hashes
  into the worker so only known files pass) was considered and rejected: it pushes the worker
  against the free-tier size cap for a marginal gain over a regex that already rejects
  everything ill-formed. Recorded here so it is not re-proposed. Coverage: a behavioural test
  in `worker.test.js` drives seven garbage names plus one valid hash through the real route
  with a counting R2 stub and asserts zero lookups for the garbage; `audio.test.js` pins the
  regex in source.

- Audit F7: accessibility inventory of the six custom-widget surfaces, with the S-sized
  items fixed in this pack and the larger ones reported here for prioritisation.

  Inventory (keyboard operability · roles/names/labels · focus visibility):
  1. **Bottom tab bar / top nav** — already sound: real `<a>` links inside labelled `<nav>`
     landmarks ("Main"/"Sections"), the active link carries `aria-current="page"`, and the
     Settings gear is a `<button>` with an `aria-label`. `.nav-link`/`.tab` have
     `:focus-visible` rings. No change needed.
  2. **Grade bar** — real `<button>`s, gradeable by mouse, by the 1–4 keys, and by
     Enter/Space on the suggested rating. FIXED (S): the `.ratings` container is now a
     `role="group"` with an `aria-label`, so a screen-reader user hears it as one labelled
     set rather than four loose buttons. The "suggested" state stays a visual default, not an
     `aria-pressed` toggle — it is not a toggle.
  3. **Card flip / reveal** — the hanzi/sentence are `speakable` (role=button, tabindex,
     aria-label, Enter/Space), and "Show answer" is a real button. GAP (M, reported): the
     revealed back is swapped in silently — there is no `aria-live` region announcing the
     answer to a screen reader, so the flip is a visual-only event. Fixing it well needs a
     polite live region wired to the reveal with care not to double-announce; deferred.
  4. **Match / reorder / cloze tiles** — all real `<button>`s, natively operable. FIXED (S):
     the `.match-grid` is a labelled `role="group"`.
  5. **Quiz / MCQ choices** — all real `<button>`s; on answer, focus moves to the Continue
     button, so the keyboard flow never strands. FIXED (S): `.exercise-options` is a labelled
     `role="group"`.
  6. **Dialogs** — there are none in the modal sense: the Danger Zone wipe, account deletion,
     and word removal are all inline confirmations built from real buttons and a typed-word
     guard, so there is no focus trap to get wrong. Nothing to fix; noted so "focus-trap
     dialogs" is not raised against a component that does not exist.

  Also FIXED (S): the navigating rows in My Words (`.row-main`) and Browse (`.result-main`)
  were click-only `<div>`s — the stylesheet already carried `.row-main:focus-visible`, but
  nothing was focusable to use it. A new `activatable()` helper gives them `role="link"`,
  `tabindex="0"`, an accessible name, and Enter/Space activation.

  Reported for later (M or larger, not improvised here): (a) the reveal live-region above;
  (b) a full screen-reader pass on the flip sequence (front/back semantics, when the grade
  bar becomes actionable); (c) an app-wide `:focus-visible` audit for the decorative controls
  (sign tiles, action cards) to confirm every focusable element shows a ring. Coverage:
  `tests/a11y.test.js` pins the `activatable` contract; `course-view.test.js` asserts the MCQ
  choices are a labelled group of real buttons.

- Phase 10 A1: course units gained a generated `steps[]` — the single ordered sequence the
  syllabus and the lesson runner both read, so there is no second sequencing logic. Kinds:
  `WORD` (one per word, in the untouched introRank order), `PHRASE` (a sentence spotlight,
  `{wordId, src}`, emitted a beat every 2–3 words wherever the current word has a sentence all
  of whose deck-words are structurally known by that point), `PRACTICE` (a mixed set after each
  full LESSON_WORDS, never the step just before the checkpoint), and `CHECKPOINT` (always last).
  Derivation is pure and deterministic; "known" is structural (introRank position), never user
  history, so the same pack yields byte-identical steps. It adds structure and resequences
  nothing: unit ids and word membership are unchanged (the id-stability test now also asserts
  `steps[]` reproduces from the committed deck). The committed `course.zh.json` was regenerated
  by `scripts/regen-course.mjs` (`npm run regen-course`), which rebuilds ONLY the course from
  the committed deck/topics/overrides so deck bytes and card ids stay untouched — 10,904 word /
  3,087 phrase / 1,488 practice / 496 checkpoint steps. `report.txt` now prints per-unit step
  counts and the totals.

- Phase 10 A3: `courseProgress` was rebuilt into the single source of course-position truth —
  `courseProgress(deck, course, events, practiceEvents)`, pure, in the engine. It reads the two
  streams directly (a REC event = an introduction, via the new `introducedFromEvents`; cleared/
  gold via `clearedSets`) and returns per-step states, per-unit %, and an overall %. Step state
  walks one frontier — the furthest anchor (a WORD introduced or a CHECKPOINT cleared) reached:
  `done` behind it, `current` the first actionable step ahead, `skipped` for anything not-done
  that was leapfrogged, `locked` only for a checkpoint whose unit words aren't all introduced,
  `upcoming` otherwise. `courseView()` now calls it; the rail, the Home CTA and the checkpoint
  gate share it. Because it is a pure function of the streams, the replay-determinism suite was
  extended to assert its output is identical across stream reordering and a JSON round-trip.
  While wiring it, fixed a latent bug: `quiz.js` passed the whole `unit` object to
  `recordCheckpoint(unitId, …)`, so checkpoint events stored an object as `unitId` and
  `clearedSets` could never match `unit.id` — the path would never register a clear. Fixed the
  call and added a `createPracticeEvent` invariant (`unitId`/`wordId` must be non-empty strings)
  so the class can't recur silently.

- Phase 10 A2: the course became legible end to end. `#course` is now the full syllabus — a
  collapsible tree of every unit (native `<details>`, keyboard-operable, steps built lazily on
  expand so hundreds of units stay light), overall % on top, per-unit % on each header, the
  current step marked, every step a link. On desktop the same tree is a sticky rail beside the
  lesson and checkpoint (`.lesson-layout` two-column ≥900px); on a phone it folds to a "Unit N ·
  step X of Y" strip that opens the tree. The lesson runner was rewritten to walk the unit's
  `steps[]` — the same list the syllabus renders, so there is exactly one sequence — handling
  WORD (teach + a real REC review), PHRASE (reorder/cloze over the spotlighted sentence),
  PRACTICE (a short mixed set over met words), and CHECKPOINT (hand-off to the quiz). Navigation
  is free: a step link starts the runner at that step (`#lesson/:unit/:index`); jumping past
  undone steps just leaves them `skipped` in the derived view (§A3), never gated. The cap is
  never bypassed — a WORD step for an unmet word still checks the daily new-card budget and ends
  the sitting warmly when it is spent (proven in `tests/syllabus.test.js`). The old
  hero+signboard `#course` (`views/course.js`) was removed; the Home CTA still points at
  `#course`. `neonIgnite` on the checkpoint sign and the current-step marker's glow are the only
  new glows (added to the §D3 registry).

- Phase 10 B: onboarding was reborn as Unit 0 "The Sounds" — a generated, wordless `u000`
  prepended to the syllabus by the pipeline (`packs/zh/lib/sounds-unit.js`, shared by build.mjs
  and regen-course.mjs). Its steps are abstract kinds the client renders: TONES (intro +
  singles + pairs drills), PINYIN (the crash intro), and a wordless CHECKPOINT (a scored tone
  drill that clears the unit from the log like any other). The ordinary lesson runner handles
  TONES/PINYIN; `quiz.js` routes a wordless unit to `renderSoundsCheckpoint`. Because the unit
  is real course data, a new account's current step is `u000` step 0 (Home CTA: "Start the
  course · Unit 0 — The Sounds") and an existing account finds it already behind its frontier,
  done-able — no special history plumbing needed, the frontier model (§A3) does it. The old
  `#welcome` route, `views/welcome.js`, and the dead auto-flow are gone; `views/sounds.js` holds
  the reborn tone/pinyin content (strings stay under `strings.welcome`, still shared with the
  `#tones` gym). The handwriting choice already lived in Settings; it gained a one-time inline
  prompt in the review flow, shown the first time a WRITE card would unlock while the track is
  off (`writingPromptPending`, guarded by a new `writingPrompted` setting). The wordless Unit 0
  is excluded from the course size-bounds check; the id-stability test now rebuilds with the
  sounds unit and asserts `course.units[0]` equals it.

- Phase 10 D1: `writer.js`'s CSSOM colour fallbacks were v1's dead palette (the `#6ea8fe`
  blue among them), used when `getComputedStyle` can't yet answer. They now read from one
  exported `NIGHT_MARKET_FALLBACK` constant beside the theme code (`ui/theme.js`), and a
  conformance test asserts it equals the committed dark-theme values — so the fallback can't
  fossilise away from the live palette again. The stray `config.toneColors.t2` fallback (which
  was `undefined`, since tone colours are keyed by theme) was fixed to the real value too.

- Phase 10 D2: eleven hardcoded millisecond durations in `styles.css` bypassed the `--dur`
  token and so ignored reduced-motion's zeroing. Each is now `var(--dur)` or a `calc()` multiple
  of it (e.g. `300ms → calc(var(--dur) * 2)`), and the `--roll-delay` fallback became `0s`. Only
  the two `--dur` definitions (`160ms`, and `0ms` under `prefers-reduced-motion`) remain, so
  reduced motion collapses every animation and transition to zero from one place. A conformance
  test greps the stylesheet for any `\d+ms` outside the `--dur` definition and fails on a hit.

- Phase 10 D3: the sanctioned-glow registry had drifted — the course path's current-step glow
  (and the older combo/liquid-button glows) used `var(--glow-*)` legitimately but were never
  written into the law. CLAUDE.md §9 now carries an explicit "Sanctioned glow" list — the
  ignited signs (`neonIgnite`), signboard hover (`.sign`), combo/odometer flourish
  (`.combo-lit`), course-path current marker (`.syllabus-step.state-current`), checkpoint/band
  clear (`.quiz-band-clear`), and the liquid-button hover (`.btn:hover`) — and a conformance
  test walks each `var(--glow` in `styles.css` to its selector and fails if it is not one of
  those, so a new glow must be added to the law before it can ship.

- Phase 10 D4: `button()`'s variant set is now closed to `btn-primary`, `btn-quiet`, and the
  size/width/colour modifiers plus the `active`/`suggested` states. The feature classes that
  used to ride the variant channel — `sign`, `tone-sample`, `match-item`, `reorder-tile`,
  `tone-answer`, `exercise-option`, `action-card`, `teach-done`, `collection`, `lesson-leave` —
  now go through a new `featureButton(label, onClick, classes)` helper. It emits the identical
  DOM (`.btn` base + the same classes), so the change is a pure refactor with zero visual
  change: the closure is about which channel a class travels through, not the rendered markup.
  A conformance test scans the view sources and fails if any literal `button()` variant is not
  a sanctioned token, so a new ad-hoc variant can't creep back in. CLAUDE.md §9 records the set.

- Phase 10 follow-up: the syllabus felt "infinite" because the course is the entire HSK 3.0
  vocabulary — 10,904 words → 497 units (band 7 = HSK 7–9 alone is 253 units) — rendered as one
  flat list of unit rows. The tree is now grouped Band → Unit → Step: the top level is a handful
  of band sections ("The Sounds", HSK 1…6, HSK 7–9), each opening to its units, each opening to
  its steps. The band in play opens by default and its units build lazily; the rest stay one
  line, so the default view is a short, scannable list rather than 497 rows. Nothing was removed
  from the course — the whole journey is still reachable, just no longer an endless scroll.
