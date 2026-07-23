#!/usr/bin/env bash
# End-to-end API checks (§11), run against a live `npm run dev`.
#
#   npm run dev            # in one terminal
#   bash scripts/api-tests.sh   # in another
#
# Exits non-zero on the first failure. Needs DEV_MODE="1" in .dev.vars, and the schema
# applied locally:
#   npx wrangler d1 execute polyglot-db --local --file worker/schema.sql --config worker/wrangler.toml
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:8787}"
JAR="$(mktemp)"
FAILURES=0

cleanup() { rm -f "$JAR" "$JAR.body"; }
trap cleanup EXIT

pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (expected $3, got $2)"; fi; }

# curl helper: prints the status, leaves the body in $JAR.body
req() {
  local method="$1" path="$2" data="${3:-}"
  if [ -n "$data" ]; then
    curl -sS -o "$JAR.body" -w '%{http_code}' -X "$method" \
      -H 'content-type: application/json' -b "$JAR" -c "$JAR" \
      --data "$data" "$BASE$path"
  else
    curl -sS -o "$JAR.body" -w '%{http_code}' -X "$method" -b "$JAR" -c "$JAR" "$BASE$path"
  fi
}

body() { cat "$JAR.body"; }
# Read one field out of the JSON body without needing jq.
field() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);const v=process.argv[1].split(".").reduce((a,k)=>a?.[k],o);console.log(v===undefined?"":v)}catch{console.log("")}})' "$1" < "$JAR.body"; }

# The auth limiter is 10 requests / 10 min / IP, and this script deliberately trips it.
# Clearing the local counters is what makes the suite re-runnable rather than a one-shot.
reset_limits() {
  npx wrangler d1 execute polyglot-db --local --config worker/wrangler.toml     --command "DELETE FROM rate_limits" >/dev/null 2>&1     && pass "local rate limits reset"     || fail "could not reset rate limits (is the schema applied?)"
}

echo "polyglot API tests — $BASE"
reset_limits

# ── health ───────────────────────────────────────────────────
check "health responds" "$(req GET /api/health)" 200
check "health says ok" "$(body)" '{"ok":true}'

# ── auth is required before anything else ────────────────────
check "me is 401 when signed out" "$(req GET /api/me)" 401
check "sync is 401 when signed out" "$(req GET /api/sync/events)" 401

# ── dev login ────────────────────────────────────────────────
check "dev login succeeds" "$(req POST /api/auth/dev '{}')" 200
check "session cookie was set" "$(grep -c pg_session "$JAR")" 1
check "me is 200 once signed in" "$(req GET /api/me)" 200
USER_ID="$(field user.id)"
[ -n "$USER_ID" ] && pass "me returns a user id ($USER_ID)" || fail "me returned no user id"

# ── push three events ────────────────────────────────────────
EVENTS='{"events":[
  {"id":"11111111-1111-4111-8111-111111111111","cardId":"zh:好:hao3#REC","rating":3,"ts":1721556000000,"durMs":4200},
  {"id":"22222222-2222-4222-8222-222222222222","cardId":"zh:好:hao3#PROD","rating":2,"ts":1721556001000},
  {"id":"33333333-3333-4333-8333-333333333333","cardId":"zh:学习:xue2_xi2#REC","rating":4,"ts":1721556002000}
]}'
check "push 3 events" "$(req POST /api/sync/events "$EVENTS")" 200
CURSOR="$(field cursor)"
check "push reports 3 stored" "$(field stored)" 3

# ── pushing the same batch again must not duplicate ──────────
check "push the same 3 again" "$(req POST /api/sync/events "$EVENTS")" 200
check "pull since 0" "$(req "GET" "/api/sync/events?since=0")" 200
COUNT="$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{console.log(JSON.parse(d).events.length)})' < "$JAR.body")"
check "still exactly 3 events" "$COUNT" 3
NEW_CURSOR="$(field cursor)"
[ -n "$NEW_CURSOR" ] && pass "pull returns a cursor ($NEW_CURSOR)" || fail "pull returned no cursor"

# ── the cursor is exhaustive ─────────────────────────────────
check "pull since cursor" "$(req GET "/api/sync/events?since=$NEW_CURSOR")" 200
EMPTY="$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{console.log(JSON.parse(d).events.length)})' < "$JAR.body")"
check "nothing new after the cursor" "$EMPTY" 0

# ── custom words, last write wins ────────────────────────────
check "upsert a word" "$(req POST /api/sync/words '{"words":[{"id":"zh:咖啡:ka1_fei1","simp":"咖啡","defs":["coffee"],"updatedAt":1000,"deleted":false}]}')" 200
check "stale write is ignored" "$(req POST /api/sync/words '{"words":[{"id":"zh:咖啡:ka1_fei1","simp":"咖啡","defs":["STALE"],"updatedAt":500,"deleted":false}]}')" 200
check "newer write wins" "$(req POST /api/sync/words '{"words":[{"id":"zh:咖啡:ka1_fei1","simp":"咖啡","defs":["FRESH"],"updatedAt":2000,"deleted":false}]}')" 200
check "pull words" "$(req GET "/api/sync/words?since=0")" 200
DEFS="$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const w=JSON.parse(d).words;console.log(w.length===1?w[0].defs[0]:"?"+w.length)})' < "$JAR.body")"
check "last write won" "$DEFS" FRESH

# ── export ───────────────────────────────────────────────────
check "export responds" "$(req GET /api/export)" 200
EXPORTED="$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);console.log(o.events.length+":"+o.customWords.length)})' < "$JAR.body")"
check "export carries the data" "$EXPORTED" "3:1"

# ── rate limiting is wired up ────────────────────────────────
check "auth rate limit eventually trips" "$(for _ in $(seq 1 12); do req POST /api/auth/dev '{}' >/dev/null; done; req POST /api/auth/dev '{}')" 429

# ── account deletion removes everything ──────────────────────
check "delete the account" "$(req DELETE /api/me)" 200
check "me is 401 afterwards" "$(req GET /api/me)" 401

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "all API checks passed"
  exit 0
fi
echo "$FAILURES check(s) failed"
exit 1
