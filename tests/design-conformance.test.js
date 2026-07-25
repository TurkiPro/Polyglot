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

/* ── D3: --glow appears only on the sanctioned surfaces (CLAUDE.md registry) ── */
describe('the glow registry (D3)', () => {
  // The sanctioned surfaces — must match CLAUDE.md's §9 "Sanctioned glow" list. A selector
  // matches if it contains one of these fragments.
  const SANCTIONED = [
    '.combo-lit', // combo / odometer flourish
    '.sign:', // signboard hover (sign name)
    '.syllabus-step.state-current', // course-path current step marker
    '.quiz-band-clear', // checkpoint / band clear card
    '.btn:hover', // liquid button hover (feedback #7)
  ];

  const lines = css.split('\n');
  /** The selector governing line `i` — the nearest preceding line that opens a rule. */
  const selectorFor = (i) => {
    for (let j = i; j >= 0; j -= 1) if (/\{\s*$/.test(lines[j])) return lines[j];
    return '';
  };

  it('every var(--glow) sits on a sanctioned selector', () => {
    const offenders = lines
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => /var\(--glow/.test(line))
      .map(([n, line]) => [n, line.trim(), selectorFor(n - 1).trim()])
      .filter(([, , selector]) => !SANCTIONED.some((frag) => selector.includes(frag)));
    expect(offenders, `unsanctioned glow — add the surface to CLAUDE.md §9 first: ${JSON.stringify(offenders)}`).toEqual([]);
  });

  it('finds the glows it is meant to be guarding (not vacuously green)', () => {
    expect(lines.filter((line) => /var\(--glow/.test(line)).length).toBeGreaterThanOrEqual(5);
  });
});
