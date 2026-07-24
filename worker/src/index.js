/**
 * polyglot Worker entry point (§2, §11).
 *
 * Routing rule for the whole project: `/api/*` is handled here, everything else is a
 * static asset from `app/`. One origin, one deploy, no CORS — if you ever find yourself
 * writing a CORS header, something has gone wrong (§1).
 */
import { exportAll, exportFilename } from './api/export.js';
import { deleteMe, getMe, logout } from './api/me.js';
import { HttpError, pullEvents, pullWords, pushEvents, pushWords } from './api/sync.js';
import { completeLogin, enabledProviders, isConfigured, providerFor, startLogin } from './auth/oauth.js';
import {
  clearCookieHeader,
  cookieHeader,
  createSession,
  currentUser,
  isLocal,
  upsertUser,
} from './auth/sessions.js';
import { clientIp, rateLimit } from './mw/ratelimit.js';
import { secure } from './mw/security.js';
import { verifyTurnstile } from './mw/turnstile.js';

/** @typedef {{ ASSETS: { fetch: (req: Request) => Promise<Response> }, DB: D1Database, AUDIO?: R2Bucket, DEV_MODE?: string }} Env */

/** JSON response helper. */
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

const unauthorized = () => json({ error: 'unauthorized' }, 401);
const notFound = () => json({ error: 'not_found' }, 404);

/** Parse a JSON body, tolerating an empty one. */
async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

/**
 * Auth routes: rate limited by IP, because there is no user yet to limit by.
 */
async function handleAuth(request, env, segments) {
  const [providerName, action] = segments;

  // Dev login exists only when DEV_MODE is set, and is invisible otherwise (§11).
  if (providerName === 'dev') {
    if (env.DEV_MODE !== '1') return notFound();
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const user = await upsertUser(env, {
      provider: 'dev',
      providerId: 'local',
      displayName: 'dev@local',
    });
    const { token } = await createSession(env, user.id);
    return json(
      { ok: true, user: { id: user.id, displayName: user.display_name, provider: 'dev' } },
      200,
      { 'set-cookie': cookieHeader(token, { secure: !isLocal(request) }) },
    );
  }

  if (providerName === 'logout') {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const user = await currentUser(request, env);
    if (!user) return unauthorized();
    await logout(env, user);
    return json({ ok: true }, 200, { 'set-cookie': clearCookieHeader({ secure: !isLocal(request) }) });
  }

  if (providerName === 'providers') {
    // Which buttons the login page should offer.
    return json({
      providers: enabledProviders().filter((name) => isConfigured(providerFor(name), env)),
      turnstileRequired: env.DEV_MODE !== '1',
    });
  }

  const provider = providerFor(providerName);
  if (!provider || !enabledProviders().includes(providerName)) return notFound();

  if (action === 'start') {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!isConfigured(provider, env)) return json({ error: 'provider_not_configured' }, 503);

    const body = await readJson(request).catch(() => ({}));
    const check = await verifyTurnstile(env, body?.turnstileToken, clientIp(request));
    if (!check.ok) return json({ error: 'turnstile_failed', reason: check.reason }, 403);

    const { redirectUrl, cookie } = startLogin(request, env, provider);
    return json({ redirectUrl }, 200, { 'set-cookie': cookie });
  }

  if (action === 'callback') {
    let result;
    try {
      result = await completeLogin(request, env, provider);
    } catch (err) {
      return json({ error: 'oauth_failed', reason: String(err.message ?? err) }, 502);
    }
    if (!result.ok) return json({ error: 'oauth_failed', reason: result.reason }, 400);

    // Straight back into the app, now signed in.
    const headers = new Headers({ location: '/#settings' });
    for (const cookie of result.cookies) headers.append('set-cookie', cookie);
    return new Response(null, { status: 302, headers });
  }

  return notFound();
}

/** Everything that needs a session. */
async function handleAuthenticated(request, env, pathname, user) {
  const url = new URL(request.url);

  if (pathname === '/api/me') {
    if (request.method === 'GET') return json(await getMe(env, user));
    if (request.method === 'DELETE') {
      await deleteMe(env, user);
      return json({ deleted: true }, 200, {
        'set-cookie': clearCookieHeader({ secure: !isLocal(request) }),
      });
    }
    return json({ error: 'method_not_allowed' }, 405);
  }

  if (pathname === '/api/sync/events') {
    if (request.method === 'POST') {
      const body = await readJson(request);
      return json(await pushEvents(env, user.id, body?.events));
    }
    if (request.method === 'GET') {
      return json(await pullEvents(env, user.id, url.searchParams.get('since') ?? 0));
    }
    return json({ error: 'method_not_allowed' }, 405);
  }

  if (pathname === '/api/sync/words') {
    if (request.method === 'POST') {
      const body = await readJson(request);
      return json(await pushWords(env, user.id, body?.words));
    }
    if (request.method === 'GET') {
      return json(await pullWords(env, user.id, url.searchParams.get('since') ?? 0));
    }
    return json({ error: 'method_not_allowed' }, 405);
  }

  if (pathname === '/api/export') {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    return json(await exportAll(env, user), 200, {
      'content-disposition': `attachment; filename="${exportFilename()}"`,
    });
  }

  return notFound();
}

/**
 * @param {Request} request
 * @param {Env} env
 */
async function handleApi(request, env, pathname) {
  if (pathname === '/api/health') return json({ ok: true });

  const segments = pathname.replace(/^\/api\//, '').split('/');

  if (segments[0] === 'auth') {
    const limit = await rateLimit(env, 'auth', clientIp(request));
    if (!limit.ok) {
      return json({ error: 'rate_limited' }, 429, { 'retry-after': String(limit.retryAfter) });
    }
    return handleAuth(request, env, segments.slice(1));
  }

  const user = await currentUser(request, env);
  if (!user) return unauthorized();

  // Signed-in traffic is limited per user, not per IP: one household is not one client.
  const limit = await rateLimit(env, 'api', user.id);
  if (!limit.ok) {
    return json({ error: 'rate_limited' }, 429, { 'retry-after': String(limit.retryAfter) });
  }

  return handleAuthenticated(request, env, pathname, user);
}

/**
 * GET /audio/:file — the pre-rendered audio pack, streamed from R2 (Phase 8 §3).
 *
 * Public data with no auth: it is the same audio anyone can generate from the committed
 * manifest, and requiring a session would break guest mode (§1.3). Filenames are content
 * hashes, so the response is immutable — a changed recording is a different filename.
 */
async function handleAudio(request, env, pathname) {
  if (!env.AUDIO) return new Response('audio pack not configured', { status: 503 });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405 });
  }

  const file = decodeURIComponent(pathname.slice('/audio/'.length));
  // No traversal: a hash is a flat name, and anything else is not ours.
  if (!file || file.includes('/') || file.includes('..')) {
    return new Response('not found', { status: 404 });
  }

  const object = await env.AUDIO.get(file);
  if (!object) return new Response('not found', { status: 404 });

  const headers = new Headers({
    'content-type': 'audio/ogg',
    'cache-control': 'public, max-age=31536000, immutable',
    etag: object.httpEtag,
  });

  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   */
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith('/audio/')) {
      return secure(await handleAudio(request, env, pathname), env);
    }

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      try {
        return secure(await handleApi(request, env, pathname), env);
      } catch (err) {
        if (err instanceof HttpError) return secure(json({ error: err.message }, err.status), env);
        console.error(err);
        return secure(json({ error: 'internal_error' }, 500), env);
      }
    }

    return secure(await env.ASSETS.fetch(request), env);
  },
};
