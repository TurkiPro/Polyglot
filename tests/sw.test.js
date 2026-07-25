/**
 * Service-worker cache keying (§9): the fix that makes code changes actually reach clients.
 *
 * The bug this guards against: keying the shell cache on the pack version, so a code-only change
 * never minted a new cache and installed clients were served the stale bundle forever. The shell
 * (code + UI) must key on the build id; the multi-megabyte pack must key on the pack version so a
 * UI fix never re-downloads it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const sw = read('app/src/sw.js');
const buildScript = read('scripts/build.mjs');

describe('service worker cache keys (§9)', () => {
  it('keys the shell cache on the build id, not the pack version', () => {
    expect(sw).toMatch(/SHELL_CACHE\s*=\s*`[^`]*\$\{BUILD_ID\}`/);
    expect(sw).not.toMatch(/SHELL_CACHE\s*=\s*`[^`]*\$\{PACK_VERSION\}`/);
  });

  it('keeps the big pack in its own version-keyed cache', () => {
    expect(sw).toMatch(/PACK_CACHE\s*=\s*`[^`]*\$\{PACK_VERSION\}`/);
    // The deck rides the pack cache; the bundle rides the shell cache.
    expect(sw).toMatch(/PACK_PRECACHE[\s\S]*deck\./);
    expect(sw).toMatch(/SHELL_PRECACHE[\s\S]*\/assets\/bundle\.js/);
  });

  it('retires every stale cache except the three it keeps', () => {
    expect(sw).toMatch(/keep\s*=\s*new Set\(\[SHELL_CACHE, PACK_CACHE, RUNTIME_CACHE\]\)/);
  });

  it('the build injects a content-hash build id into the worker', () => {
    expect(buildScript).toMatch(/__BUILD_ID__/);
    expect(buildScript).toMatch(/createHash\('sha256'\)/);
  });
});
