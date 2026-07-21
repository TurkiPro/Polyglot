/**
 * Handwriting quizzes, via hanzi-writer pointed at the pack's local stroke data (§5.3).
 *
 * No CDN at runtime (§1.2): `charDataLoader` fetches from `/assets/packs/<lang>/strokes/`,
 * which the service worker caches on first use.
 */
import HanziWriter from 'hanzi-writer';
import { config } from '../../../config/app.config.js';

const LANG = config.pack.langPackV1;
const STROKES_BASE = `/assets/packs/${LANG}/strokes`;

/** Stroke data is immutable per pack version, so a hit is good forever. */
const cache = new Map();

/** Fetch one character's stroke data from the pack. */
export async function loadCharData(char, { fetchImpl = fetch } = {}) {
  if (cache.has(char)) return cache.get(char);
  const res = await fetchImpl(`${STROKES_BASE}/${encodeURIComponent(char)}.json`);
  if (!res.ok) throw new Error(`no stroke data for ${char}`);
  const data = await res.json();
  cache.set(char, data);
  return data;
}

/** Whether a character can be quizzed at all. */
export async function hasStrokeData(char) {
  try {
    await loadCharData(char);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mount a quiz for one character.
 *
 * The outline is shown for the first character of a word and hidden for the rest (§9),
 * so the learner gets a way in without being handed the whole answer.
 *
 * @param {HTMLElement} target
 * @param {string} char
 * @param {{ showOutline?: boolean, onMistake?: () => void, onComplete?: (m: number) => void }} options
 * @returns {{ writer: object, reveal: () => void, destroy: () => void }}
 */
export function mountQuiz(target, char, { showOutline = false, onMistake, onComplete } = {}) {
  const writer = HanziWriter.create(target, char, {
    width: 220,
    height: 220,
    padding: 12,
    showCharacter: false,
    showOutline,
    showHintAfterMisses: 3,
    highlightOnComplete: true,
    // Colours come from the stylesheet's variables so themes stay in one place.
    strokeColor: cssVar('--fg', '#e8e8ea'),
    outlineColor: cssVar('--border', '#2c2f36'),
    drawingColor: cssVar('--accent', '#6ea8fe'),
    highlightColor: cssVar('--t2', config.toneColors.t2),
    charDataLoader: (character, onLoad, onError) => {
      loadCharData(character).then(onLoad).catch(onError);
    },
  });

  let mistakes = 0;
  writer.quiz({
    onMistake: () => {
      mistakes += 1;
      onMistake?.(mistakes);
    },
    onComplete: (summary) => onComplete?.(summary?.totalMistakes ?? mistakes),
  });

  return {
    writer,
    mistakes: () => mistakes,
    /** Give up on this character: cancel the quiz and animate the strokes. */
    reveal: () => {
      writer.cancelQuiz();
      writer.showCharacter();
      writer.animateCharacter();
    },
    destroy: () => {
      try {
        writer.cancelQuiz();
      } catch {
        // The writer may not have finished loading; nothing to cancel.
      }
      target.replaceChildren();
    },
  };
}

/** Read a CSS variable, falling back when the stylesheet has not applied yet. */
function cssVar(name, fallback) {
  if (typeof getComputedStyle === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
