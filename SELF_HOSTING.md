# Self-hosting polyglot

polyglot is one Cloudflare Worker: it serves the app and the API from a single origin,
with one D1 database behind it. A deploy is `wrangler deploy`.

Everything below refers to the values in this block. Fill it in once, then follow the
numbered steps.

## Your configuration

| name | where it goes | your value |
|---|---|---|
| `ACCOUNT_ID` | Cloudflare account id (dashboard → Workers → right sidebar) | |
| `WORKER_NAME` | `worker/wrangler.toml` → `name` | `polyglot` |
| `D1_NAME` | `worker/wrangler.toml` → `database_name` | `polyglot-db` |
| `D1_ID` | `worker/wrangler.toml` → `database_id` | filled in at step 2 |
| `ORIGIN` | where the app answers | `https://WORKER_NAME.ACCOUNT_SUBDOMAIN.workers.dev` |

`ORIGIN` matters more than it looks: it is the base of every OAuth callback URL, and a
mismatch is the single most common reason sign-in fails.

---

## 1. Get it running locally first

```sh
git clone https://github.com/TurkiPro/polyglot
cd polyglot
npm ci
npm run db:local     # apply worker/schema.sql to a local D1
npm run dev
```

Open the URL wrangler prints. The app works fully at this point — guest mode needs no
account, no database and no network (§1.3). Sign-in is the only thing that needs the rest
of this document.

To exercise the API locally, copy `worker/.dev.vars.example` to `worker/.dev.vars`, keep
`DEV_MODE = "1"`, and run:

```sh
npm run api-test
```

> `worker/.dev.vars` must sit next to `wrangler.toml`. At the repository root it is
> silently ignored.

---

## 2. Create the database

```sh
npx wrangler login
npx wrangler d1 create D1_NAME
```

Copy the `database_id` it prints into `worker/wrangler.toml` as `D1_ID`, then create the
tables — locally and remotely:

```sh
npm run db:local
npx wrangler d1 execute D1_NAME --remote --file worker/schema.sql --config worker/wrangler.toml
```

`worker/schema.sql` is idempotent; running it again is safe and is how you apply future
migrations.

---

## 3. Deploy once, to learn your origin

```sh
npm run build
npx wrangler deploy --config worker/wrangler.toml
```

Wrangler prints the deployed URL. That is `ORIGIN`. Put it in the table above, and in
`config/app.config.js` under `identity.prodUrl`.

At this point the app is live and fully usable in guest mode. Sign-in is not configured
yet, and the Settings screen will say so rather than offering broken buttons.

---

## 4. Register the OAuth apps

Sign-in is OAuth only — polyglot has no password column and never will (§1.4).

**GitHub** — Settings → Developer settings → OAuth Apps → New OAuth App:

- Homepage URL: `ORIGIN`
- Authorization callback URL: `ORIGIN/api/auth/github/callback`

**Google** — Cloud Console → APIs & Services → Credentials → Create OAuth client ID →
Web application:

- Authorised JavaScript origin: `ORIGIN`
- Authorised redirect URI: `ORIGIN/api/auth/google/callback`

You may configure one, both, or neither. `GET /api/auth/providers` reports whichever have
credentials set, and the Settings screen only offers those.

---

## 5. Create a Turnstile widget

Cloudflare dashboard → Turnstile → Add site, with `ORIGIN` as the hostname.

- The **site key** is public: put it in `config/app.config.js` under
  `auth.turnstile.siteKey`.
- The **secret key** goes into Wrangler at step 6.

Turnstile is the one third-party script polyglot loads, and only on the Settings screen
when someone presses a sign-in button — see the note at the end.

---

## 6. Set the secrets

Secrets never go in a file that git can see.

```sh
npx wrangler secret put GITHUB_CLIENT_ID     --config worker/wrangler.toml
npx wrangler secret put GITHUB_CLIENT_SECRET --config worker/wrangler.toml
npx wrangler secret put GOOGLE_CLIENT_ID     --config worker/wrangler.toml
npx wrangler secret put GOOGLE_CLIENT_SECRET --config worker/wrangler.toml
npx wrangler secret put TURNSTILE_SECRET     --config worker/wrangler.toml
```

Never set `DEV_MODE` in production. It enables a password-free login route, which the
router hard-404s whenever the variable is absent.

---

## 7. Deploy again, and check

```sh
npm run build
npx wrangler deploy --config worker/wrangler.toml
```

Then, at `ORIGIN`:

- Settings offers the providers you configured.
- Signing in returns you to `#settings`, showing your name.
- "Sync now" reports what it sent and received.
- Reviewing on a second browser profile and syncing both leaves identical progress.

---

## Continuous deployment (optional)

`.github/workflows/deploy.yml` deploys on every push to `main`, after `npm test` passes.
It needs two repository secrets:

- `CLOUDFLARE_API_TOKEN` — a token with *Edit Cloudflare Workers* permission
- `CLOUDFLARE_ACCOUNT_ID` — `ACCOUNT_ID` from the table above

The deck, the dictionary and the font subsets are committed, so CI never contacts
CC-CEDICT, Tatoeba or Google Fonts. A deploy depends on this repository and nothing else.

---

## Costs

polyglot fits inside Cloudflare's free tier for personal use: Workers requests, D1 rows
and static asset serving. There is nothing else to pay for, because there is nothing else
running — no analytics, no error reporter, no queue, no cron.

---

## A note on Turnstile and third parties

polyglot promises zero third-party requests at runtime (§1.2). Turnstile is the single
exception, and it is bounded deliberately:

- the widget script loads **only** when `auth.turnstile.siteKey` is set, **and** only when
  someone presses a sign-in button on the Settings screen;
- the Worker widens its Content-Security-Policy to allow `challenges.cloudflare.com`
  **only** when `TURNSTILE_SECRET` is configured.

Leave both unset and the deployment is exactly as third-party-free as guest mode — but
note that `POST /api/auth/<provider>/start` then refuses every login, because Turnstile
verification fails closed rather than open. Configure both, or expect sign-in to be
unavailable.

Studying — reviews, browsing, stats, offline use — never loads it under any configuration.
