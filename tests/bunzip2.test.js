import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bunzip2 } from '../packs/zh/lib/bunzip2.js';

/**
 * Fixtures were produced by the reference implementation (`bzip2 1.0.8`) and committed,
 * so this suite verifies our decoder against real bzip2 output without needing the
 * binary installed.
 */
const fixture = (name) => new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));

describe('bunzip2', () => {
  const cases = [
    ['f-short', 'short ascii'],
    ['f-runs', 'long runs (RLE1)'],
    ['f-utf8', 'utf-8 chinese'],
    ['f-multi', 'multi-block (bzip2 -1)'],
  ];

  it.each(cases)('decompresses %s — %s', (name) => {
    const got = bunzip2(fixture(`${name}.txt.bz2`));
    expect(Buffer.from(got).equals(Buffer.from(fixture(`${name}.txt`)))).toBe(true);
  });

  it('checks block CRCs — a corrupted payload is rejected, not silently wrong', () => {
    const bad = fixture('f-utf8.txt.bz2');
    bad[bad.length - 12] ^= 0xff;
    expect(() => bunzip2(bad)).toThrow();
  });

  it('rejects input that is not a bzip2 stream', () => {
    expect(() => bunzip2(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(/not a bzip2 stream/);
  });
});
