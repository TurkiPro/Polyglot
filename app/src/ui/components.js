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

/** Empty-state message. */
export const empty = (text) => p(text, 'empty');

/** Screen-reader-only live region announcement. */
export function liveRegion() {
  return div({ class: 'sr-only', attrs: { 'aria-live': 'polite', role: 'status' } });
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
