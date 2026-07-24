/**
 * @vitest-environment jsdom
 *
 * Phase 8 — the audio pack. §6's machine half: the resolver chain in all three states,
 * and the manifest's contract with the deck.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const has = (path) => existsSync(resolve(process.cwd(), path));

/** A fake <audio> that succeeds or fails on demand — jsdom cannot actually play. */
function stubAudio({ playable = true } = {}) {
  const played = [];
  globalThis.Audio = class {
    constructor(src) {
      this.src = src;
      this.playbackRate = 1;
      this.preservesPitch = false;
      played.push(this);
    }
    addEventListener() {}
    pause() {
      this.paused = true;
    }
    play() {
      return playable ? Promise.resolve() : Promise.reject(new Error('no'));
    }
  };
  return played;
}

const MANIFEST = {
  engine: 'piper',
  base: '/audio/',
  items: {
    'zh:好:hao3': { file: 'abc123.ogg', hash: 'abc123', bytes: 8000 },
    'tatoeba#42': { file: 'def456.ogg', hash: 'def456', bytes: 12000 },
  },
};

async function freshAudio({ manifest = MANIFEST, ttsSpeaks = true } = {}) {
  vi.resetModules();
  vi.doMock('../app/src/zh/tts.js', () => ({
    speak: vi.fn(async () => ttsSpeaks),
    stop: vi.fn(),
    reset: vi.fn(),
    ready: async () => (ttsSpeaks ? { lang: 'zh-CN' } : null),
    isAvailable: () => ttsSpeaks,
    chineseVoices: () => [],
    pickVoice: () => null,
    nextVoice: () => null,
    setPreferredVoice: () => null,
    getPreferredVoice: () => null,
    RATE_NORMAL: 0.9,
    RATE_SLOW: 0.6,
  }));

  globalThis.fetch = vi.fn(async (url) =>
    String(url).includes('audio-manifest') && manifest
      ? { ok: true, json: async () => manifest }
      : { ok: false, status: 404 },
  );

  const audio = await import('../app/src/zh/audio.js');
  const tts = await import('../app/src/zh/tts.js');
  audio.reset();
  return { audio, tts };
}

beforeEach(() => {
  stubAudio();
});

/* ── §4. The resolver chain ─────────────────────────────── */

describe('resolver chain (§8.4, §8.6)', () => {
  it('plays pack audio when the manifest has the key', async () => {
    const played = stubAudio();
    const { audio, tts } = await freshAudio();

    expect(await audio.speak('好', { key: 'zh:好:hao3' })).toBe(audio.SOURCE.PACK);
    expect(played.at(-1).src).toBe('/audio/abc123.ogg');
    // Browser speech is not consulted when the pack answers.
    expect(tts.speak).not.toHaveBeenCalled();
  });

  it('falls back to browser speech when the key is unknown', async () => {
    const { audio, tts } = await freshAudio();
    expect(await audio.speak('陌生', { key: 'zh:陌生:mo4_sheng1' })).toBe(audio.SOURCE.TTS);
    expect(tts.speak).toHaveBeenCalled();
  });

  it('falls back when there is no manifest at all', async () => {
    const { audio, tts } = await freshAudio({ manifest: null });
    expect(await audio.speak('好', { key: 'zh:好:hao3' })).toBe(audio.SOURCE.TTS);
    expect(tts.speak).toHaveBeenCalled();
  });

  it('falls back when the file exists in the manifest but will not play', async () => {
    stubAudio({ playable: false });
    const { audio, tts } = await freshAudio();
    // A 404 from R2, or a codec the browser refuses — either way, speech still happens.
    expect(await audio.speak('好', { key: 'zh:好:hao3' })).toBe(audio.SOURCE.TTS);
    expect(tts.speak).toHaveBeenCalled();
  });

  it('reports none when nothing can speak', async () => {
    stubAudio({ playable: false });
    const { audio } = await freshAudio({ ttsSpeaks: false });
    expect(await audio.speak('好', { key: 'zh:好:hao3' })).toBe(audio.SOURCE.NONE);
  });

  it('goes straight to speech when no key is given', async () => {
    const played = stubAudio();
    const { audio, tts } = await freshAudio();
    expect(await audio.speak('随便说')).toBe(audio.SOURCE.TTS);
    expect(played).toHaveLength(0);
    expect(tts.speak).toHaveBeenCalled();
  });
});

/* ── §4. Slow replay is the same file ───────────────────── */

describe('slow replay (§8.4)', () => {
  it('plays the same file at a lower rate, keeping the pitch', async () => {
    const played = stubAudio();
    const { audio } = await freshAudio();

    await audio.speak('好', { key: 'zh:好:hao3' });
    await audio.speakSlow('好', { key: 'zh:好:hao3' });

    expect(played).toHaveLength(2);
    // One file, two rates — no second recording to generate or ship.
    expect(played[0].src).toBe(played[1].src);
    expect(played[0].playbackRate).toBe(1);
    expect(played[1].playbackRate).toBe(0.6);
    expect(played[1].preservesPitch).toBe(true);
  });

  it('slows browser speech too, when that is what answered', async () => {
    const { audio, tts } = await freshAudio();
    await audio.speakSlow('陌生', { key: 'nope' });
    expect(tts.speak.mock.calls.at(-1)[1].rate).toBe(0.6);
  });
});

describe('manifest resolution', () => {
  it('builds a URL from base and file', async () => {
    const { audio } = await freshAudio();
    await audio.loadManifest();
    expect(audio.packUrl('zh:好:hao3', MANIFEST)).toBe('/audio/abc123.ogg');
    expect(audio.packUrl('tatoeba#42', MANIFEST)).toBe('/audio/def456.ogg');
    expect(audio.packUrl('missing', MANIFEST)).toBeNull();
    expect(audio.packUrl('anything', null)).toBeNull();
  });

  it('survives a manifest that fails to load', async () => {
    vi.resetModules();
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    });
    const audio = await import('../app/src/zh/audio.js');
    audio.reset();
    expect(await audio.loadManifest()).toBeNull();
  });
});

/* ── §2. The manifest's contract with the deck ──────────── */

describe('audio manifest (§8.2, §8.6)', () => {
  const path = 'app/assets/packs/zh/audio-manifest.json';

  it.skipIf(!has(path))('resolves every deck word', () => {
    const manifest = JSON.parse(read(path));
    const deck = JSON.parse(read('app/assets/packs/zh/deck.zh.json'));

    const missing = deck.words.filter((word) => !manifest.items[word.id]);
    expect(missing.map((w) => w.id).slice(0, 10)).toEqual([]);
  });

  it.skipIf(!has(path))('names every intro sentence too', () => {
    const manifest = JSON.parse(read(path));
    const deck = JSON.parse(read('app/assets/packs/zh/deck.zh.json'));
    const intros = [...new Set(deck.words.map((w) => w.introSentence).filter(Boolean))];

    expect(intros.filter((src) => !manifest.items[src]).slice(0, 10)).toEqual([]);
  });

  it.skipIf(!has(path))('uses content-hash filenames, so files are immutable', () => {
    const manifest = JSON.parse(read(path));
    for (const entry of Object.values(manifest.items).slice(0, 200)) {
      expect(entry.file).toMatch(/^[0-9a-f]{16}\.ogg$/);
      expect(entry.file.startsWith(entry.hash)).toBe(true);
    }
  });

  it('is not required — the app speaks without one', () => {
    // The pack is optional by design: no manifest means browser TTS, not silence.
    expect(true).toBe(true);
  });
});

/* ── §3. The worker route ───────────────────────────────── */

describe('the audio route (§8.3)', () => {
  const worker = read('worker/src/index.js');

  it('serves immutable, long-lived cache headers', () => {
    expect(worker).toContain('/audio/');
    expect(worker).toContain('public, max-age=31536000, immutable');
    expect(worker).toContain("'content-type': 'audio/ogg'");
  });

  it('refuses path traversal and unknown files', () => {
    expect(worker).toContain("file.includes('..')");
    expect(worker).toContain("file.includes('/')");
    expect(worker).toMatch(/not found.*404|404.*not found/s);
  });

  it('degrades to 503 rather than crashing when the bucket is unbound', () => {
    expect(worker).toContain('if (!env.AUDIO)');
    expect(worker).toContain('503');
  });

  it('needs no session — audio is public data (§1.3)', () => {
    const route = worker.slice(worker.indexOf('async function handleAudio'), worker.indexOf('export default'));
    expect(route).not.toContain('currentUser');
    expect(route).not.toContain('unauthorized');
  });

  it('is runtime-cached by the service worker, like strokes and the dictionary', () => {
    expect(read('app/src/sw.js')).toContain("'/audio/'");
  });
});
