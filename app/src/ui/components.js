/**
 * DOM helpers.
 *
 * Everything builds nodes and sets `textContent` — no `innerHTML`, ever. User words,
 * dictionary definitions and imported data all flow through here, and §11's CSP forbids
 * inline script and style anyway.
 */

/**
 * Create an element.
 * @param {string} tag
 * @param {object} [props] `class`, `text`, `attrs`, plus direct properties
 * @param {Array<Node|string|null|undefined>} [children]
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  const { class: className, text, attrs, dataset, on, ...rest } = props;

  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v !== undefined) node.setAttribute(k, v);
  if (dataset) for (const [k, v] of Object.entries(dataset)) node.dataset[k] = v;
  if (on) for (const [event, handler] of Object.entries(on)) node.addEventListener(event, handler);
  Object.assign(node, rest);

  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Replace an element's children in one go. */
export function replace(parent, ...children) {
  parent.replaceChildren(...children.flat().filter(Boolean));
  return parent;
}

export const div = (props, children) => el('div', props, children);
export const span = (props, children) => el('span', props, children);
export const p = (text, className) => el('p', { text, class: className });
export const h = (level, text, className) => el(`h${level}`, { text, class: className });

/** A button. `variant` maps to a CSS class, never an inline style. */
export function button(label, onClick, { variant = '', type = 'button', ...attrs } = {}) {
  return el('button', {
    class: `btn ${variant}`.trim(),
    text: label,
    attrs: { type, ...attrs },
    on: { click: onClick },
  });
}

/** A labelled range slider that reports its value as you drag. */
export function slider({ label, min, max, step = 1, value, onChange }) {
  const output = el('output', { class: 'slider-value', text: String(value) });
  const input = el('input', {
    class: 'slider',
    attrs: { type: 'range', min: String(min), max: String(max), step: String(step) },
    value: String(value),
    on: {
      input: (event) => {
        output.textContent = event.target.value;
        onChange(Number(event.target.value));
      },
    },
  });
  return el('label', { class: 'field' }, [
    el('span', { class: 'field-label' }, [label, output]),
    input,
  ]);
}

/** A card-like section with a heading. */
export function panel(title, children = []) {
  return el('section', { class: 'panel' }, [title ? h(2, title, 'panel-title') : null, ...children]);
}

/** A big number with a caption, for Home and Stats. */
export function stat(value, label) {
  return div({ class: 'stat' }, [
    div({ class: 'stat-value', text: String(value) }),
    div({ class: 'stat-label', text: label }),
  ]);
}

/** A progress bar. Width is set through CSSOM, which CSP permits. */
export function progressBar(ratio, label) {
  const fill = div({ class: 'bar-fill' });
  fill.style.setProperty('--ratio', String(Math.max(0, Math.min(1, ratio))));
  return div({ class: 'bar' }, [
    label ? div({ class: 'bar-label', text: label }) : null,
    div({ class: 'bar-track' }, [fill]),
  ]);
}

/** A dismissible banner, e.g. the missing-voice notice (§9). */
export function banner(title, body, dismissLabel, onDismiss) {
  const node = div({ class: 'banner', attrs: { role: 'status' } }, [
    div({ class: 'banner-text' }, [h(3, title, 'banner-title'), p(body)]),
    button(dismissLabel, () => {
      node.remove();
      onDismiss?.();
    }, { variant: 'btn-quiet' }),
  ]);
  return node;
}

/**
 * An audio control: normal speech, plus a slow variant (§3.4.2, §3.4.4).
 *
 * Every face that shows hanzi or a sentence gets one. Both buttons carry `data-no-flip`
 * so pressing them can never be mistaken for asking to see the answer (§3.4.3), and a
 * long press on the normal button also plays slowly, which is the reachable gesture on
 * a phone.
 *
 * @param {() => void} onPlay
 * @param {() => void} onSlow
 * @param {{ label?: string, slowLabel?: string, compact?: boolean }} [options]
 */
export function audioControl(onPlay, onSlow, { label = 'Play', slowLabel = 'Play slowly', compact = false } = {}) {
  const LONG_PRESS_MS = 450;
  let timer = null;
  let longFired = false;

  const play = button('', () => {
    // A long press already spoke; do not speak twice on release.
    if (longFired) {
      longFired = false;
      return;
    }
    onPlay();
  }, { variant: `btn-quiet btn-audio${compact ? ' btn-small' : ''}`, 'aria-label': label });
  play.dataset.noFlip = '';
  play.append(icon('volume-2', compact ? 16 : 18));
  if (!compact) play.append(span({ text: label }));

  const startPress = () => {
    longFired = false;
    timer = setTimeout(() => {
      longFired = true;
      onSlow();
    }, LONG_PRESS_MS);
  };
  const endPress = () => clearTimeout(timer);
  play.addEventListener('pointerdown', startPress);
  for (const event of ['pointerup', 'pointerleave', 'pointercancel']) {
    play.addEventListener(event, endPress);
  }

  const slow = button('', () => onSlow(), {
    variant: `btn-quiet btn-audio btn-slow${compact ? ' btn-small' : ''}`,
    'aria-label': slowLabel,
    title: slowLabel,
  });
  slow.dataset.noFlip = '';
  slow.append(span({ class: 'turtle', text: '🐢' }));

  const group = div({ class: 'audio-control' }, [play, slow]);
  group.dataset.noFlip = '';
  return group;
}

/** Empty-state message. */
export const empty = (text) => p(text, 'empty');

/**
 * A composed empty state (§3.3.6): a large quiet motif, one line of direction, one
 * action. Centred in the content area rather than a caption floating in a field.
 *
 * One component so Words, Browse, Stats and the finished session cannot drift apart.
 *
 * @param {'grid'|'seal'|null} motif
 * @param {string} text the single line of direction
 * @param {Node|null} [action] the one button
 * @param {{ note?: string }} [options] a second, quieter line
 */
export function emptyState(motif, text, action = null, { note } = {}) {
  const art = motif === 'seal' ? sealMark(96) : motif === 'grid' ? tianzige([]) : null;
  return div({ class: 'empty-state' }, [
    art ? div({ class: `empty-motif empty-motif-${motif}` }, [art]) : null,
    p(text, 'empty-text'),
    note ? p(note, 'empty-note') : null,
    action,
  ].filter(Boolean));
}

/** Screen-reader-only live region announcement. */
export function liveRegion() {
  return div({ class: 'sr-only', attrs: { 'aria-live': 'polite', role: 'status' } });
}

/**
 * The seal (印章) — 语 stamped in seal red (§3.2.1).
 *
 * The app mark, and the mark of completion: session done, word added, badge earned.
 * Inline SVG so it inherits the theme's accent and needs no image request.
 *
 * @param {number} size pixels
 * @param {{ title?: string }} [options] an accessible name, when it is not decorative
 */
export function sealMark(size = 28, { title } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'seal');
  svg.setAttribute('role', title ? 'img' : 'presentation');
  if (title) {
    const node = document.createElementNS(NS, 'title');
    node.textContent = title;
    svg.append(node);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }

  const rect = document.createElementNS(NS, 'rect');
  rect.setAttribute('width', '100');
  rect.setAttribute('height', '100');
  rect.setAttribute('rx', '18');
  rect.setAttribute('fill', 'currentColor');
  svg.append(rect);

  const text = document.createElementNS(NS, 'text');
  text.setAttribute('x', '50');
  text.setAttribute('y', '54');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'central');
  text.setAttribute('font-size', '62');
  text.setAttribute('font-weight', '700');
  text.setAttribute('fill', 'var(--accent-fg)');
  text.setAttribute('font-family', 'var(--font-han)');
  text.textContent = '语';
  svg.append(text);

  return svg;
}

/** The small stamp that marks something done — an added word, a finished action. */
export function checkStamp(label) {
  const node = span({ class: 'stamp-check' });
  node.append(icon('check', 16));
  if (label) node.append(span({ text: label }));
  return node;
}

/**
 * 田字格 — the practice grid every learner writes characters into (§3.2.1).
 *
 * A square with a dashed cross and dashed diagonals, drawn with borders only. It sits
 * behind the hero glyph on REC and WRITE fronts, and behind the speaker on LIS fronts,
 * where it says "a character belongs here" while withholding which one.
 *
 * @param {Array<Node|string>} children what sits inside the square
 * @param {{ className?: string }} [options]
 */
export function tianzige(children = [], { className = '' } = {}) {
  return div({ class: `tianzige ${className}`.trim() }, [
    div({ class: 'grid-line grid-v' }),
    div({ class: 'grid-line grid-h' }),
    div({ class: 'grid-line grid-d1' }),
    div({ class: 'grid-line grid-d2' }),
    div({ class: 'tianzige-content' }, children),
  ]);
}

/**
 * Icons (§3.2.4).
 *
 * Lucide's SVGs are vendored into `app/assets/icons/ui/` as static assets — not a
 * dependency, so the allowlist is unchanged and nothing is fetched from a third party at
 * runtime. Each file is fetched once and cached in-module.
 */
const ICON_BASE = '/assets/icons/ui';
const iconCache = new Map();

/** Names vendored for this app; anything else is a caller mistake, not a fetch. */
export const ICON_NAMES = Object.freeze([
  'volume-2', 'play', 'rotate-ccw', 'plus', 'check', 'x', 'chevron-right',
  'home', 'book-open', 'search', 'list', 'bar-chart-3', 'settings',
]);

/**
 * An icon element. Returns a placeholder immediately and fills it once the SVG arrives,
 * so callers never have to await layout.
 *
 * @param {string} name one of ICON_NAMES
 * @param {number} [size] pixels
 * @returns {HTMLElement}
 */
export function icon(name, size = 24) {
  const host = el('span', {
    class: 'icon',
    attrs: { 'aria-hidden': 'true', 'data-icon': name },
  });
  host.style.setProperty('--icon-size', `${size}px`);

  loadIcon(name)
    .then((svg) => {
      if (!svg) return;
      const node = svg.cloneNode(true);
      node.setAttribute('width', String(size));
      node.setAttribute('height', String(size));
      host.replaceChildren(node);
    })
    .catch(() => {
      // A missing glyph must never break a screen; the label beside it still reads.
    });

  return host;
}

/** Fetch and parse one icon, once. */
function loadIcon(name) {
  if (!iconCache.has(name)) {
    const promise = fetch(`${ICON_BASE}/${name}.svg`)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`icon ${name}: ${res.status}`))))
      .then((text) => {
        // Parsed as a document, not injected as markup — no innerHTML anywhere (§11).
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
        const svg = doc.querySelector('svg');
        if (!svg) throw new Error(`icon ${name}: not an svg`);
        svg.setAttribute('focusable', 'false');
        svg.setAttribute('aria-hidden', 'true');
        return svg;
      });
    iconCache.set(name, promise);
  }
  return iconCache.get(name);
}

/** Drop cached icons — tests only. */
export const resetIcons = () => iconCache.clear();

/**
 * A scheduling delay as the shortest honest label: "10m", "4h", "3d", "2mo", "1y".
 * Used on the grade buttons, where four of these have to fit side by side.
 */
export function formatInterval(due, from = Date.now()) {
  const ms = new Date(due).getTime() - new Date(from).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.round(ms / 86400000);
  if (days < 30) return `${days}d`;

  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.round(days / 365)}y`;
}

/** Format a due date relative to now, without pulling in a date library. */
export function relativeDay(due, now = Date.now()) {
  const days = Math.round((new Date(due).getTime() - now) / 86400000);
  if (days <= 0) return 'now';
  if (days === 1) return 'tomorrow';
  if (days < 30) return `in ${days} days`;
  const months = Math.round(days / 30);
  return months === 1 ? 'in a month' : `in ${months} months`;
}
