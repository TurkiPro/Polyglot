/**
 * Security headers (§11).
 *
 * The CSP is what makes "no inline script, no inline style" a rule the browser enforces
 * rather than a habit we keep. `connect-src 'self'` is the runtime half of §1.2: the page
 * cannot talk to a third party even if something tried to.
 */

/** Cloudflare's challenge origin — the only third party this app can ever talk to. */
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/**
 * The default policy: nothing but us.
 *
 * §1.2 promises no third-party scripts at runtime, and this is what enforces it rather
 * than merely asserting it.
 */
function directives(env) {
  const script = ["'self'"];
  const frame = [];
  const connect = ["'self'"];

  /*
   * Turnstile (§11) is served by Cloudflare, so it cannot live under `script-src 'self'`.
   * The policy is widened only when an operator has actually configured a secret — a
   * deploy without Turnstile keeps the strict policy, and a guest never loads the script
   * either way (see app/src/sync/turnstile.js).
   */
  if (env?.TURNSTILE_SECRET) {
    script.push(TURNSTILE_ORIGIN);
    frame.push(TURNSTILE_ORIGIN);
    connect.push(TURNSTILE_ORIGIN);
  }

  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    frame.length ? `frame-src ${frame.join(' ')}` : null,
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ]
    .filter(Boolean)
    .join('; ');
}

/** The strict policy, for tests and for the common case. */
const CSP = directives();

/** Headers applied to every response. */
const ALWAYS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

/**
 * Add the security headers to a response, copying it so the original stays immutable.
 * The CSP only goes on HTML — it is meaningless on JSON and would only bloat responses.
 */
export function secure(response, env) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(ALWAYS)) headers.set(key, value);

  const type = headers.get('content-type') ?? '';
  if (type.includes('text/html')) headers.set('content-security-policy', directives(env));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export { CSP, TURNSTILE_ORIGIN, directives };
