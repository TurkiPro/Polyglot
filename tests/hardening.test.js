/**
 * Hardening suite: event validation bounds and rate-limiter identity.
 * These are the invariants the API tests exercise end-to-end; here they are pinned
 * as units so a refactor cannot loosen them silently.
 */
import { describe, expect, it } from 'vitest';
import { validEvent } from '../worker/src/api/sync.js';
import { clientIp } from '../worker/src/mw/ratelimit.js';

const NOW = 1_800_000_000_000;
const good = (over = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  cardId: 'zh:好:hao3#REC',
  rating: 3,
  ts: NOW - 1000,
  durMs: 4200,
  ...over,
});

describe('validEvent bounds', () => {
  it('accepts a well-formed event, with or without durMs', () => {
    expect(validEvent(good(), NOW)).toBe(true);
    expect(validEvent(good({ durMs: undefined }), NOW)).toBe(true);
    expect(validEvent(good({ durMs: null }), NOW)).toBe(true);
  });

  it('caps id at 64 chars', () => {
    expect(validEvent(good({ id: 'x'.repeat(64) }), NOW)).toBe(true);
    expect(validEvent(good({ id: 'x'.repeat(65) }), NOW)).toBe(false);
  });

  it('caps cardId at 120 chars', () => {
    expect(validEvent(good({ cardId: 'c'.repeat(120) }), NOW)).toBe(true);
    expect(validEvent(good({ cardId: 'c'.repeat(121) }), NOW)).toBe(false);
  });

  it('rejects timestamps beyond a week of clock skew, and non-positive ones', () => {
    expect(validEvent(good({ ts: NOW + 6 * 86_400_000 }), NOW)).toBe(true);
    expect(validEvent(good({ ts: NOW + 8 * 86_400_000 }), NOW)).toBe(false);
    expect(validEvent(good({ ts: 0 }), NOW)).toBe(false);
    expect(validEvent(good({ ts: -5 }), NOW)).toBe(false);
  });

  it('bounds durMs to [0, one hour] integers when present', () => {
    expect(validEvent(good({ durMs: 0 }), NOW)).toBe(true);
    expect(validEvent(good({ durMs: 3_600_000 }), NOW)).toBe(true);
    expect(validEvent(good({ durMs: 3_600_001 }), NOW)).toBe(false);
    expect(validEvent(good({ durMs: -1 }), NOW)).toBe(false);
    expect(validEvent(good({ durMs: 12.5 }), NOW)).toBe(false);
  });

  it('still enforces the original shape rules', () => {
    expect(validEvent(good({ rating: 0 }), NOW)).toBe(false);
    expect(validEvent(good({ rating: 5 }), NOW)).toBe(false);
    expect(validEvent(good({ id: '' }), NOW)).toBe(false);
    expect(validEvent(null, NOW)).toBe(false);
  });
});

describe('clientIp', () => {
  const withHeaders = (headers) => new Request('https://example.com/', { headers });

  it('uses cf-connecting-ip when present', () => {
    expect(clientIp(withHeaders({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('ignores x-forwarded-for — a spoofable key is a limiter bypass', () => {
    expect(
      clientIp(withHeaders({ 'x-forwarded-for': '198.51.100.1', 'cf-connecting-ip': '203.0.113.7' })),
    ).toBe('203.0.113.7');
    expect(clientIp(withHeaders({ 'x-forwarded-for': '198.51.100.1' }))).toBe('local');
  });

  it('falls back to local with no headers at all', () => {
    expect(clientIp(withHeaders({}))).toBe('local');
  });
});
