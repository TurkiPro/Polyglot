/**
 * Which icon stands for what (§3.2.4).
 *
 * The glyphs themselves are lucide SVGs vendored under `app/assets/icons/ui/` and
 * inlined by `components.icon()`. This module only holds the mapping, so a route or a
 * card mode never hardcodes a filename.
 */
import { icon } from './components.js';

/** Route name → vendored icon. */
export const ROUTE_ICONS = Object.freeze({
  home: 'home',
  review: 'book-open',
  browse: 'search',
  words: 'list',
  stats: 'bar-chart-3',
  settings: 'settings',
});

/** Card mode → vendored icon, for the eyebrow (§3.2.5). */
export const MODE_ICONS = Object.freeze({
  REC: 'book-open',
  LIS: 'volume-2',
  PROD: 'play',
  SENT: 'chevron-right',
  WRITE: 'plus',
});

/** Icon for a route; unknown names render nothing rather than throwing. */
export const iconFor = (name, size = 24) =>
  ROUTE_ICONS[name] ? icon(ROUTE_ICONS[name], size) : null;

/** Icon for a card mode. */
export const iconForMode = (mode, size = 16) =>
  MODE_ICONS[mode] ? icon(MODE_ICONS[mode], size) : null;
