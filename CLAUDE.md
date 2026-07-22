# polyglot — Build Instructions v1

You are the implementing model. This document is decision-complete: every architectural
choice has already been made. Your job is execution, not design. Do not revisit decisions,
do not add features, do not substitute technologies. Work through the phases in order and
do not start a phase until the previous phase's acceptance checks pass.

---

## §0 CONFIG — single source of truth

Every changeable value lives here. The rest of this document refers to these values
**by name**. In code they live in exactly two places: `config/app.config.js`
(client + pipeline + gamification) and `worker/wrangler.toml` + Wrangler secrets.
**Never hardcode any of these anywhere else.** Changing a value here must change it
everywhere.

```
# ── Identity ──────────────────────────────────────────────
PROJECT_NAME          = polyglot
GITHUB_USER           = TurkiPro
REPO_URL              = https://github.com/TurkiPro/polyglot
LICENSE               = AGPL-3.0
WORKER_NAME           = polyglot
D1_DB_NAME            = polyglot-db
PROD_URL              = https://polyglot.<subdomain>.workers.dev   # custom domain later

# ── Auth / API ────────────────────────────────────────────
OAUTH_PROVIDERS       = github, google
SESSION_TTL_DAYS      = 30
SYNC_BATCH_MAX        = 500        # review events per request
RATE_LIMIT_AUTH       = 10 req / 10 min / IP
RATE_LIMIT_API        = 120 req / hour / user
TURNSTILE             = on         # login page only

# ── Language pack (v1 = zh) ───────────────────────────────
LANG_PACK_V1          = zh
HSK_VERSION           = 3.0
DECK_SCHEMA_VERSION   = 1
SENTENCES_PER_WORD    = 3
SENTENCE_MAX_CHARS    = 30

# ── Study engine ──────────────────────────────────────────
NEW_CARDS_PER_DAY     = 10
MAX_REVIEWS_PER_DAY   = 200
STAGGER_UNLOCK_DAYS   = 3          # non-REC cards unlock when REC interval ≥ this
FSRS_TARGET_RETENTION = 0.9

# ── Gamification ──────────────────────────────────────────
XP_SHOWUP             = 20         # first review of the local day
XP_PER_REVIEW         = 2
XP_PER_NEW_WORD       = 5
XP_BAND_BADGE         = 500
STREAK_MIN_REVIEWS    = 10         # reviews needed for a day to count
LEVEL_XP_FORMULA      = ceil(100 * n^1.5)   # cumulative XP to reach level n
BAND_CLEAR_RULE       = ≥95% of the band's REC cards have interval ≥ 21 days

# ── Tone colors (CSS variables --t1..--t5) ────────────────
T1 = #e53935    T2 = #43a047    T3 = #1e88e5    T4 = #8e24aa    T5 = #9e9e9e

# ── Data sources (verify URLs before first pipeline run) ──
SRC_CEDICT_URL   = https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz
SRC_TATOEBA_LINKS    = https://downloads.tatoeba.org/exports/links.tar.bz2
SRC_TATOEBA_SENT_CMN = https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2
SRC_TATOEBA_SENT_ENG = https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2
SRC_HSK30_BASE = https://raw.githubusercontent.com/krmanik/HSK-3.0/182692ce5a11bc30bdc771835d2f0f27491c25de/New%20HSK%20(2025)/HSK%20Words/
SRC_HSK30_FILES = HSK_Level_1_words.txt, HSK_Level_2_words.txt, HSK_Level_3_words.txt,
                  HSK_Level_4_words.txt, HSK_Level_5_words.txt, HSK_Level_6_words.txt,
                  HSK_Level_7-9_words.txt   # → band 7 per §5.1
```

---

## §1 Mission and non-negotiables

polyglot is a free, open-source language-learning app built out of contempt for
subscription language apps. These are product requirements, not marketing:

1. **Free forever.** No ads, no premium tier, no paywalled features. LICENSE = AGPL-3.0
   so nobody can close-source it and sell it back.
2. **Zero telemetry.** No analytics, no tracking, no error reporters phoning home, no
   third-party scripts at runtime. None.
3. **No signup wall.** The full app works in guest mode, offline, with no account.
   An account exists for exactly one purpose: sync across devices.
4. **No stored passwords.** OAuth only. There is no password column anywhere, ever.
5. **The user owns their data.** Export/import works in guest mode (local JSON) and via
   API when signed in. Account deletion removes everything.
6. **Language-agnostic engine.** The core (SRS, queue, XP, sync, UI shell) must not
   import anything from `app/src/zh/`. Chinese is a data pack plus a thin display layer.

### Hard DO-NOTs
- NO frontend frameworks (React, Vue, Svelte…). Vanilla ES modules only.
- NO CSS frameworks. One hand-written stylesheet with CSS variables.
- NO TypeScript. Plain JS with JSDoc type comments.
- NO localStorage for review data. IndexedDB only (localStorage allowed for trivial UI
  flags like theme).
- NO grammar lessons, chatbots, or AI features. This is a vocabulary acquisition machine.
- NO dependencies beyond the allowlist in §4.
- NO CORS configuration. The architecture makes it unnecessary (§2); if you find yourself
  writing CORS headers, you have made a mistake.

---

## §2 Architecture (decided — do not revisit)

```
┌─────────────────────────────────────────────────────┐
│  ONE Cloudflare Worker (WORKER_NAME)                │
│                                                     │
│  /*        → static assets (the PWA, from app/)     │
│  /api/*    → JSON API (auth, sync, export)          │
│                    │                                │
│                    └──► D1 (D1_DB_NAME, SQLite)     │
└─────────────────────────────────────────────────────┘
            ▲ same origin ⇒ no CORS,
            │ plain SameSite=Lax cookies
┌───────────┴───────────────────────────────┐
│  Browser (guest or signed in)             │
│  deck JSON + dict → cached by SW          │
│  review state → IndexedDB                 │
│  FSRS runs entirely client-side           │
└───────────────────────────────────────────┘
```

Consequences you must respect:
- **Local-first.** The client is the source of truth. The server never computes SRS
  state; it stores facts.
- **Sync = append-only event log.** A review is an immutable event. Card state is a pure
  function `rebuildFromEvents(deck, events)`. Merging devices = union of events by id,
  then rebuild. No conflict-resolution code exists because conflicts cannot exist.
- **Server assigns `received_at`.** Client clocks are untrusted. The sync cursor is
  `received_at`-based and strictly monotonic per user (§11).
- **Assets and API ship in one `wrangler deploy`.** One origin, one deploy.

---

## §3 Repo layout (exact)

```
polyglot/
├─ app/
│  ├─ index.html                  # single page, hash routing
│  ├─ manifest.webmanifest
│  ├─ sw.js                       # precache shell + pack
│  ├─ assets/
│  │  ├─ bundle.js                # esbuild output (gitignored)
│  │  ├─ styles.css
│  │  ├─ icons/
│  │  └─ packs/zh/                # COMMITTED build artifacts (deck, dict, strokes, credits)
│  └─ src/
│     ├─ main.js                  # boot + hash router
│     ├─ views/                   # home.js review.js browse.js word.js stats.js settings.js credits.js
│     ├─ engine/                  # db.js deck.js srs.js queue.js events.js gamify.js replay.js
│     ├─ zh/                      # pinyin.js tones.js tts.js writer.js  (only lang-specific code)
│     ├─ sync/client.js
│     └─ ui/                      # components.js strings.js
├─ worker/
│  ├─ wrangler.toml
│  ├─ schema.sql
│  └─ src/
│     ├─ index.js                 # router: /api/* → handlers, else static assets
│     ├─ auth/                    # oauth.js github.js google.js sessions.js
│     ├─ api/                     # sync.js me.js export.js
│     └─ mw/                      # security.js ratelimit.js turnstile.js
├─ packs/zh/
│  ├─ build.mjs                   # entry: node packs/zh/build.mjs
│  ├─ lib/                        # cedict.js hsk.js tatoeba.js pinyin.js ids.js credits.js
│  └─ data/                       # downloaded sources (gitignored)
├─ config/app.config.js
├─ scripts/                       # dev.sh api-tests.sh
├─ .github/workflows/deploy.yml
├─ LICENSE  README.md  SELF_HOSTING.md  DECISIONS.md  CREDITS.md (generated)
└─ package.json  package-lock.json
```

---

## §4 Rules for you, the implementing model

1. **Phases are gates.** Execute in order. A phase is complete only when every acceptance
   check passes. Run the checks and print results before moving on.
2. **Never invent library APIs.** Before using `ts-fsrs` or `hanzi-writer`, read the
   README and types inside `node_modules/<pkg>/`. If the installed API differs from any
   sketch here, the installed package wins — adapt the integration, not the architecture.
3. **Dependency allowlist.** Runtime: `ts-fsrs`, `hanzi-writer`, `hanzi-writer-data`.
   Dev: `esbuild`, `vitest`, `wrangler`. Nothing else without explicit human approval —
   write small utilities yourself instead.
4. **Pin everything.** Versions resolving on first `npm install` get committed in
   `package-lock.json`. Never upgrade mid-build.
5. **Config discipline.** Every §0 value is imported from `config/app.config.js` or read
   from Worker env. Grep-test: no §0 magic values inline anywhere.
6. **File cap ~300 lines.** Split modules rather than growing files.
7. **Commit per task**: `phase<N>: <short description>`.
8. **Blocked? Decide, log, continue.** Pick the simplest option consistent with §1–§2,
   add one line to `DECISIONS.md`, keep moving. Do not stop to ask questions; the human
   reviews commits.
9. **Secrets** only via `wrangler secret put` / `.dev.vars` (gitignored).
10. **`npm test` must be green at every commit** from Phase 2 onward.

---

## §5 Data contracts (exact — do not deviate)

### 5.1 Deck pack — `app/assets/packs/zh/deck.zh.json`

```json
{
  "schemaVersion": 1,
  "language": "zh",
  "packVersion": "2026.07.21",
  "generatedAt": "<ISO-8601>",
  "words": [
    {
      "id": "zh:传统:chuan2_tong3",
      "simp": "传统",
      "trad": "傳統",
      "pinyin": "chuántǒng",
      "pinyinNum": "chuan2 tong3",
      "defs": ["tradition", "traditional"],
      "band": 4,
      "sentences": [
        { "zh": "这是一个古老的传统。", "pinyin": "zhè shì yī gè gǔ lǎo de chuán tǒng.",
          "pinyinAuto": true, "en": "This is an old tradition.", "src": "tatoeba#123" }
      ]
    }
  ]
}
```

- `id` = `zh:<simp>:<pinyinNum with spaces → _>`. On collision append `~2`, `~3`…
  Ids are permanent; never regenerate them differently.
- `band` ∈ 1–9. If the source list merges bands 7–9, use `7`.
- `trad` omitted when identical to `simp`.

### 5.2 Dictionary — `app/assets/packs/zh/dict.zh.json`
Full CC-CEDICT, minimal per-entry arrays `[simp, trad, pinyinNum, defs[]]`. Loaded
lazily: first use of Browse imports it into the IndexedDB `dict` store (one-time, show
progress); all search is local afterwards.

### 5.3 Stroke data — `app/assets/packs/zh/strokes/<char>.json`
Copied by the pipeline from `node_modules/hanzi-writer-data/` for **only the unique
characters appearing in deck words** (~3–4k files). Client points hanzi-writer's
`charDataLoader` here. No CDN at runtime.

### 5.4 Card model (client-side)
- Modes: `REC` (hanzi→meaning), `LIS` (audio→meaning), `PROD` (meaning→typed pinyin),
  `SENT` (sentence), `WRITE` (stroke quiz).
- `cardId = <wordId>#<MODE>`.
- Introducing a word creates all five cards; non-REC cards start `suspended`.
- **Unlock:** non-REC cards unsuspend when the REC card's interval ≥ STAGGER_UNLOCK_DAYS.
- **Bury:** answering any card of word W sets `buriedUntil = next local midnight` on W's
  other cards.
- No sentences → no SENT card. No stroke data → no WRITE card.
- Split groups (one spelling taught as several words): the pipeline emits
  `splitGroup: [sibling ids]` on every member. Non-primary members get no LIS card.
- Unlocking is one-way: a later lapse on the REC card never re-suspends the word's
  other cards.

### 5.5 Review event (the atom of sync)
```json
{ "id": "<uuid v4>", "cardId": "zh:传统:chuan2_tong3#REC", "rating": 3,
  "ts": 1721556000000, "durMs": 4200 }
```
`rating`: 1=Again 2=Hard 3=Good 4=Easy. Events are immutable and append-only.
`rebuildFromEvents(deck, events)` must be deterministic: same inputs ⇒ identical states.

### 5.6 IndexedDB (database name = PROJECT_NAME, version 1)

| store | key | contents |
|---|---|---|
| `cards` | `cardId` | ts-fsrs card object verbatim + `suspended`, `buriedUntil` |
| `events` | `id` | review events + `synced: 0/1` |
| `customWords` | `id` | user-added words in deck-word shape, `band: 0`, `updatedAt`, `deleted` |
| `dict` | `simp` | imported dictionary entries |
| `meta` | `k` | sync cursor, gamify cache, settings |

---

## §6 Phase 0 — Scaffold

**Tasks**
1. `git init`; create the §3 tree; `.gitignore`: `node_modules`, `app/assets/bundle.js`,
   `packs/zh/data/`, `.dev.vars`, `.wrangler`.
2. `npm init -y`; install allowlisted deps.
3. `LICENSE` = full AGPL-3.0 text. `README.md` = §1 mission + placeholders. Empty
   `DECISIONS.md`.
4. `config/app.config.js`: one frozen exported object with every non-secret §0 value,
   grouped and commented as §0.
5. `package.json` scripts:
   `build` → `esbuild app/src/main.js --bundle --format=esm --outfile=app/assets/bundle.js`
   `dev` → `bash scripts/dev.sh` (build, then `wrangler dev` serving app/ + API together)
   `test` → `vitest run` · `deck` → `node packs/zh/build.mjs`
6. `worker/wrangler.toml`: name = WORKER_NAME, static assets dir → `../app`, D1 binding
   `DB` → D1_DB_NAME, today's `compatibility_date`.
7. Minimal `worker/src/index.js`: `/api/health` → `{"ok":true}`, else static assets.
   Minimal `app/index.html` shell loading `bundle.js`. One smoke vitest test.

**Acceptance**
- [ ] `npm run build` succeeds; `npm test` green.
- [ ] `npm run dev`: shell at `/`, `{"ok":true}` at `/api/health`, same origin.
- [ ] Grep confirms zero §0 literals outside `config/` and `wrangler.toml`.

---

## §7 Phase 1 — zh pack pipeline (data before UI)

`node packs/zh/build.mjs`: download sources into `packs/zh/data/` (skip when present),
parse, write every §5.1–5.3 artifact into `app/assets/packs/zh/`, plus `CREDITS.md` at
repo root and `report.txt` beside the data. Built packs are **committed** so deploys
never depend on third-party downloads; rebuilding is a manual local act.

**CC-CEDICT** (`lib/cedict.js`) — line format
`傳統 传统 [chuan2 tong3] /tradition/traditional/`; comments start `#`. Extract trad,
simp, pinyinNum, defs[]. When other defs exist, drop pure cross-references like
`variant of X`.

**Pinyin** (`lib/pinyin.js`, mirrored client-side as `app/src/zh/pinyin.js`)
- `numToMarks("chuan2 tong3") → "chuántǒng"`; tone 5 = no mark; `u:`/`v` → `ü`.
- Mark placement: syllable contains `a` → mark `a`; else `e` → mark `e`; else `ou` →
  mark `o`; else mark the **last** vowel.
- `syllableTone("hao3") → 3` for tone coloring.
- Required vectors: `hao3→hǎo`, `lu:4→lǜ`, `lv4→lǜ`, `xie4→xiè`, `liu2→liú`,
  `gui4→guì`, `er2→ér`, `nu:3→nǚ`, `xiong2→xióng`, `ma5→ma`.

**HSK** (`lib/hsk.js`): parse SRC_HSK30_BASE/SRC_HSK30_FILES → `word → band`. HSK words missing from
CEDICT: warnings in `report.txt`, never crashes.

**Tatoeba** (`lib/tatoeba.js`): from SRC_TATOEBA_BASE fetch Mandarin (`cmn`) sentences,
English sentences, and the links file — verify current filenames on the downloads page
and record them in a comment. Per word: candidates contain `simp` as substring, length ≤
SENTENCE_MAX_CHARS, have ≥1 linked English translation; keep the SENTENCES_PER_WORD
shortest. Sentence pinyin: greedy longest-match segmentation against CEDICT headwords,
unknown chars pass through, always `pinyinAuto: true`.

**Strokes**: unique chars across deck words → copy each `<char>.json` from
`hanzi-writer-data`; missing char → warning, word loses only its WRITE card.

**Credits** (`lib/credits.js`): generate `CREDITS.md` + `packs/zh/credits.json` covering
CC-CEDICT (CC BY-SA 4.0), Tatoeba (CC-BY), hanzi-writer + hanzi-writer-data (their
stated licenses), and the HSK list source — names, links, license identifiers.
Generated only; never hand-edited.

**Acceptance**
- [ ] `npm run deck` completes; `report.txt`: CEDICT entries > 100,000; every band
      non-empty; band 1 ≈ 300–600 words; zero duplicate ids.
- [ ] Printed spot-checks for 好, 学习, 谢谢, 传统 show correct tone marks.
- [ ] All pinyin vectors pass in vitest.
- [ ] `CREDITS.md` exists and names all four sources.

---

## §8 Phase 2 — Study engine (headless, fully tested)

Build `app/src/engine/` with **zero UI imports** so everything runs under vitest.

- `db.js`: thin hand-written IndexedDB wrapper (open, get/put/getAll, index queries, tx
  helper).
- `deck.js`: load + cache pack JSON, merge customWords, lookup by wordId.
- `srs.js`: wrap ts-fsrs, initialized with FSRS_TARGET_RETENTION.
  `gradeCard(card, rating, now)` → updated card. Store ts-fsrs output verbatim.
- `events.js`: append event (`crypto.randomUUID()`), flag `synced` later.
- `replay.js`: `rebuildFromEvents(deck, events)` — sort by `ts`, tie-break `id`, fold
  through `srs.js`, apply suspension/unlock/bury. This one function is the sync merge,
  the import path, and the correctness oracle.
- `queue.js`: today = (a) due, unlocked, unburied cards capped at MAX_REVIEWS_PER_DAY,
  ordered by due date; (b) up to NEW_CARDS_PER_DAY new REC cards ordered by band then
  deck order; interleave a new card roughly every 5 reviews.
  **Custom words go to the front of the new-card queue** (newest first), ahead of
  curriculum order: looking a word up and adding it is explicit user intent.
  NEW_CARDS_PER_DAY still caps the total.
- Grading adapters (pure functions; UI calls them):
  - **PROD**: normalize typed pinyin (lowercase, trim, collapse spaces, `v`→`ü`, accept
    with/without spaces), compare to `pinyinNum`; match → preselect Good, else Again;
    user may override before confirming.
  - **WRITE**: sum hanzi-writer mistakes across the word's characters:
    0 → Good, 1–3 → Hard, >3 or reveal → Again. Easy is manual-only.
  - **REC / LIS / SENT**: self-graded via the four buttons.

**Acceptance (vitest)**
- [ ] Queue respects NEW_CARDS_PER_DAY and MAX_REVIEWS_PER_DAY.
- [ ] Bury: after answering `W#REC`, `W#PROD` is absent from the same local day.
- [ ] Stagger: non-REC cards appear only once REC interval ≥ STAGGER_UNLOCK_DAYS.
- [ ] Determinism: ≥100 random reviews live, then `rebuildFromEvents` from scratch —
      final states identical.
- [ ] PROD normalizer accepts `"chuan2tong3"`, `" CHUAN2 TONG3 "`, `"lv4"`.

---

## §9 Phase 3 — PWA UI

Hash routes: `#home` (due count, streak, XP, start), `#review`, `#browse`, `#words`,
`#word/:id`, `#stats`, `#settings`, `#credits`. Space/tap flips; keys 1–4 grade.

**`#words` ("My Words")**: the user's own words, newest first — hanzi, coloured pinyin,
first definitions, and a status chip from live card state ("Up next", "Learning",
"Due <relative date>"), plus a remove action behind a confirm. Removing tombstones the
customWord (`deleted: 1`, so sync propagates it) and deletes its cards, but leaves its
events: the log is immutable, and `rebuildFromEvents` skips events whose word is gone.

| mode | front | back |
|---|---|---|
| REC | large simp | colored pinyin, defs, trad if differs, audio button |
| LIS | ▶ auto-plays sentence audio (fallback: word audio); nothing else visible | sentence + colored pinyin + en + defs |
| PROD | defs (EN) | typed input judged per §8, then full card |
| SENT | sentence in hanzi, target word highlighted | colored pinyin + en |
| WRITE | defs + pinyin + drawing canvas per char (hanzi-writer quiz; outline off after first char) | full card |

**`app/src/zh/` (the only language-specific UI code)**
- `tones.js`: wrap each syllable in `<span class="t1…t5">`; colors are CSS variables
  fed from config.
- `tts.js`: `speechSynthesis`; pick a voice whose lang starts with `zh` (prefer
  `zh-CN`), rate 0.9. No zh voice → one-time dismissible banner (install a Chinese voice
  at OS level); LIS fronts fall back to showing sentence text.
- `writer.js`: hanzi-writer wired to the local strokes path (§5.3).
- Split-group members: REC fronts append one hint line per sibling ("not <sibling
  pinyin>"). TTS buttons are suppressed on non-primary members — default TTS speaks
  the primary reading, and wrong audio is worse than none.

**Browse**: search the local `dict` store across simp/trad/pinyinNum/defs, cap 50
results; each result has "Add to my words" → customWord + its cards.

**PWA**: `manifest.webmanifest` (PROJECT_NAME, standalone, theme colors, simple
generated icons using the character 语); `sw.js` precaches only the app shell and
`deck.zh.json` (cache keyed on DECK_SCHEMA_VERSION + packVersion). The dictionary and
stroke files are runtime-cached on first use, cache-first thereafter; `/api/*` is
network-only.

**Design**: dark default + light toggle. Every color/spacing/type size is a CSS variable
in one `:root` block (tone colors from §0). System font stack; hanzi large on card
fronts (clamp ≈48–96px). All user-facing strings in `ui/strings.js` (the i18n seam).
No inline `style=` or `<script>` — §11's CSP forbids them.

**Settings**: sliders for new/day and max/day (defaults from config), theme, **Export
JSON** (guest mode included), **Import JSON** (validate → `rebuildFromEvents`), account
section placeholder (Phase 6), Danger Zone wiping local data after typed confirmation.

**Acceptance (manual checklist — print for the human)**
- [ ] Installable PWA; full review session works offline in guest mode after first load.
- [ ] All five modes render and grade; shortcuts work; WRITE canvas works by touch.
- [ ] Tone colors correct for 好 (t3), 传统 (t2 t3), 谢谢 (t4 t5).
- [ ] Browse finds 咖啡 via "kafei", "coffee", and 咖啡; adding it yields reviewable cards.
- [ ] Export → wipe → import restores identical state (compare a printed state hash).

---

## §10 Phase 4 — Gamification

All values from §0; all state derived from the event log (cache in `meta`, recomputed by
replay so import/sync can never desync XP).

- XP: XP_SHOWUP once per local day at first review; XP_PER_REVIEW per graded card;
  XP_PER_NEW_WORD when a word's REC card is first graded; XP_BAND_BADGE per band clear.
- Level: highest `n` with totalXP ≥ LEVEL_XP_FORMULA(n). Show progress to next level.
- Streak: a local day counts when its reviews ≥ STREAK_MIN_REVIEWS; streak = consecutive
  counting days ending today or yesterday. Local day = device timezone.
- Badges: per-band clears (BAND_CLEAR_RULE); milestones: streak 7/30/100/365, total
  reviews 1k/10k, all bands cleared.
- `#stats`: 12-week heatmap, totals, pass rate last 30 days (pass = rating ≥ 2),
  per-band progress bars.

**Acceptance (vitest)**: XP totals, level thresholds, streak edges (midnight rollover,
gap day, session crossing midnight), band-clear detection.

---

## §11 Phase 5 — Worker API

`worker/schema.sql` (idempotent):

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS review_events (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  ts INTEGER NOT NULL,
  dur_ms INTEGER,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_events_cursor ON review_events (user_id, received_at);
CREATE TABLE IF NOT EXISTS custom_words (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);
CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
```

**Sessions**: token = 32 random bytes (base64url, `crypto.getRandomValues`); store only
`SHA-256(token)`. Cookie: `pg_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/;
Max-Age=<SESSION_TTL_DAYS in seconds>`.

**OAuth**: server-side authorization-code flow with client secret. `state` = random
value in a short-lived (10 min) HttpOnly cookie, verified at callback. Login page posts
a Turnstile token first; server verifies it before returning the provider redirect URL.

**Endpoints**

| endpoint | auth | behavior |
|---|---|---|
| `GET /api/health` | none | `{"ok":true}` |
| `POST /api/auth/:provider/start` | Turnstile | body `{turnstileToken}` → verify, set state cookie, return `{redirectUrl}` |
| `GET /api/auth/:provider/callback` | state cookie | exchange code, upsert user, create session, redirect `/#settings` |
| `POST /api/auth/logout` | session | delete session row, clear cookie |
| `GET /api/me` | session | `{user:{id,displayName,provider}, cursor}` |
| `POST /api/sync/events` | session | body `{events:[≤SYNC_BATCH_MAX]}`; `INSERT OR IGNORE` by `(user_id,id)`; assign `received_at` strictly increasing per user (base = now ms, +1 per row, always > previous max); return `{cursor}` |
| `GET /api/sync/events?since=<cursor>` | session | events with `received_at > since`, asc, capped at SYNC_BATCH_MAX → `{events, cursor, more}` |
| `POST /api/sync/words` | session | upsert customWords, last-write-wins on `updated_at`, tombstones via `deleted=1` |
| `GET /api/sync/words?since=` | session | same cursor pattern on `updated_at` |
| `GET /api/export` | session | full JSON (user + events + words), `Content-Disposition: attachment` |
| `DELETE /api/me` | session | delete user (cascades), clear cookie |

**Middleware (`mw/`)**
- `security.js` (HTML responses): CSP `default-src 'self'; script-src 'self';
  style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none';
  frame-ancestors 'none'` + `X-Content-Type-Options: nosniff` +
  `Referrer-Policy: no-referrer`.
- `ratelimit.js`: fixed-window counters in `rate_limits`, key
  `<scope>:<id>:<windowStart>`; RATE_LIMIT_AUTH by IP on `/api/auth/*`, RATE_LIMIT_API
  by user elsewhere; 429 on exceed; opportunistic cleanup of expired rows.
- `turnstile.js`: server-side siteverify with the secret.

**Dev login**: when env `DEV_MODE=1` (only ever set in `.dev.vars`),
`POST /api/auth/dev` creates user `dev@local` + session. The router must hard-return
404 for this route whenever DEV_MODE is unset.

**`scripts/api-tests.sh`** (curl vs `npm run dev`, exits non-zero on any failure):
health → dev login (capture cookie) → push 3 events → push the same 3 again (count
stays 3) → pull since 0 (3 events + cursor) → pull since cursor (empty) → words upsert
+ LWW check → export non-empty → `DELETE /api/me` → `/api/me` now 401.

**Acceptance**
- [ ] `wrangler d1 execute <D1_DB_NAME> --local --file worker/schema.sql` applies clean
      twice.
- [ ] `scripts/api-tests.sh` fully green.
- [ ] With DEV_MODE unset, `/api/auth/dev` → 404.
- [ ] Security headers present on `/`; no inline script/style anywhere in `app/`.

---

## §12 Phase 6 — Sync client, deploy, docs

**`sync/client.js`**
- Triggers: app start (online + signed in), end of a review session, manual button.
- Push unsynced events in chunks ≤ SYNC_BATCH_MAX → mark synced. Pull since stored
  cursor → insert unknown ids → `rebuildFromEvents` → store new cursor. Custom words:
  LWW by `updatedAt`, tombstones respected.
- Guest → account migration is the same code path: first login pushes the entire local
  log. Zero special-case code.
- Settings gains: provider sign-in buttons + Turnstile widget, sync status + last sync
  time, sign out, delete account (typed confirmation → `DELETE /api/me` → wipe local).

**Deploy** `.github/workflows/deploy.yml`: on push to main → checkout, setup-node,
`npm ci`, `npm test`, `npm run build`, `wrangler deploy` using `CLOUDFLARE_API_TOKEN` +
`CLOUDFLARE_ACCOUNT_ID` repo secrets. The deck is committed, so CI never downloads
sources.

**Docs**
- `README.md`: mission (§1), features, quick start (clone → `npm ci` → `npm run dev`),
  architecture sketch, link to SELF_HOSTING.
- `SELF_HOSTING.md`: **its own config block at the top** (account id, worker name, D1
  name, URLs) that every numbered step references. Steps: create D1 → apply schema →
  register GitHub + Google OAuth apps (callback = PROD_URL +
  `/api/auth/<provider>/callback`) → create Turnstile widget → `wrangler secret put`
  each of `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `TURNSTILE_SECRET` → deploy.
- `CONTRIBUTING.md` stub: allowlist rule, config rule, phase/test gates.

**Acceptance**
- [ ] Fresh-clone test: clone → `npm ci` → `npm test` → `npm run dev` with zero
      undocumented steps.
- [ ] Two-browser-profile sync test via dev login: reviews on A appear on B after sync;
      state hashes identical.
- [ ] `wrangler deploy --dry-run` succeeds.

---

## §13 Human TODOs (things only the human can do)

1. Create REPO_URL on GitHub; push Phase 0.
2. `wrangler login`; create D1 (D1_DB_NAME); apply schema remotely; put secrets.
3. Register the GitHub and Google OAuth apps with the callback URLs above.
4. Create the Turnstile widget; site key goes in config, secret via wrangler.
5. Fill SRC_HSK30_BASE/SRC_HSK30_FILES with a verified HSK 3.0 list; sanity-check SRC_CEDICT_URL and the
   Tatoeba filenames; run `npm run deck` once locally and commit the pack.
6. First `wrangler deploy`; custom domain later.

---

## §14 Definition of done — v1

- [ ] A guest can install the PWA and learn fully offline: all five modes, gamification,
      export/import — no account, no network.
- [ ] Sign-in via GitHub or Google works; sync across two devices proven identical.
- [ ] Zero third-party requests at runtime except OAuth redirects (verify in the
      Network tab).
- [ ] `npm test` and `api-tests.sh` green; CREDITS complete; README + SELF_HOSTING
      accurate.
- [ ] AGPL LICENSE present; no secrets anywhere in git history.