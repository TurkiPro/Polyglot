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

/* ── Neon stroke ignition (Design v3 §2) ────────────────── */

const NS = 'http://www.w3.org/2000/svg';
/** One ignition, tuned so a multi-stroke character finishes in about 1.2s. */
const IGNITE_MS = 1200;

/** Honour the OS setting, and the app's own reduce-effects switch. */
const effectsOff = (doc = document) =>
  doc.documentElement.dataset.effects === 'off' ||
  (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/**
 * Light a character like a neon sign, stroke by stroke.
 *
 * The stroke data we already ship for handwriting quizzes turns out to be exactly what a
 * tube sign needs: an ordered set of paths. Drawing them in sequence under a blur filter
 * is a sign igniting — and it is the one thing this app can do that a flashcard app with
 * no stroke data cannot copy.
 *
 * The single implementation all four sanctioned uses share (§2). Reduced motion, or the
 * reduce-effects setting, renders the finished character at steady glow with no animation.
 *
 * @param {HTMLElement} host
 * @param {string} char
 * @param {{ color?: string, size?: number, duration?: number, onDone?: () => void }} [options]
 * @returns {{ destroy: () => void }}
 */
export function neonIgnite(host, char, { color = 'var(--accent)', size = 160, duration = IGNITE_MS, onDone } = {}) {
  host.replaceChildren();
  host.classList.add('neon-sign');
  host.style.setProperty('--neon-color', color);

  const still = effectsOff(host.ownerDocument ?? document);
  let writer = null;
  let cancelled = false;

  // A filter per instance, because two signs on one screen may burn different colours.
  const filterId = `neon-${Math.random().toString(36).slice(2, 9)}`;
  const defs = document.createElementNS(NS, 'svg');
  defs.setAttribute('width', '0');
  defs.setAttribute('height', '0');
  defs.setAttribute('aria-hidden', 'true');
  defs.classList.add('neon-defs');
  const filter = document.createElementNS(NS, 'filter');
  filter.setAttribute('id', filterId);
  filter.setAttribute('x', '-50%');
  filter.setAttribute('y', '-50%');
  filter.setAttribute('width', '200%');
  filter.setAttribute('height', '200%');

  const blur = document.createElementNS(NS, 'feGaussianBlur');
  blur.setAttribute('stdDeviation', '3');
  blur.setAttribute('result', 'glow');
  const merge = document.createElementNS(NS, 'feMerge');
  for (const input of ['glow', 'glow', 'SourceGraphic']) {
    const node = document.createElementNS(NS, 'feMergeNode');
    node.setAttribute('in', input);
    merge.append(node);
  }
  filter.append(blur, merge);
  defs.append(filter);
  host.append(defs);

  const stage = document.createElement('div');
  stage.className = 'neon-stage';
  host.append(stage);

  try {
    writer = HanziWriter.create(stage, char, {
      width: size,
      height: size,
      padding: 8,
      showOutline: false,
      showCharacter: still,
      strokeColor: color,
      charDataLoader: (character, onLoad, onError) => {
        loadCharData(character).then(onLoad).catch(onError);
      },
      onLoadCharDataError: () => fallback(stage, char),
    });

    stage.querySelector('svg')?.setAttribute('filter', `url(#${filterId})`);

    if (!still) {
      writer.animateCharacter({
        onComplete: () => {
          if (!cancelled) {
            host.classList.add('lit');
            onDone?.();
          }
        },
      });
      // Hold the finished glow even if the animation never reports back.
      setTimeout(() => {
        if (!cancelled) host.classList.add('lit');
      }, duration);
    } else {
      host.classList.add('lit');
      onDone?.();
    }
  } catch {
    fallback(stage, char);
    host.classList.add('lit');
    onDone?.();
  }

  return {
    destroy: () => {
      cancelled = true;
      try {
        writer?.cancelQuiz();
      } catch {
        // Nothing was running.
      }
      host.replaceChildren();
      host.classList.remove('neon-sign', 'lit');
    },
  };
}

/** No stroke data: the character still lights, it just does not draw itself. */
function fallback(stage, char) {
  const text = document.createElement('div');
  text.className = 'neon-fallback';
  text.textContent = char;
  stage.replaceChildren(text);
}
