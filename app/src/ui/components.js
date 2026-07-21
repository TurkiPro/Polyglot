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

/** Format a due date relative to now, without pulling in a date library. */
export function relativeDay(due, now = Date.now()) {
  const days = Math.round((new Date(due).getTime() - now) / 86400000);
  if (days <= 0) return 'now';
  if (days === 1) return 'tomorrow';
  if (days < 30) return `in ${days} days`;
  const months = Math.round(days / 30);
  return months === 1 ? 'in a month' : `in ${months} months`;
}
