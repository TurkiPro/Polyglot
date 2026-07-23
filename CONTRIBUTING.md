# Contributing

polyglot is small on purpose. The rules below are what keep it that way; `CLAUDE.md` is
the full specification, and `DECISIONS.md` records every choice that was not obvious.

## Three rules that are not negotiable

**1. The dependency allowlist.** Runtime: `ts-fsrs`, `hanzi-writer`, `hanzi-writer-data`.
Dev: `esbuild`, `vitest`, `wrangler`, `fake-indexeddb`, `jsdom`, `subset-font`. Nothing
else without discussion first. Write the small utility instead — `packs/zh/lib/bunzip2.js`
exists because Node cannot read bzip2 and a decompressor is 300 lines.

No frontend framework, no CSS framework, no TypeScript, no icon library. These are not
preferences; a framework would change zero pixels and add a supply chain.

**2. Configuration lives in one place.** Every tunable value is in
`config/app.config.js` (§0 of CLAUDE.md). Code imports it; it does not restate it. The
only exceptions are declarative manifests whose formats require literals —
`package.json`, `wrangler.toml`, `manifest.webmanifest`.

**3. `npm test` is green at every commit.** Not "before the PR" — every commit.

## Working on it

```sh
npm ci
npm run db:local    # once, for the API
npm run dev
npm test
```

- `npm run api-test` runs the API checks against a live `npm run dev`.
- `npm run deck` rebuilds the Chinese pack. You rarely need it: the pack is committed, and
  rebuilding is a deliberate act that should be its own commit.
- Files stay around 300 lines. Split rather than grow.
- Plain JS with JSDoc types.

## Tests

Behaviour that can be tested without a browser is tested without one. `jsdom` is opted
into per file with a `@vitest-environment jsdom` docblock, never globally, and only for
asserting rendered DOM.

A bug fix starts with a failing test. If a test cannot express it — install prompts, real
speech synthesis, touch drawing — it goes in `CHECKLIST.md` instead, and stays honest
about being unverified.

## What belongs here, and what does not

polyglot is a vocabulary acquisition machine. It is not a grammar course, a chatbot, or a
place to put an AI feature. It has no ads, no premium tier, and no telemetry — not
"anonymised" telemetry, none. If a change would add a network request that the user did
not ask for, it does not belong.

New languages are welcome, and are meant to be a data pack plus a thin display layer: the
engine must not import anything language-specific.

## Licence

AGPL-3.0. Contributions are accepted under the same terms — including the part that says
anyone running a modified copy as a service has to publish their changes.
