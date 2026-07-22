/**
 * polyglot — boot, hash router, and the nav shell.
 */
import { config } from '../../config/app.config.js';
import { init, store, subscribe } from './store.js';
import { div, el, empty, p, replace } from './ui/components.js';
import { iconFor } from './ui/icons.js';
import { strings } from './ui/strings.js';
import { renderBrowse } from './views/browse.js';
import { renderCredits } from './views/credits.js';
import { renderHome } from './views/home.js';
import { renderReview } from './views/review.js';
import { renderSettings, applyTheme } from './views/settings.js';
import { renderStats } from './views/stats.js';
import { renderWord } from './views/word.js';
import { renderWords } from './views/words.js';

/** Routes are `#name` or `#name/:arg`. */
const ROUTES = ['home', 'review', 'browse', 'words', 'word', 'stats', 'settings', 'credits'];
const DEFAULT_ROUTE = 'home';

/** Routes shown in the nav bar, in order. */
/** The five that live in the bottom tab bar on mobile; Settings sits behind the gear. */
const NAV = ['home', 'review', 'browse', 'words', 'stats'];

const VIEWS = {
  home: renderHome,
  review: renderReview,
  browse: renderBrowse,
  words: renderWords,
  word: renderWord,
  stats: renderStats,
  settings: renderSettings,
  credits: renderCredits,
};

/** @returns {{ name: string, arg: string|null }} */
export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const [name, ...rest] = raw.split('/');
  if (!ROUTES.includes(name)) return { name: DEFAULT_ROUTE, arg: null };
  return { name, arg: rest.length ? decodeURIComponent(rest.join('/')) : null };
}

/**
 * Feed the §0 tone colours into CSS as --t1..--t5. Done via CSSOM rather than a literal
 * in styles.css so config stays the single source of truth; CSP allows this because it
 * is script-driven, not an inline `style=` attribute.
 */
export function applyToneColors(el = document.documentElement, colors = config.toneColors) {
  for (const [name, value] of Object.entries(colors)) {
    el.style.setProperty(`--${name}`, value);
  }
}

/** A navigation link that routes without a page load. */
function navLink(name, active, navigate, { className, withIcon = false }) {
  const link = el('a', {
    class: `${className}${name === active ? ' active' : ''}`,
    href: `#${name}`,
    attrs: name === active ? { 'aria-current': 'page' } : {},
  });
  if (withIcon) {
    const glyph = iconFor(name);
    if (glyph) link.append(glyph);
  }
  link.append(el('span', { text: strings.nav[name] }));
  link.addEventListener('click', (event) => {
    event.preventDefault();
    navigate(`#${name}`);
  });
  return link;
}

/** Top nav (desktop) and bottom tab bar (mobile) show the same five sections. */
function renderNav(container, tabbar, actions, active, navigate) {
  if (container) {
    replace(container, ...NAV.map((name) => navLink(name, active, navigate, { className: 'nav-link' })));
  }
  if (tabbar) {
    replace(
      tabbar,
      ...NAV.map((name) => navLink(name, active, navigate, { className: 'tab', withIcon: true })),
    );
  }
  if (actions) {
    // Settings and Credits live behind the gear, off the five-item nav.
    const gear = el('button', {
      class: `icon-btn${active === 'settings' || active === 'credits' ? ' active' : ''}`,
      attrs: { type: 'button', 'aria-label': strings.nav.settings, title: strings.nav.settings },
      on: { click: () => navigate('#settings') },
    });
    const glyph = iconFor('settings');
    if (glyph) gear.append(glyph);
    replace(actions, gear);
  }
}

function boot() {
  const root = document.getElementById('app');
  const nav = document.getElementById('nav');
  const tabbar = document.getElementById('tabbar');
  const actions = document.getElementById('bar-actions');
  if (!root) return;

  applyToneColors();

  let teardown = null;
  const navigate = (hash) => {
    if (location.hash === hash) paint();
    else location.hash = hash;
  };

  function paint() {
    const route = parseHash(location.hash);
    teardown?.();
    teardown = null;

    renderNav(nav, tabbar, actions, route.name, navigate);
    // Review hides the tab bar on mobile so the grade bar owns the thumb zone.
    document.documentElement.dataset.route = route.name;
    document.title = `${strings.nav[route.name] ?? strings.appName} · ${strings.appName}`;

    const render = VIEWS[route.name] ?? renderHome;
    try {
      teardown = render(root, { navigate }, route.arg) ?? null;
    } catch (err) {
      console.error(err);
      replace(root, div({ class: 'error' }, [p(strings.common.error, 'empty')]));
    }
  }

  addEventListener('hashchange', paint);

  replace(root, div({ class: 'booting' }, [p(strings.common.loading, 'empty')]));

  init()
    .then(() => {
      applyTheme(store.settings.theme);
      // Repaint on state changes so tile counts stay honest after a review.
      subscribe(() => {
        const route = parseHash(location.hash);
        if (['home', 'stats', 'words'].includes(route.name)) paint();
      });
      paint();
      registerServiceWorker();
    })
    .catch((err) => {
      console.error(err);
      replace(root, div({ class: 'error' }, [p(strings.common.error, 'empty')]));
    });
}

/** Register the service worker so the app works offline (§9). */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('sw', err));
}

if (typeof document !== 'undefined') boot();

export { empty };
