/**
 * Audio (Phase 8 §4): pack audio first, browser speech second, text last.
 *
 * Default Windows and browser Chinese voices flatten tones, which for a tonal language is
 * not a cosmetic problem — it teaches the wrong word. Pre-rendered pack audio fixes that
 * where it exists; browser TTS remains the fallback so the app still speaks on a device
 * with no pack, and a visible fallback covers the case where nothing can speak at all.
 *
 * This module replaces `tts.js` as the app's entry point for sound. Everything tts.js
 * exported still works, so no audio control needed changing.
 */
import { config } from '../../../config/app.config.js';
import * as tts from './tts.js';

export { RATE_NORMAL, RATE_SLOW, chineseVoices, getPreferredVoice, isAvailable, nextVoice, pickVoice, ready, setPreferredVoice } from './tts.js';

const LANG = config.pack.langPackV1;
const MANIFEST_URL = `/assets/packs/${LANG}/audio-manifest.json`;

/** Slow replay is the same file at a lower rate — no second file to generate or ship. */
const SLOW_RATE = 0.6;

/** How a request was satisfied, so callers and tests can tell them apart. */
export const SOURCE = Object.freeze({ PACK: 'pack', TTS: 'tts', NONE: 'none' });

let manifest = null;
let manifestLoaded = false;
/** Currently playing pack audio, so a new play stops the old one. */
let playing = null;

/**
 * Load the manifest once. A miss is not an error — it just means this deployment has no
 * audio pack, and the resolver falls through to browser speech.
 */
export async function loadManifest(fetchImpl = fetch) {
  if (manifestLoaded) return manifest;
  manifestLoaded = true;
  try {
    const res = await fetchImpl(MANIFEST_URL);
    manifest = res.ok ? await res.json() : null;
  } catch {
    manifest = null;
  }
  return manifest;
}

/** The URL for a key, or null when the pack has nothing for it. */
export function packUrl(key, loaded = manifest) {
  const entry = loaded?.items?.[key];
  if (!entry) return null;
  const file = typeof entry === 'string' ? entry : entry.file;
  return file ? `${loaded.base ?? '/audio/'}${file}` : null;
}

/**
 * Speak, preferring the pack.
 *
 * @param {string} text what to say, and the TTS fallback's input
 * @param {{ key?: string, rate?: number, rotate?: boolean, voice?: object }} [options]
 *   `key` is the manifest key — a word id or sentence id. Without one there is nothing to
 *   look up, so it goes straight to TTS.
 * @returns {Promise<'pack'|'tts'|'none'>} which source actually spoke
 */
export async function speak(text, { key, rate = 1, rotate = false, voice } = {}) {
  stop();
  if (!text && !key) return SOURCE.NONE;

  if (key) {
    const url = packUrl(key, await loadManifest());
    if (url && (await playFile(url, rate))) return SOURCE.PACK;
  }

  // Pack audio is already correct, so its "rate" is a playbackRate; TTS wants its own
  // scale, where 0.9 is normal.
  const spoken = await tts.speak(text, {
    rate: rate === 1 ? tts.RATE_NORMAL : tts.RATE_SLOW,
    rotate,
    voice,
  });
  return spoken ? SOURCE.TTS : SOURCE.NONE;
}

/** Speak slowly — the same file, played slower (§4). */
export const speakSlow = (text, options = {}) => speak(text, { ...options, rate: SLOW_RATE });

/** Play one file. Resolves false if it cannot be played, so the caller can fall through. */
function playFile(url, rate) {
  return new Promise((resolve) => {
    let audio;
    try {
      audio = new Audio(url);
    } catch {
      resolve(false);
      return;
    }

    audio.playbackRate = rate;
    // Keep the pitch: a slowed word should be the same voice, not a lower one.
    audio.preservesPitch = true;
    playing = audio;

    audio.addEventListener('error', () => resolve(false), { once: true });
    audio.addEventListener('playing', () => resolve(true), { once: true });

    audio.play().then(
      // Some browsers resolve play() before 'playing' fires; either is success.
      () => resolve(true),
      () => resolve(false),
    );
  });
}

/** Stop whatever is speaking, from either source. */
export function stop() {
  if (playing) {
    playing.pause();
    playing = null;
  }
  tts.stop();
}

/** Test seam. */
export function reset() {
  manifest = null;
  manifestLoaded = false;
  playing = null;
  tts.reset();
}
