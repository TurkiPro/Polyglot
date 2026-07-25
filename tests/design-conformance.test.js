/**
 * Design-consistency guards (Phase 10 C, audit D1–D3).
 *
 * These are the automated half of the conformance audit: the theme fallbacks must track the
 * live palette, durations must go through the `--dur` token, and `--glow` must appear only in
 * the sanctioned surfaces. Each one closes a way for the design system to drift silently.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NIGHT_MARKET_FALLBACK } from '../app/src/ui/theme.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const css = read('app/assets/styles.css');

/** The declarations inside a `:root[...]` (or `:root`) block, as { '--name': 'value' }. */
function themeVars(selector) {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  const vars = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[name] = value.trim();
  return vars;
}

/* ── D1: the writer's colour fallbacks track the night-market theme ── */
describe('theme fallbacks (D1)', () => {
  it('NIGHT_MARKET_FALLBACK matches the committed dark-theme values', () => {
    const dark = themeVars(':root[data-theme="dark"]');
    for (const [name, value] of Object.entries(NIGHT_MARKET_FALLBACK)) {
      expect(dark[name], `${name} fallback must equal the dark theme's value`).toBe(value);
    }
  });
});

/* ── D2: every duration flows through --dur, so reduced-motion can zero it ── */
describe('durations are tokenised (D2)', () => {
  it('has no hardcoded millisecond value outside the --dur token definition', () => {
    const offenders = css
      .split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => /\d+ms/.test(line) && !/--dur\s*:/.test(line));
    expect(offenders, `hardcoded ms must become var(--dur) / calc(): ${JSON.stringify(offenders)}`).toEqual([]);
  });

  it('zeroes --dur under prefers-reduced-motion, so calc()-derived durations collapse to 0', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block.slice(0, block.indexOf('}') + 1)).toMatch(/--dur:\s*0ms/);
  });
});
