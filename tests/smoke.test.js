import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { config } from '../config/app.config.js';
import { parseHash } from '../app/src/main.js';
import { applyToneColors, applyTheme, normalizeTheme } from '../app/src/ui/theme.js';

describe('scaffold smoke', () => {
  it('exposes a frozen config', () => {
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.study)).toBe(true);
    expect(Object.isFrozen(config.toneColors.light)).toBe(true);
    expect(config.identity.projectName).toBe('polyglot');
  });

  it('routes known hashes and falls back to home', () => {
    expect(parseHash('#review')).toEqual({ name: 'review', arg: null });
    expect(parseHash('#word/zh:好:hao3')).toEqual({ name: 'word', arg: 'zh:好:hao3' });
    expect(parseHash('')).toEqual({ name: 'home', arg: null });
    expect(parseHash('#nope')).toEqual({ name: 'home', arg: null });
  });

  it('feeds tone colours from config per theme, never from a CSS literal', () => {
    const css = readFileSync(new URL('../app/assets/styles.css', import.meta.url), 'utf8');
    for (const tone of ['t1', 't2', 't3', 't4', 't5']) {
      expect(css).not.toMatch(new RegExp(`--${tone}:\\s*#`));
    }

    for (const theme of ['light', 'dark']) {
      const set = {};
      applyToneColors(theme, { style: { setProperty: (k, v) => (set[k] = v) } });
      expect(set, theme).toEqual({
        '--t1': config.toneColors[theme].t1,
        '--t2': config.toneColors[theme].t2,
        '--t3': config.toneColors[theme].t3,
        '--t4': config.toneColors[theme].t4,
        '--t5': config.toneColors[theme].t5,
      });
    }
  });

  it('defaults to paper and re-applies tones when the theme changes', () => {
    expect(normalizeTheme(undefined)).toBe('light');
    expect(normalizeTheme('nope')).toBe('light');
    expect(normalizeTheme('dark')).toBe('dark');

    const el = { dataset: {}, style: { setProperty: (k, v) => (el.applied[k] = v) }, applied: {} };
    expect(applyTheme('dark', el)).toBe('dark');
    expect(el.dataset.theme).toBe('dark');
    expect(el.applied['--t1']).toBe(config.toneColors.dark.t1);

    applyTheme('light', el);
    expect(el.dataset.theme).toBe('light');
    expect(el.applied['--t1']).toBe(config.toneColors.light.t1);
  });
});
