/**
 * @vitest-environment jsdom
 *
 * §12 — the widget is opt-in and scoped. This pins that it never loads on its own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config/app.config.js';
import { SCRIPT_URL, loadTurnstile, renderWidget, reset } from '../app/src/sync/turnstile.js';
import { relativeTime } from '../app/src/sync/account.js';

beforeEach(() => {
  reset();
  document.head.replaceChildren();
  delete globalThis.turnstile;
});

describe('turnstile loading', () => {
  it('ships with no site key, so a default deploy loads nothing', () => {
    // An operator opts in by filling this in (SELF_HOSTING step 5).
    expect(config.auth.turnstile.siteKey).toBe('');
  });

  it('injects the script only when asked, once', async () => {
    expect(document.querySelectorAll('script')).toHaveLength(0);

    const pending = loadTurnstile(document);
    const scripts = document.querySelectorAll('script');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe(SCRIPT_URL);
    expect(scripts[0].async).toBe(true);

    scripts[0].dispatchEvent(new window.Event('load'));
    expect(await pending).toBe(true);

    // A second call reuses the first promise rather than injecting again.
    await loadTurnstile(document);
    expect(document.querySelectorAll('script')).toHaveLength(1);
  });

  it('reports failure instead of hanging when the script cannot load', async () => {
    const pending = loadTurnstile(document);
    document.querySelector('script').dispatchEvent(new window.Event('error'));
    expect(await pending).toBe(false);
  });
});

describe('turnstile widget', () => {
  it('resolves with the token the widget produces', async () => {
    const host = document.createElement('div');
    const api = { render: (el, opts) => opts.callback('tok-123') };
    expect(await renderWidget(host, 'site-key', api)).toBe('tok-123');
  });

  it('rejects rather than resolving empty, so failure cannot pass as a token', async () => {
    const host = document.createElement('div');
    await expect(renderWidget(host, 'k', { render: (el, o) => o['error-callback']() })).rejects.toThrow(
      'turnstile_failed',
    );
    await expect(renderWidget(host, 'k', { render: (el, o) => o['expired-callback']() })).rejects.toThrow(
      'turnstile_expired',
    );
    await expect(renderWidget(host, 'k', undefined)).rejects.toThrow('turnstile_unavailable');
  });

  it('passes the site key through', async () => {
    const host = document.createElement('div');
    const seen = vi.fn((el, opts) => opts.callback('t'));
    await renderWidget(host, 'my-site-key', { render: seen });
    expect(seen.mock.calls[0][1].sitekey).toBe('my-site-key');
  });
});

describe('sync status wording', () => {
  it('describes when a sync last happened', () => {
    const now = Date.UTC(2026, 6, 21, 12);
    expect(relativeTime(null, now)).toBe('never');
    expect(relativeTime(now - 5000, now)).toBe('just now');
    expect(relativeTime(now - 120000, now)).toBe('2 minutes ago');
    expect(relativeTime(now - 3600000, now)).toBe('1 hour ago');
    expect(relativeTime(now - 5 * 3600000, now)).toBe('5 hours ago');
    expect(relativeTime(now - 3 * 86400000, now)).toContain('202');
  });
});
