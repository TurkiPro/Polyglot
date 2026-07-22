/**
 * Inline SVG icons — hand-drawn, 24px, single stroke weight.
 *
 * No icon library: the allowlist holds (§4.3), and five tab glyphs plus a gear is not
 * worth a dependency. Built as DOM rather than markup strings so §11's CSP holds.
 */

const NS = 'http://www.w3.org/2000/svg';

/** Build an <svg> from a list of path `d` strings. */
function icon(paths, { size = 24 } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  for (const d of paths) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** House. */
export const home = (o) => icon(['M3 10.5 12 3l9 7.5', 'M5.5 9.5V20h13V9.5'], o);

/** Stack of cards. */
export const review = (o) =>
  icon(['M4 8.5h11a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8.5a2 2 0 0 1 2-2Z', 'M7 5.5h11a2 2 0 0 1 2 2V16'], o);

/** Magnifier. */
export const browse = (o) => icon(['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z', 'M16.2 16.2 21 21'], o);

/** Bookmark — the words you kept. */
export const words = (o) => icon(['M6 3.5h12v17l-6-4.2-6 4.2v-17Z'], o);

/** Bar chart. */
export const stats = (o) => icon(['M4 20V11', 'M10 20V4', 'M16 20v-6', 'M22 20H2'], o);

/** Gear. */
export const settings = (o) =>
  icon(
    [
      'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
      'M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1Z',
    ],
    o,
  );

export const ICONS = { home, review, browse, words, stats, settings };

/** Icon by route name; unknown names get no glyph rather than throwing. */
export const iconFor = (name, options) => (ICONS[name] ? ICONS[name](options) : null);
