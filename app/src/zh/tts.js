/**
 * Speech for listening cards, via the platform's own `speechSynthesis` (§9).
 *
 * No network, no third-party service — if the device has no Chinese voice, the app says
 * so once and listening cards fall back to showing text (§1.2).
 *
 * Which voice is used matters more than anything else here: platform default voices vary
 * from good to barely intelligible, so §3.4.4 lets the learner choose and remember one.
 */

export const RATE_NORMAL = 0.9;
/** Slow replay, for catching a tone or a syllable boundary (§3.4.4). */
export const RATE_SLOW = 0.6;

const LANG_PREFIX = 'zh';
const PREFERRED = 'zh-CN';

let cachedVoice;
let voicesResolved = false;
/** The voice the learner chose, by voiceURI; null means "let us pick". */
let preferredUri = null;

/** The platform voice list, which several browsers populate asynchronously. */
function allVoices() {
  if (typeof speechSynthesis === 'undefined') return [];
  return speechSynthesis.getVoices() ?? [];
}

/** Every Chinese voice this device offers, for the picker (§3.4.4). */
export function chineseVoices(voices = allVoices()) {
  return voices.filter((v) => String(v.lang ?? '').toLowerCase().startsWith(LANG_PREFIX));
}

/**
 * Pick a Chinese voice: the learner's choice if it is still installed, else zh-CN, else
 * any Chinese voice at all.
 */
export function pickVoice(voices = allVoices(), chosenUri = preferredUri) {
  const chinese = chineseVoices(voices);
  if (chinese.length === 0) return null;

  // A chosen voice can disappear — a profile moves, an OS voice is uninstalled.
  const chosen = chosenUri && chinese.find((v) => v.voiceURI === chosenUri);
  if (chosen) return chosen;

  const preferred = chinese.find((v) => String(v.lang).toLowerCase() === PREFERRED.toLowerCase());
  return preferred ?? chinese[0];
}

/** Remember the learner's choice. Pass null to go back to automatic. */
export function setPreferredVoice(voiceURI) {
  preferredUri = voiceURI || null;
  // Re-resolve on the next call rather than holding a stale voice.
  voicesResolved = false;
  cachedVoice = undefined;
  return preferredUri;
}

export const getPreferredVoice = () => preferredUri;

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
 * @param {string} text
 * @param {{ rate?: number, voice?: SpeechSynthesisVoice }} [options]
 * @returns {Promise<boolean>} false when no voice is available
 */
export async function speak(text, { rate = RATE_NORMAL, voice } = {}) {
  const chosen = voice ?? (await ready());
  if (!chosen || !text) return false;

  stop();
  const utterance = new SpeechSynthesisUtterance(String(text));
  utterance.voice = chosen;
  utterance.lang = chosen.lang;
  utterance.rate = rate;
  speechSynthesis.speak(utterance);
  return true;
}

/** Speak slowly — the 🐢 half of every audio control (§3.4.4). */
export const speakSlow = (text, options = {}) => speak(text, { ...options, rate: RATE_SLOW });

/** Reset cached state — tests and the settings screen use this. */
export function reset() {
  cachedVoice = undefined;
  voicesResolved = false;
  preferredUri = null;
}
