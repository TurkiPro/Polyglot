/**
 * Build the client bundle and the service worker.
 *
 * A script rather than a bare esbuild call because the service worker needs two build-time
 * values injected: the pack version (which keys the deck cache — generated data, not config)
 * and a build id (a content hash of the shipped code, which keys the SHELL cache so a code
 * change actually reaches an installed client instead of being served the stale bundle forever).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { config } from '../config/app.config.js';

const LANG = config.pack.langPackV1;
const deckPath = new URL(`../app/assets/packs/${LANG}/deck.${LANG}.json`, import.meta.url);

/**
 * Read just the pack version out of the deck. The deck is megabytes, and a regex over
 * the head of the file avoids parsing all of it for one field.
 */
async function packVersion() {
  try {
    const head = (await readFile(deckPath)).subarray(0, 512).toString('utf8');
    return /"packVersion"\s*:\s*"([^"]+)"/.exec(head)?.[1] ?? 'dev';
  } catch {
    // No pack built yet — the shell still builds, it just caches under "dev".
    return 'dev';
  }
}

const version = await packVersion();

// Build the code the shell serves first — the bundle, the dict worker — then hash it into a
// build id, so the service worker keys its shell cache on the actual code it ships.
await build({
  entryPoints: ['app/src/main.js'],
  outfile: 'app/assets/bundle.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
});

// The dictionary-import Web Worker (F3), a module worker served at /assets/dict-worker.js.
await build({
  entryPoints: ['app/src/engine/dict-worker.js'],
  outfile: 'app/assets/dict-worker.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
});

/** A short hash over the shipped code + styles, so any UI/logic change mints a new shell cache. */
async function buildId() {
  const hash = createHash('sha256');
  for (const file of ['app/assets/bundle.js', 'app/assets/dict-worker.js', 'app/assets/styles.css']) {
    hash.update(await readFile(new URL(`../${file}`, import.meta.url)));
  }
  return hash.digest('hex').slice(0, 12);
}
const id = await buildId();

await build({
  entryPoints: ['app/src/sw.js'],
  outfile: 'app/sw.js',
  bundle: true,
  // A service worker is a classic script, not a module.
  format: 'iife',
  target: 'es2022',
  define: { __PACK_VERSION__: JSON.stringify(version), __BUILD_ID__: JSON.stringify(id) },
});

console.log(`built bundle.js, sw.js and dict-worker.js (pack ${version}, build ${id})`);
