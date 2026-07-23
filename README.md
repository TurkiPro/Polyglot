# polyglot

Free, open-source language learning, built out of contempt for subscription language apps.
A local-first PWA with an FSRS spaced-repetition engine. v1 ships a Mandarin Chinese pack.

## Mission — non-negotiables

1. **Free forever.** No ads, no premium tier, no paywalled features. AGPL-3.0 so nobody
   can close-source it and sell it back.
2. **Zero telemetry.** No analytics, no tracking, no error reporters phoning home, no
   third-party scripts at runtime. None.
3. **No signup wall.** The full app works in guest mode, offline, with no account. An
   account exists for exactly one purpose: sync across devices.
4. **No stored passwords.** OAuth only. There is no password column anywhere, ever.
5. **The user owns their data.** Export/import works in guest mode (local JSON) and via
   API when signed in. Account deletion removes everything.
6. **Language-agnostic engine.** The core (SRS, queue, XP, sync, UI shell) never imports
   language-specific code. Chinese is a data pack plus a thin display layer.

## Status

Phases 0-5 complete: scaffold, the Chinese pack pipeline, the headless study engine,
the PWA, gamification, and the Worker API. See CHECKLIST.md for the manual browser checks Phase 3 needs.
See `CLAUDE.md` for the full build plan and `DECISIONS.md` for choices made along the way.

- [x] Phase 0 — scaffold
- [x] Phase 1 — zh pack pipeline
- [x] Phase 2 — study engine
- [x] Phase 3 — PWA UI
- [x] Phase 4 — gamification
- [x] Phase 5 — Worker API
- [ ] Phase 6 — sync client, deploy, docs

## Features

_Placeholder — filled in as phases land._

- Five review modes: recognition, listening, production, sentence, handwriting
- FSRS scheduling, entirely client-side
- Works offline; installable PWA
- Optional sync across devices via GitHub or Google sign-in

## Quick start

```sh
git clone https://github.com/TurkiPro/polyglot
cd polyglot
npm ci
npm run dev
```

Then open the URL Wrangler prints. `/api/health` returns `{"ok":true}` from the same
origin as the app.

Scripts:

| script | what it does |
|---|---|
| `npm run build` | bundle `app/src/main.js` → `app/assets/bundle.js` |
| `npm run dev` | build, then serve app + API together via `wrangler dev` |
| `npm test` | run the vitest suite |
| `npm run deck` | rebuild the Chinese pack from upstream sources |
| `npm run db:local` | apply the D1 schema to the local database |
| `npm run api-test` | end-to-end API checks against a running `npm run dev` |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  ONE Cloudflare Worker                              │
│  /*     → static assets (the PWA, from app/)        │
│  /api/* → JSON API (auth, sync, export) ──► D1      │
└─────────────────────────────────────────────────────┘
            ▲ same origin ⇒ no CORS, SameSite=Lax cookies
┌───────────┴───────────────────────────────┐
│  Browser (guest or signed in)             │
│  deck JSON + dict → cached by service worker
│  review state → IndexedDB                 │
│  FSRS runs entirely client-side           │
└───────────────────────────────────────────┘
```

The client is the source of truth. Sync is an append-only log of immutable review
events; card state is a pure function of that log, so device merges are a set union and
conflicts cannot exist.

## Self-hosting

See `SELF_HOSTING.md` _(added in Phase 6)_.

## License

[AGPL-3.0](LICENSE).
