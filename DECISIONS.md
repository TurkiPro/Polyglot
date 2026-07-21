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
- Phase 3: the service worker precaches **only** the app shell and `deck.zh.json`. The
  10 MB dictionary and the 3,087 stroke files are runtime-cached on first use, cache-first
  thereafter. Precaching everything would make first load ~29 MB for every new user.
  Now written into §9 of CLAUDE.md.
