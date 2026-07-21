/**
 * Speech for listening cards, via the platform's own `speechSynthesis` (§9).
 *
 * No network, no third-party service — if the device has no Chinese voice, the app says
 * so once and listening cards fall back to showing text (§1.2).
 */

const RATE = 0.9;
const LANG_PREFIX = 'zh';
const PREFERRED = 'zh-CN';

let cachedVoice;
let voicesResolved = false;

/** The platform voice list, which several browsers populate asynchronously. */
function allVoices() {
  if (typeof speechSynthesis === 'undefined') return [];
  return speechSynthesis.getVoices() ?? [];
}

/** Pick a Chinese voice, preferring zh-CN (§9). */
export function pickVoice(voices = allVoices()) {
  const chinese = voices.filter((v) => String(v.lang ?? '').toLowerCase().startsWith(LANG_PREFIX));
  if (chinese.length === 0) return null;
  const preferred = chinese.find((v) => String(v.lang).toLowerCase() === PREFERRED.toLowerCase());
  return preferred ?? chinese[0];
}

/**
 * Resolve the voice once. Browsers that populate voices lazily fire `voiceschanged`;
 * we wait briefly for it rather than declaring "no voice" too early.
 */
export function ready(timeoutMs = 1000) {
  if (voicesResolved) return Promise.resolve(cachedVoice);
  if (typeof speechSynthesis === 'undefined') {
    voicesResolved = true;
    cachedVoice = null;
    return Promise.resolve(null);
  }

  const settle = () => {
    cachedVoice = pickVoice();
    voicesResolved = true;
    return cachedVoice;
  };

  if (allVoices().length > 0) return Promise.resolve(settle());

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      speechSynthesis.removeEventListener('voiceschanged', finish);
      resolve(settle());
    };
    speechSynthesis.addEventListener('voiceschanged', finish);
    setTimeout(finish, timeoutMs);
  });
}

/** Whether audio is available at all. Call after `ready()`. */
export const isAvailable = () => Boolean(cachedVoice);

/** Stop anything currently speaking. */
export function stop() {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

/**
 * Speak Chinese text.
 * @returns {Promise<boolean>} false when no voice is available
 */
export async function speak(text) {
  const voice = await ready();
  if (!voice || !text) return false;

  stop();
  const utterance = new SpeechSynthesisUtterance(String(text));
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = RATE;
  speechSynthesis.speak(utterance);
  return true;
}

/** Reset cached state — tests and the settings screen use this. */
export function reset() {
  cachedVoice = undefined;
  voicesResolved = false;
}
