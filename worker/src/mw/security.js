/**
 * Security headers (§11).
 *
 * The CSP is what makes "no inline script, no inline style" a rule the browser enforces
 * rather than a habit we keep. `connect-src 'self'` is the runtime half of §1.2: the page
 * cannot talk to a third party even if something tried to.
 */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Headers applied to every response. */
const ALWAYS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

/**
 * Add the security headers to a response, copying it so the original stays immutable.
 * The CSP only goes on HTML — it is meaningless on JSON and would only bloat responses.
 */
export function secure(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(ALWAYS)) headers.set(key, value);

  const type = headers.get('content-type') ?? '';
  if (type.includes('text/html')) headers.set('content-security-policy', CSP);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export { CSP };
