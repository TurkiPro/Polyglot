/**
 * The Turnstile widget (§11) — the one third-party script in the whole app.
 *
 * §1.2 says no third-party scripts at runtime, and the CSP enforces `script-src 'self'`.
 * Turnstile cannot honour that: it is a script served by Cloudflare. The resolution is to
 * make it strictly opt-in and strictly scoped —
 *
 *   - it loads only when the operator has set a site key in config, and
 *   - only when someone actually presses a sign-in button, on the Settings screen.
 *
 * A guest never loads it. Reviewing never loads it. Offline never loads it. And a deploy
 * that leaves the site key empty is exactly as third-party-free as before; the Worker
 * widens its CSP only when a Turnstile secret is configured (worker/src/mw/security.js).
 */
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const SCRIPT_ID = 'cf-turnstile-script';

let loading = null;

/**
 * Load the widget script once.
 * @returns {Promise<boolean>} false when it could not be loaded — the caller decides
 */
export function loadTurnstile(doc = document) {
  if (globalThis.turnstile) return Promise.resolve(true);
  if (loading) return loading;

  loading = new Promise((resolve) => {
    const existing = doc.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }

    const script = doc.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve(true));
    script.addEventListener('error', () => resolve(false));
    doc.head.append(script);
  });

  return loading;
}

/**
 * Render a widget and resolve with its token.
 * Rejects rather than resolving empty, so a caller cannot mistake failure for a token.
 */
export function renderWidget(host, siteKey, api = globalThis.turnstile) {
  if (!api) return Promise.reject(new Error('turnstile_unavailable'));
  host.replaceChildren();

  return new Promise((resolve, reject) => {
    api.render(host, {
      sitekey: siteKey,
      callback: (token) => resolve(token),
      'error-callback': () => reject(new Error('turnstile_failed')),
      'expired-callback': () => reject(new Error('turnstile_expired')),
    });
  });
}

/** Test seam. */
export function reset() {
  loading = null;
}

export { SCRIPT_URL };
