#!/usr/bin/env node
/**
 * End-to-end API checks (§11), run against a live `npm run dev`.
 *
 *   npm run dev                    # in one terminal
 *   node scripts/api-tests.mjs    # in another
 *
 * Node port of the retired bash suite — same checks, same order, plus the session-cap
 * check — so it runs identically in PowerShell, cmd, and POSIX shells. Exits non-zero
 * if any check fails. Needs DEV_MODE="1" in worker/.dev.vars and the schema applied
 * (`npm run db:local`).
 */
import { spawnSync } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';
let failures = 0;
const jar = new Map(); // cookie name → value

const pass = (msg) => console.log(`  ok   ${msg}`);
const fail = (msg) => { console.log(`  FAIL ${msg}`); failures += 1; };
const check = (msg, got, want) =>
  String(got) === String(want) ? pass(msg) : fail(`${msg} (expected ${want}, got ${got})`);

/** Fetch with a cookie jar; returns { status, body } with body JSON-parsed when possible. */
async function req(method, path, data) {
  const headers = {};
  if (data !== undefined) headers['content-type'] = 'application/json';
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: data !== undefined ? JSON.stringify(data) : undefined,
    redirect: 'manual',
  });

  for (const cookie of res.headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1);
    if (value === '') jar.delete(name);
    else jar.set(name, value);
  }

  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* not JSON — keep the text */ }
  return { status: res.status, body };
}

/** Run `wrangler d1 execute` against the local database. */
/**
 * Run one SQL statement against the local D1.
 *
 * The statement goes through a temp file rather than `--command`. Windows needs
 * `shell: true` to run `npx.cmd`, and with a shell the arguments are concatenated
 * unescaped — so `--command "SELECT 1 AS n"` arrived as three separate arguments and
 * wrangler rejected it. A file path has no spaces to lose.
 */
function d1(command) {
  const file = join(tmpdir(), `polyglot-d1-${process.pid}-${Date.now()}.sql`);
  writeFileSync(file, command);
  try {
    const result = spawnSync(
      'npx',
      ['wrangler', 'd1', 'execute', 'polyglot-db', '--local', '--json',
        '--config', 'worker/wrangler.toml', '--file', file],
      { encoding: 'utf8', shell: process.platform === 'win32' },
    );
    if (result.status !== 0) return null;
    try { return JSON.parse(result.stdout)[0].results; } catch { return null; }
  } finally {
    try { unlinkSync(file); } catch { /* already gone */ }
  }
}

console.log(`polyglot API tests — ${BASE}`);

// The auth limiter is deliberately tripped below; clearing local counters keeps the
// suite re-runnable rather than a one-shot.
if (d1('DELETE FROM rate_limits') !== null) pass('local rate limits reset');
else fail('could not reset rate limits (is the schema applied?)');

// ── health ───────────────────────────────────────────────────
let r = await req('GET', '/api/health');
check('health responds', r.status, 200);
check('health says ok', JSON.stringify(r.body), '{"ok":true}');

// ── auth is required before anything else ────────────────────
check('me is 401 when signed out', (await req('GET', '/api/me')).status, 401);
check('sync is 401 when signed out', (await req('GET', '/api/sync/events')).status, 401);

// ── dev login ────────────────────────────────────────────────
check('dev login succeeds', (await req('POST', '/api/auth/dev', {})).status, 200);
check('session cookie was set', jar.has('pg_session'), true);
r = await req('GET', '/api/me');
check('me is 200 once signed in', r.status, 200);
const userId = r.body?.user?.id ?? '';
if (userId) pass(`me returns a user id (${userId})`);
else fail('me returned no user id');

// ── push three events ────────────────────────────────────────
const EVENTS = {
  events: [
    { id: '11111111-1111-4111-8111-111111111111', cardId: 'zh:好:hao3#REC', rating: 3, ts: 1721556000000, durMs: 4200 },
    { id: '22222222-2222-4222-8222-222222222222', cardId: 'zh:好:hao3#PROD', rating: 2, ts: 1721556001000 },
    { id: '33333333-3333-4333-8333-333333333333', cardId: 'zh:学习:xue2_xi2#REC', rating: 4, ts: 1721556002000 },
  ],
};
r = await req('POST', '/api/sync/events', EVENTS);
check('push 3 events', r.status, 200);
check('push reports 3 stored', r.body.stored, 3);

// ── pushing the same batch again must not duplicate ──────────
check('push the same 3 again', (await req('POST', '/api/sync/events', EVENTS)).status, 200);
r = await req('GET', '/api/sync/events?since=0');
check('pull since 0', r.status, 200);
check('still exactly 3 events', r.body.events.length, 3);
const cursor = r.body.cursor;
if (cursor) pass(`pull returns a cursor (${cursor})`);
else fail('pull returned no cursor');

// ── the cursor is exhaustive ─────────────────────────────────
r = await req('GET', `/api/sync/events?since=${cursor}`);
check('pull since cursor', r.status, 200);
check('nothing new after the cursor', r.body.events.length, 0);

// ── hardened validation rejects garbage without failing the batch ──
r = await req('POST', '/api/sync/events', {
  events: [
    { id: 'x'.repeat(65), cardId: 'zh:好:hao3#REC', rating: 3, ts: 1721556000000 },
    { id: '44444444-4444-4444-8444-444444444444', cardId: 'c'.repeat(121), rating: 3, ts: 1721556000000 },
    { id: '55555555-5555-4555-8555-555555555555', cardId: 'zh:好:hao3#REC', rating: 3, ts: Date.now() + 8 * 86400000 },
    { id: '66666666-6666-4666-8666-666666666666', cardId: 'zh:好:hao3#REC', rating: 3, ts: 1721556000000, durMs: 4000000 },
  ],
});
check('oversized/garbage events are accepted as a request', r.status, 200);
check('…but every one is rejected', r.body.rejected, 4);
check('…and none stored', r.body.stored, 0);

// ── custom words, last write wins ────────────────────────────
const word = (defs, updatedAt) =>
  ({ words: [{ id: 'zh:咖啡:ka1_fei1', simp: '咖啡', defs: [defs], updatedAt, deleted: false }] });
check('upsert a word', (await req('POST', '/api/sync/words', word('coffee', 1000))).status, 200);
check('stale write is ignored', (await req('POST', '/api/sync/words', word('STALE', 500))).status, 200);
check('newer write wins', (await req('POST', '/api/sync/words', word('FRESH', 2000))).status, 200);
r = await req('GET', '/api/sync/words?since=0');
check('pull words', r.status, 200);
check('last write won', r.body.words.length === 1 ? r.body.words[0].defs[0] : `?${r.body.words.length}`, 'FRESH');

// ── export ───────────────────────────────────────────────────
r = await req('GET', '/api/export');
check('export responds', r.status, 200);
check('export carries the data', `${r.body.events.length}:${r.body.customWords.length}`, '3:1');

// ── rate limiting is wired up ────────────────────────────────
for (let i = 0; i < 12; i += 1) await req('POST', '/api/auth/dev', {});
check('auth rate limit eventually trips', (await req('POST', '/api/auth/dev', {})).status, 429);

// ── session cap held through all those logins ────────────────
const rows = d1("SELECT COUNT(*) AS n FROM sessions WHERE user_id = 'dev:local'");
const live = rows?.[0]?.n;
if (live === undefined || live === null) fail('could not count sessions');
else check('sessions per user stay capped (≤ 10)', live <= 10, true);

// ── account deletion removes everything ──────────────────────
check('delete the account', (await req('DELETE', '/api/me')).status, 200);
check('me is 401 afterwards', (await req('GET', '/api/me')).status, 401);

console.log();
if (failures === 0) {
  console.log('all API checks passed');
  process.exit(0);
}
console.log(`${failures} check(s) failed`);
process.exit(1);
