/**
 * Colour contrast, checked numerically against the shipped tokens (§3.2.8).
 *
 * Reads the real stylesheet and the real config rather than a copy, so a token edit that
 * breaks legibility fails here rather than on someone's screen.
 *
 * Targets: 4.5:1 for body text, 3:1 for large text and UI chrome (WCAG 2.1 AA).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { config } from '../config/app.config.js';

const css = readFileSync(new URL('../app/assets/styles.css', import.meta.url), 'utf8');

/** Tokens declared in a `:root...{ }` block. */
function tokens(selector) {
  const at = css.indexOf(selector);
  if (at === -1) throw new Error(`no ${selector} block`);
  const body = css.slice(at, css.indexOf('}', at));
  const found = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) found[name] = value;
  return found;
}

// Dark overrides light; anything it does not restate is inherited.
const light = tokens(':root {');
const dark = { ...light, ...tokens(':root[data-theme="dark"]') };

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const linear = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const [r, g, b] = channels(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

/** WCAG contrast ratio between two hex colours. */
export function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const THEMES = [
  ['paper (light, default)', light, config.toneColors.light],
  ['night ink (dark)', dark, config.toneColors.dark],
];

describe('contrast', () => {
  it('reads real tokens from the stylesheet', () => {
    for (const [name, t] of THEMES) {
      for (const key of ['bg', 'surface', 'surface-2', 'border', 'fg', 'fg-dim', 'accent', 'ok', 'danger']) {
        expect(t[key], `${name} --${key}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it.each(THEMES)('%s: body text clears 4.5:1', (_name, t) => {
    expect(contrast(t.fg, t.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.fg, t.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['fg-dim'], t.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['fg-dim'], t.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('%s: filled controls clear 4.5:1 for their label', (_name, t) => {
    // Seal red and danger are both used as fills with a white label.
    expect(contrast(t['accent-fg'], t.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', t.danger)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('%s: accent as chrome clears 3:1', (_name, t) => {
    // Seal red is never body text (§3.2.1) — active states and marks only.
    expect(contrast(t.accent, t.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(t.accent, t.surface)).toBeGreaterThanOrEqual(3);
  });

  it.each(THEMES)('%s: every tone colour clears 4.5:1 on page and on sheet', (_name, t, tones) => {
    for (const [tone, colour] of Object.entries(tones)) {
      expect(contrast(colour, t.bg), `${tone} on --bg`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colour, t.surface), `${tone} on --surface`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('gives every theme its own tone pair, keeping hue identity', () => {
    const { light: paper, dark: night } = config.toneColors;
    expect(Object.keys(paper)).toEqual(['t1', 't2', 't3', 't4', 't5']);
    expect(Object.keys(night)).toEqual(['t1', 't2', 't3', 't4', 't5']);
    // The pairs differ — otherwise one of them cannot be passing on both grounds.
    for (const tone of Object.keys(paper)) {
      expect(paper[tone], tone).not.toBe(night[tone]);
    }
  });

  it('never declares --t1..--t5 in CSS, so config stays their only source', () => {
    // A shared value is fine — paper's t5 *is* --fg-dim, deliberately. What must not
    // exist is a second declaration of the tone variables themselves.
    for (const tone of ['t1', 't2', 't3', 't4', 't5']) {
      expect(css, `--${tone} must be injected, not declared`).not.toMatch(
        new RegExp(`--${tone}:\s*#`),
      );
      // And the class has to read the variable rather than hardcode a colour.
      expect(css).toContain(`.${tone} { color: var(--${tone}); }`);
    }
  });
});
