import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { config } from '../config/app.config.js';
import { applyToneColors, parseHash } from '../app/src/main.js';

describe('scaffold smoke', () => {
  it('exposes a frozen config', () => {
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.study)).toBe(true);
    expect(config.identity.projectName).toBe('polyglot');
  });

  it('routes known hashes and falls back to home', () => {
    expect(parseHash('#review')).toEqual({ name: 'review', arg: null });
    expect(parseHash('#word/zh:好:hao3')).toEqual({ name: 'word', arg: 'zh:好:hao3' });
    expect(parseHash('')).toEqual({ name: 'home', arg: null });
    expect(parseHash('#nope')).toEqual({ name: 'home', arg: null });
  });

  it('feeds tone colors from config, never from a CSS literal', () => {
    const css = readFileSync(new URL('../app/assets/styles.css', import.meta.url), 'utf8');
    for (const value of Object.values(config.toneColors)) {
      expect(css).not.toContain(value);
    }

    const set = {};
    applyToneColors({ style: { setProperty: (k, v) => (set[k] = v) } });
    expect(set).toEqual({
      '--t1': config.toneColors.t1,
      '--t2': config.toneColors.t2,
      '--t3': config.toneColors.t3,
      '--t4': config.toneColors.t4,
      '--t5': config.toneColors.t5,
    });
  });
});
