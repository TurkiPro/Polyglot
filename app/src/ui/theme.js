/**
 * Theme: the `data-theme` attribute plus the per-theme tone colours.
 *
 * Its own module so `main.js` and `settings.js` can both reach it without importing each
 * other. "light" is paper, "dark" is night ink.
 */
import { config } from '../../../config/app.config.js';

export const THEMES = Object.freeze(['light', 'dark']);
/** Night market is the flagship (v3 §1); paper stays as the reading-lamp light theme. */
export const DEFAULT_THEME = 'dark';

/** Normalize anything to a theme we actually have. */
export const normalizeTheme = (theme) => (THEMES.includes(theme) ? theme : DEFAULT_THEME);

/**
 * Feed the §0 tone colours into CSS as --t1..--t5 for a theme.
 *
 * Each theme has its own pair of shades so one hue clears contrast on paper and on night
 * ink alike. Done via CSSOM rather than literals in styles.css so config stays the single
 * source of truth; CSP allows this because it is script-driven, not an inline `style=`
 * attribute.
 */
export function applyToneColors(theme = DEFAULT_THEME, el = document.documentElement) {
  const colors = config.toneColors[normalizeTheme(theme)];
  for (const [name, value] of Object.entries(colors)) {
    el.style.setProperty(`--${name}`, value);
  }
  return colors;
}

/** Switch theme: the attribute drives the palette, and tones follow it. */
export function applyTheme(theme, el = document.documentElement) {
  const name = normalizeTheme(theme);
  el.dataset.theme = name;
  applyToneColors(name, el);
  return name;
}
