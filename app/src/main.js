/**
 * polyglot — boot + hash router.
 *
 * Phase 0 scaffold: the router shape is here, the views land in Phase 3.
 */
import { config } from '../../config/app.config.js';

/** Routes are `#name` or `#name/:arg`. */
const ROUTES = ['home', 'review', 'browse', 'word', 'stats', 'settings', 'credits'];
const DEFAULT_ROUTE = 'home';

/** @returns {{ name: string, arg: string|null }} */
export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const [name, ...rest] = raw.split('/');
  if (!ROUTES.includes(name)) return { name: DEFAULT_ROUTE, arg: null };
  return { name, arg: rest.length ? decodeURIComponent(rest.join('/')) : null };
}

/**
 * Feed the §0 tone colors into CSS as --t1..--t5. Done via CSSOM rather than a literal
 * in styles.css so config stays the single source of truth; CSP allows this because it
 * is script-driven, not an inline `style=` attribute.
 */
export function applyToneColors(el = document.documentElement, colors = config.toneColors) {
  for (const [name, value] of Object.entries(colors)) {
    el.style.setProperty(`--${name}`, value);
  }
}

function render(route, root) {
  root.textContent = '';
  const h = document.createElement('h1');
  h.textContent = route.name;
  root.append(h);
}

function boot() {
  const root = document.getElementById('app');
  if (!root) return;
  const paint = () => render(parseHash(location.hash), root);
  addEventListener('hashchange', paint);
  applyToneColors();
  paint();
}

if (typeof document !== 'undefined') boot();
