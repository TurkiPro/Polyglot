#!/usr/bin/env node
/**
 * Upload the audio pack to R2 via the S3-compatible API (Phase 8 §3).
 *
 * `wrangler r2 object put` boots wrangler once per file (~4 s here), so 16k files would be
 * an ~18-hour upload. The S3 API signs requests in-process and uploads them concurrently,
 * doing the whole pack in minutes. No new dependency — SigV4 is signed with node:crypto.
 *
 * Needs R2 S3 credentials: Cloudflare dashboard → R2 → Manage R2 API Tokens → Create API
 * Token → Object Read & Write. That yields an Access Key ID and Secret Access Key. Set:
 *
 *   R2_ACCOUNT_ID          your Cloudflare account id
 *   R2_ACCESS_KEY_ID       from the R2 API token
 *   R2_SECRET_ACCESS_KEY   from the R2 API token
 *
 *   node packs/zh/audio/upload.mjs
 *   node packs/zh/audio/upload.mjs --dry-run
 *
 * Idempotent: filenames are content hashes, so the bucket's existing keys are listed once
 * and skipped. A re-run after an interrupted upload resumes; --force re-uploads everything.
 */
import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = join(ROOT, 'packs/zh/audio/out');
const MANIFEST = join(ROOT, 'app/assets/packs/zh/audio-manifest.json');
const WRANGLER = join(ROOT, 'worker/wrangler.toml');

const CONCURRENCY = 24;
const REGION = 'auto';
const SERVICE = 's3';
const EMPTY_HASH = createHash('sha256').update('').digest('hex');

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

const ACCOUNT = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
if (!ACCOUNT || !ACCESS_KEY || !SECRET_KEY) {
  console.error('Missing R2 credentials. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and');
  console.error('R2_SECRET_ACCESS_KEY (see the header of this file).');
  process.exit(1);
}

/** Bucket name from wrangler.toml, so it stays single-source with the Worker binding. */
const BUCKET = (readFileSync(WRANGLER, 'utf8').match(/bucket_name\s*=\s*"([^"]+)"/) ?? [])[1];
if (!BUCKET) {
  console.error('Could not read bucket_name from worker/wrangler.toml');
  process.exit(1);
}

const HOST = `${ACCOUNT}.r2.cloudflarestorage.com`;
const ENDPOINT = `https://${HOST}`;

if (!existsSync(MANIFEST)) {
  console.error('No manifest. Run packs/zh/audio/generate.py first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const files = [...new Set(Object.values(manifest.items).map((entry) => entry.file))];

/** Encode a string per RFC 3986, as SigV4 canonicalisation requires. */
const uriEncode = (str, encodeSlash = true) =>
  str.replace(/[^A-Za-z0-9_.~-]/g, (ch) =>
    ch === '/' && !encodeSlash ? '/' : '%' + ch.charCodeAt(0).toString(16).toUpperCase(),
  );

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/**
 * Sign an S3 request (SigV4) and return the headers to send. `path` is the raw object path;
 * `query` is a pre-sorted canonical query string (empty for a PUT).
 */
function signedHeaders(method, path, query, payloadHash) {
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = now.slice(0, 8);
  const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;

  const headers = {
    host: HOST,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': now,
  };
  const signed = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join('');

  const canonicalRequest = [
    method,
    uriEncode(path, false),
    query,
    canonicalHeaders,
    signed,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    now,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const kDate = hmac(`AWS4${SECRET_KEY}`, date);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const signature = hmac(hmac(kService, 'aws4_request'), stringToSign).toString('hex');

  headers.Authorization =
    `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${scope}, ` +
    `SignedHeaders=${signed}, Signature=${signature}`;
  return headers;
}

/** A canonical query string: params URI-encoded and sorted by key, as SigV4 requires. */
function canonicalQuery(params) {
  return Object.keys(params)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(params[k])}`)
    .join('&');
}

/** Every key already in the bucket, via paginated ListObjectsV2 — so a resume skips them. */
async function existingKeys() {
  const keys = new Set();
  let token = '';
  do {
    const params = { 'list-type': '2', 'max-keys': '1000' };
    if (token) params['continuation-token'] = token;
    const query = canonicalQuery(params);
    const headers = signedHeaders('GET', `/${BUCKET}`, query, EMPTY_HASH);
    const res = await fetch(`${ENDPOINT}/${BUCKET}?${query}`, { headers });
    if (!res.ok) throw new Error(`list failed: ${res.status} ${await res.text()}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.add(m[1]);
    token = (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/) ?? [])[1] ?? '';
  } while (token);
  return keys;
}

async function putObject(file) {
  const body = readFileSync(join(OUT, file));
  const payloadHash = createHash('sha256').update(body).digest('hex');
  const path = `/${BUCKET}/${file}`;
  const headers = signedHeaders('PUT', path, '', payloadHash);
  headers['content-type'] = 'audio/ogg';

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${ENDPOINT}${path}`, { method: 'PUT', headers, body });
    if (res.ok) return;
    if (res.status < 500 || attempt === 2) {
      throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
}

/** Run `worker` over `items` with at most `CONCURRENCY` in flight. */
async function pool(items, worker) {
  let index = 0;
  let done = 0;
  const runNext = async () => {
    while (index < items.length) {
      await worker(items[index++]);
      if (++done % 500 === 0) console.log(`  ${done}/${items.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, runNext));
}

const totalBytes = files.reduce(
  (sum, file) => sum + (existsSync(join(OUT, file)) ? statSync(join(OUT, file)).size : 0),
  0,
);
console.log(`${files.length} unique files, ${(totalBytes / 1_048_576).toFixed(1)} MB → ${BUCKET}`);

const missing = files.filter((file) => !existsSync(join(OUT, file)));
if (missing.length) {
  console.error(`${missing.length} files missing locally (run generate.py). First: ${missing[0]}`);
  process.exit(1);
}

const present = force ? new Set() : await existingKeys();
const todo = files.filter((file) => !present.has(file));
console.log(`${present.size} already in bucket, ${todo.length} to upload${dryRun ? ' (dry run)' : ''}`);

if (!dryRun && todo.length) {
  const failures = [];
  await pool(todo, async (file) => {
    try {
      await putObject(file);
    } catch (err) {
      failures.push(`${file}: ${err.message}`);
    }
  });
  if (failures.length) {
    console.error(`\n${failures.length} failed. First few:`);
    failures.slice(0, 5).forEach((f) => console.error(`  ${f}`));
    process.exit(1);
  }
}

console.log(`done — ${dryRun ? 'would upload' : 'uploaded'} ${todo.length}, ${present.size} skipped`);
console.log(`local pack: ${readdirSync(OUT).length} files`);
