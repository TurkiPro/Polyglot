# Decisions

One line per decision made while implementing, per §4.8 of `CLAUDE.md`.

- Phase 0: declarative manifests (`package.json`, `worker/wrangler.toml`,
  `app/manifest.webmanifest`) may restate identity values from §0 because their formats
  require literals; all executable code imports `config/app.config.js` instead.
- Phase 0: added `auth.turnstile.siteKey` (empty placeholder) to the config — §13.4 says
  the public site key lives in config; the secret stays in Wrangler.
- Phase 0: `config/app.config.js` groups §0 values into nested objects rather than flat
  SCREAMING_CASE constants; grouping matches §0's own section headings.
