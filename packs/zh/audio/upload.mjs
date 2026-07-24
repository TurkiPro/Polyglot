#!/usr/bin/env node
/**
 * Upload the audio pack to R2 (Phase 8 §3).
 *
 * Idempotent by content hash: a filename *is* its hash, so anything already in the bucket
 * is already correct and gets skipped. Re-running after a partial upload resumes.
 *
 *   node packs/zh/audio/upload.mjs
 *   node packs/zh/audio/upload.mjs --dry-run
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = join(ROOT, 'packs/zh/audio/out');
const MANIFEST = join(ROOT, 'app/assets/packs/zh/audio-manifest.json');
const BUCKET = 'polyglot-audio';
const CONFIG = 'worker/wrangler.toml';

const dryRun = process.argv.includes('--dry-run');

if (!existsSync(MANIFEST)) {
  console.error('No manifest. Run packs/zh/audio/generate.py first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const files = [...new Set(Object.values(manifest.items).map((entry) => entry.file))];

console.log(`${files.length} unique files, ${(manifest.bytes / 1_048_576).toFixed(1)} MB`);

/** What the bucket already holds, so a resumed upload skips it. */
function alreadyThere() {
  const result = spawnSync(
    'npx',
    ['wrangler', 'r2', 'object', 'list', BUCKET, '--config', CONFIG],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  );
  if (result.status !== 0) return new Set();
  try {
    const parsed = JSON.parse(result.stdout);
    return new Set((parsed.objects ?? []).map((object) => object.key));
  } catch {
    return new Set();
  }
}

const present = alreadyThere();
let uploaded = 0;
let skipped = 0;
let failed = 0;

for (const [index, file] of files.entries()) {
  if (present.has(file)) {
    skipped += 1;
    continue;
  }

  const path = join(OUT, file);
  if (!existsSync(path)) {
    console.error(`  missing locally: ${file}`);
    failed += 1;
    continue;
  }

  if (dryRun) {
    uploaded += 1;
    continue;
  }

  const result = spawnSync(
    'npx',
    ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${file}`,
      '--file', path, '--content-type', 'audio/ogg', '--config', CONFIG],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  );

  if (result.status === 0) uploaded += 1;
  else {
    console.error(`  failed: ${file} — ${(result.stderr ?? '').slice(0, 160)}`);
    failed += 1;
  }

  if ((index + 1) % 100 === 0) console.log(`  ${index + 1}/${files.length}`);
}

const bytes = files.reduce((sum, file) => {
  const path = join(OUT, file);
  return sum + (existsSync(path) ? statSync(path).size : 0);
}, 0);

console.log(`${dryRun ? 'would upload' : 'uploaded'} ${uploaded}, skipped ${skipped}, failed ${failed}`);
console.log(`local pack: ${(bytes / 1_048_576).toFixed(1)} MB across ${readdirSync(OUT).length} files`);
process.exit(failed > 0 ? 1 : 0);
