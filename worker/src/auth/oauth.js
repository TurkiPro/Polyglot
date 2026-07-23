/**
 * The OAuth flow, shared by every provider (§11).
 *
 * Server-side authorization-code exchange: the client secret never reaches the browser,
 * and neither does the provider's access token — it is used once, here, to read an id,
 * and then discarded. We store no provider tokens.
 */
import { config } from '../../../config/app.config.js';
import { github } from './github.js';
import { google } from './google.js';
import { cookieHeader, createSession, isLocal, readCookie, upsertUser } from './sessions.js';

const PROVIDERS = { github, google };
const STATE_COOKIE = 'pg_oauth_state';
const STATE_TTL_SECONDS = 600;

/** Providers §0 says we offer, and that we actually have code for. */
export const enabledProviders = () =>
  config.auth.oauthProviders.filter((name) => Boolean(PROVIDERS[name]));

export const providerFor = (name) => PROVIDERS[name] ?? null;

/** Whether a provider has its credentials configured. */
export const isConfigured = (provider, env) =>
  Boolean(provider.clientId(env) && provider.clientSecret(env));

/** The callback this deployment will be reached at. */
const callbackUrl = (request, providerName) =>
  new URL(`/api/auth/${providerName}/callback`, new URL(request.url).origin).toString();

const randomState = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Begin a login: mint state, stash it in a short-lived cookie, hand back the provider URL.
 * The caller has already verified Turnstile.
 */
export function startLogin(request, env, provider) {
  const state = randomState();
  const params = new URLSearchParams({
    client_id: provider.clientId(env),
    redirect_uri: callbackUrl(request, provider.id),
    scope: provider.scope,
    state,
    response_type: 'code',
  });

  return {
    redirectUrl: `${provider.authorizeUrl}?${params}`,
    cookie: cookieHeader(state, {
      name: STATE_COOKIE,
      maxAge: STATE_TTL_SECONDS,
      secure: !isLocal(request),
    }),
  };
}

/** Swap the authorization code for an access token. */
async function exchangeCode(request, env, provider, code, fetchImpl) {
  const params = {
    client_id: provider.clientId(env),
    client_secret: provider.clientSecret(env),
    code,
    redirect_uri: callbackUrl(request, provider.id),
    grant_type: 'authorization_code',
  };

  const body = provider.tokenBody ? provider.tokenBody(params) : JSON.stringify(params);
  const res = await fetchImpl(provider.tokenUrl, {
    method: 'POST',
    headers: provider.tokenHeaders(),
    body,
  });

  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const payload = await res.json();
  if (!payload.access_token) throw new Error('token exchange returned no access_token');
  return payload.access_token;
}

/** Read the provider's idea of who this is. */
async function fetchIdentity(provider, accessToken, fetchImpl) {
  const res = await fetchImpl(provider.userUrl, { headers: provider.userHeaders(accessToken) });
  if (!res.ok) throw new Error(`profile fetch failed: ${res.status}`);
  return provider.identity(await res.json());
}

/**
 * Finish a login: verify state, exchange, upsert the user, open a session.
 *
 * @returns {Promise<{ ok: true, cookies: string[] } | { ok: false, reason: string }>}
 */
export async function completeLogin(request, env, provider, { fetchImpl = fetch, now = Date.now() } = {}) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = readCookie(request, STATE_COOKIE);

  // The state cookie is the whole CSRF defence for this flow.
  if (!code) return { ok: false, reason: 'missing_code' };
  if (!state || !expected || state !== expected) return { ok: false, reason: 'bad_state' };
  if (!isConfigured(provider, env)) return { ok: false, reason: 'not_configured' };

  const accessToken = await exchangeCode(request, env, provider, code, fetchImpl);
  const identity = await fetchIdentity(provider, accessToken, fetchImpl);
  if (!identity.providerId) return { ok: false, reason: 'no_identity' };

  const user = await upsertUser(env, { provider: provider.id, ...identity }, now);
  const { token } = await createSession(env, user.id, now);

  return {
    ok: true,
    cookies: [
      cookieHeader(token, { secure: !isLocal(request) }),
      // The state cookie has done its job.
      cookieHeader('', { name: STATE_COOKIE, maxAge: 0, secure: !isLocal(request) }),
    ],
  };
}

export { STATE_COOKIE };
