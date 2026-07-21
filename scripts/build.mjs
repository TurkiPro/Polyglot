/**
 * Build the client bundle and the service worker.
 *
 * A script rather than a bare esbuild call because the service worker needs the built
 * pack's version injected: §9 keys its cache on DECK_SCHEMA_VERSION + packVersion, and
 * packVersion is generated data, not configuration.
 */
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

await build({
  entryPoints: ['app/src/main.js'],
  outfile: 'app/assets/bundle.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
});

await build({
  entryPoints: ['app/src/sw.js'],
  outfile: 'app/sw.js',
  bundle: true,
  // A service worker is a classic script, not a module.
  format: 'iife',
  target: 'es2022',
  define: { __PACK_VERSION__: JSON.stringify(version) },
});

console.log(`built bundle.js and sw.js (pack ${version})`);
