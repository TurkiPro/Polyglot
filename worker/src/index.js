/**
 * polyglot Worker entry point.
 *
 * Routing rule for the whole project: `/api/*` is handled here, everything else is a
 * static asset from `app/`. One origin, one deploy, no CORS.
 */

/** @typedef {{ ASSETS: { fetch: (req: Request) => Promise<Response> }, DB: D1Database }} Env */

/** JSON response helper. */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * @param {Request} request
 * @param {Env} env
 */
async function handleApi(request, env, pathname) {
  if (pathname === '/api/health') return json({ ok: true });
  return json({ error: 'not_found' }, 404);
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   */
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return handleApi(request, env, pathname);
    }
    return env.ASSETS.fetch(request);
  },
};
