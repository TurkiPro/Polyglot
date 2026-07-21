/**
 * Service worker (§9).
 *
 * Precaches only the app shell and the deck. The 10 MB dictionary and the ~3,000 stroke
 * files are runtime-cached on first use and cache-first thereafter — precaching them
 * would make the first load ~29 MB for every new user.
 *
 * `/api/*` is network-only: sync must never be served from a cache.
 *
 * Bundled by scripts/build.mjs into app/sw.js, so §0 values come from config rather than
 * being restated here. The pack version is injected at build time from the built deck —
 * it is generated data, not configuration. Together they key the cache, which is what
 * evicts a stale pack.
 */
import { config } from '../../config/app.config.js';

const DECK_SCHEMA_VERSION = config.pack.deckSchemaVersion;
const LANG = config.pack.langPackV1;
/** Replaced at build time by scripts/build.mjs. */
const PACK_VERSION = __PACK_VERSION__;

const PREFIX = `${config.identity.projectName}-`;
const SHELL_CACHE = `${PREFIX}shell-v${DECK_SCHEMA_VERSION}-${PACK_VERSION}`;
const RUNTIME_CACHE = `${PREFIX}runtime-v${DECK_SCHEMA_VERSION}-${PACK_VERSION}`;

/** The shell, plus the deck — everything needed for a full offline session. */
const PRECACHE = [
  '/',
  '/index.html',
  '/assets/bundle.js',
  '/assets/styles.css',
  '/manifest.webmanifest',
  // ~37 KB of icons, against a 5 MB deck — cheap enough to guarantee they are there.
  '/assets/icons/icon.svg',
  '/assets/icons/icon-180px.png',
  '/assets/icons/icon-192px.png',
  '/assets/icons/icon-512px.png',
  '/assets/icons/icon-maskable-192px.png',
  '/assets/icons/icon-maskable-512px.png',
  `/assets/packs/${LANG}/deck.${LANG}.json`,
];

/** Big, lazily needed assets: fetched on demand, then kept. */
const RUNTIME_PATHS = [`/assets/packs/${LANG}/dict.`, `/assets/packs/${LANG}/strokes/`];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(PREFIX) && name !== SHELL_CACHE && name !== RUNTIME_CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Sync and auth must always hit the network.
  if (url.pathname.startsWith('/api/')) return;

  if (RUNTIME_PATHS.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  event.respondWith(cacheFirst(request, SHELL_CACHE, { fallbackToShell: true }));
});

/**
 * Serve from cache, falling back to the network and storing what comes back.
 * Navigations fall back to the cached shell so hash routes work offline.
 */
async function cacheFirst(request, cacheName, { fallbackToShell = false } = {}) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    if (fallbackToShell && request.mode === 'navigate') {
      const shell = await caches.match('/index.html');
      if (shell) return shell;
    }
    throw err;
  }
}
