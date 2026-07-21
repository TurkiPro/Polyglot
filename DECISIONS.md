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
