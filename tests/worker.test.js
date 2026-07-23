/**
 * Worker units (§11) that need no database.
 *
 * The end-to-end behaviour — sessions, sync, cursors, deletion — is covered by
 * `scripts/api-tests.sh` against a live `wrangler dev`. This file pins the pieces where a
 * quiet mistake would be a security bug rather than a visible failure.
 */
import { describe, expect, it } from 'vitest';
import { config } from '../config/app.config.js';
import {
  COOKIE_NAME,
  clearCookieHeader,
  cookieHeader,
  hashToken,
  isLocal,
  newToken,
  readCookie,
} from '../worker/src/auth/sessions.js';
import { enabledProviders, isConfigured, providerFor } from '../worker/src/auth/oauth.js';
import { LIMITS, clientIp } from '../worker/src/mw/ratelimit.js';
import { CSP, secure } from '../worker/src/mw/security.js';
import { verifyTurnstile } from '../worker/src/mw/turnstile.js';

describe('session tokens', () => {
  it('mints 32 bytes of base64url, never repeating', () => {
    const tokens = new Set();
    for (let i = 0; i < 200; i++) {
      const token = newToken();
      // 32 bytes → 43 base64url characters, unpadded.
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      tokens.add(token);
    }
    expect(tokens.size).toBe(200);
  });

  it('stores only a hash — the token itself is never recoverable from it', async () => {
    const token = newToken();
    const hash = await hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    // Stable, so a returning cookie matches its row.
    expect(await hashToken(token)).toBe(hash);
    expect(await hashToken(newToken())).not.toBe(hash);
  });

  it('matches a known SHA-256, so the digest is really SHA-256', async () => {
    expect(await hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('session cookie', () => {
  it('carries every flag §11 requires', () => {
    const header = cookieHeader('tok');
    expect(header).toContain(`${COOKIE_NAME}=tok`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain(`Max-Age=${config.auth.sessionTtlDays * 86400}`);
  });

  it('drops Secure only for localhost, where a dev browser would refuse it', () => {
    expect(cookieHeader('tok', { secure: false })).not.toContain('Secure');
    expect(isLocal(new Request('http://localhost:8787/'))).toBe(true);
    expect(isLocal(new Request('http://127.0.0.1:8787/'))).toBe(true);
    expect(isLocal(new Request('https://polyglot.example.workers.dev/'))).toBe(false);
  });

  it('clears with Max-Age=0', () => {
    expect(clearCookieHeader()).toContain('Max-Age=0');
  });

  it('reads one cookie out of a header without matching a prefix', () => {
    const request = (value) => new Request('https://x/', { headers: { cookie: value } });
    expect(readCookie(request(`${COOKIE_NAME}=abc`))).toBe('abc');
    expect(readCookie(request(`other=1; ${COOKIE_NAME}=abc; more=2`))).toBe('abc');
    // A cookie whose name merely starts the same must not be mistaken for the session.
    expect(readCookie(request(`${COOKIE_NAME}_other=nope`))).toBeNull();
    expect(readCookie(request('nothing=1'))).toBeNull();
    expect(readCookie(new Request('https://x/'))).toBeNull();
  });
});

describe('security headers', () => {
  it('states every directive §11 asks for', () => {
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ]) {
      expect(CSP).toContain(directive);
    }
    // No escape hatches: these are what the whole no-inline rule rests on.
    expect(CSP).not.toContain('unsafe-inline');
    expect(CSP).not.toContain('unsafe-eval');
    expect(CSP).not.toContain('*');
  });

  it('puts the CSP on HTML and the rest on everything', () => {
    const html = secure(new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }));
    expect(html.headers.get('content-security-policy')).toBe(CSP);
    expect(html.headers.get('x-content-type-options')).toBe('nosniff');
    expect(html.headers.get('referrer-policy')).toBe('no-referrer');

    const json = secure(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    expect(json.headers.get('content-security-policy')).toBeNull();
    expect(json.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('preserves the status and body it wraps', async () => {
    const wrapped = secure(new Response('{"error":"nope"}', { status: 404 }));
    expect(wrapped.status).toBe(404);
    expect(await wrapped.text()).toBe('{"error":"nope"}');
  });
});

describe('rate limits', () => {
  it('reads its rules from §0 rather than restating them', () => {
    expect(LIMITS.auth).toEqual({
      requests: config.auth.rateLimitAuth.requests,
      windowMs: config.auth.rateLimitAuth.windowMinutes * 60000,
    });
    expect(LIMITS.api).toEqual({
      requests: config.auth.rateLimitApi.requests,
      windowMs: config.auth.rateLimitApi.windowMinutes * 60000,
    });
  });

  it('identifies a caller by Cloudflare\'s header first', () => {
    const request = (headers) => new Request('https://x/', { headers });
    expect(clientIp(request({ 'cf-connecting-ip': '1.2.3.4' }))).toBe('1.2.3.4');
    expect(clientIp(request({ 'x-forwarded-for': '5.6.7.8' }))).toBe('5.6.7.8');
    expect(clientIp(request({}))).toBe('unknown');
  });
});

describe('oauth wiring', () => {
  it('offers exactly the providers §0 lists, and only when configured', () => {
    expect(enabledProviders()).toEqual(config.auth.oauthProviders);
    for (const name of enabledProviders()) {
      const provider = providerFor(name);
      expect(provider, name).toBeTruthy();
      expect(isConfigured(provider, {})).toBe(false);
      expect(isConfigured(provider, { [`${name.toUpperCase()}_CLIENT_ID`]: 'a', [`${name.toUpperCase()}_CLIENT_SECRET`]: 'b' })).toBe(true);
    }
    expect(providerFor('nope')).toBeNull();
  });

  it('never puts a client secret in an authorize URL', async () => {
    const { startLogin } = await import('../worker/src/auth/oauth.js');
    const env = { GITHUB_CLIENT_ID: 'public-id', GITHUB_CLIENT_SECRET: 'super-secret' };
    const { redirectUrl, cookie } = startLogin(
      new Request('https://polyglot.example/api/auth/github/start'),
      env,
      providerFor('github'),
    );

    expect(redirectUrl).toContain('client_id=public-id');
    expect(redirectUrl).not.toContain('super-secret');
    expect(redirectUrl).toContain('redirect_uri=https%3A%2F%2Fpolyglot.example%2Fapi%2Fauth%2Fgithub%2Fcallback');

    // State is carried in an HttpOnly cookie, and echoed in the URL.
    const state = new URL(redirectUrl).searchParams.get('state');
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(cookie).toContain(state);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Max-Age=600');
  });
});

describe('turnstile', () => {
  it('fails closed when no secret is configured', async () => {
    expect(await verifyTurnstile({}, 'token')).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('rejects a missing token, and a token the service refuses', async () => {
    const env = { TURNSTILE_SECRET: 's' };
    expect(await verifyTurnstile(env, '')).toEqual({ ok: false, reason: 'missing_token' });

    const refuse = async () => ({ json: async () => ({ success: false }) });
    expect(await verifyTurnstile(env, 'bad', null, refuse)).toEqual({ ok: false, reason: 'rejected' });
  });

  it('accepts a token the service verifies, and fails closed if it cannot be reached', async () => {
    const env = { TURNSTILE_SECRET: 's' };
    const accept = async () => ({ json: async () => ({ success: true }) });
    expect(await verifyTurnstile(env, 'good', null, accept)).toEqual({ ok: true });

    const down = async () => {
      throw new Error('network');
    };
    expect(await verifyTurnstile(env, 'good', null, down)).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('is bypassed only in DEV_MODE, where there is no widget to solve', async () => {
    expect(await verifyTurnstile({ DEV_MODE: '1' }, undefined)).toEqual({ ok: true, reason: 'dev' });
  });
});

/**
 * §12 — the CSP widens for Turnstile only when an operator configured it.
 */
describe('CSP and the one third party', () => {
  it('names no third party by default', async () => {
    const { directives, TURNSTILE_ORIGIN } = await import('../worker/src/mw/security.js');
    const strict = directives();
    expect(strict).toContain("script-src 'self'");
    expect(strict).not.toContain(TURNSTILE_ORIGIN);
    expect(strict).not.toContain('frame-src');
    expect(directives({})).toBe(strict);
    expect(directives({ DEV_MODE: '1' })).toBe(strict);
  });

  it('allows challenges.cloudflare.com once a Turnstile secret exists', async () => {
    const { directives, TURNSTILE_ORIGIN } = await import('../worker/src/mw/security.js');
    const widened = directives({ TURNSTILE_SECRET: 'x' });

    expect(widened).toContain(`script-src 'self' ${TURNSTILE_ORIGIN}`);
    expect(widened).toContain(`frame-src ${TURNSTILE_ORIGIN}`);
    expect(widened).toContain(`connect-src 'self' ${TURNSTILE_ORIGIN}`);
    // Widened for exactly one origin, and no further.
    expect(widened).toContain("style-src 'self'");
    expect(widened).toContain("img-src 'self' data:");
    expect(widened).not.toContain('unsafe-inline');
  });

  it('carries the widened policy through to the response', async () => {
    const { directives, secure } = await import('../worker/src/mw/security.js');
    const html = () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } });

    expect(secure(html(), {}).headers.get('content-security-policy')).toBe(directives());
    expect(secure(html(), { TURNSTILE_SECRET: 'x' }).headers.get('content-security-policy')).toBe(
      directives({ TURNSTILE_SECRET: 'x' }),
    );
  });
});
