/**
 * Handwriting quizzes, via hanzi-writer pointed at the pack's local stroke data (§5.3).
 *
 * No CDN at runtime (§1.2): `charDataLoader` fetches from `/assets/packs/<lang>/strokes/`,
 * which the service worker caches on first use.
 */
import HanziWriter from 'hanzi-writer';
import { config } from '../../../config/app.config.js';
import { DEFAULT_THEME, NIGHT_MARKET_FALLBACK } from '../ui/theme.js';

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
export function mountQuiz(
  target,
  char,
  { showOutline = false, showHintAfterMisses = 3, demo = false, onMistake, onComplete } = {},
) {
  const writer = HanziWriter.create(target, char, {
    width: 220,
    height: 220,
    padding: 12,
    showCharacter: false,
    showOutline,
    showHintAfterMisses,
    highlightOnComplete: true,
    // Colours come from the stylesheet's variables so themes stay in one place; the fallbacks
    // (D1) track the night-market theme from one named constant, never a fossilised palette.
    strokeColor: cssVar('--fg', NIGHT_MARKET_FALLBACK['--fg']),
    outlineColor: cssVar('--border', NIGHT_MARKET_FALLBACK['--border']),
    drawingColor: cssVar('--accent', NIGHT_MARKET_FALLBACK['--accent']),
    highlightColor: cssVar('--t2', config.toneColors[DEFAULT_THEME].t2),
    charDataLoader: (character, onLoad, onError) => {
      loadCharData(character).then(onLoad).catch(onError);
    },
  });

  let mistakes = 0;
  const startQuiz = () =>
    writer.quiz({
      showHintAfterMisses,
      onMistake: () => {
        mistakes += 1;
        onMistake?.(mistakes);
      },
      onComplete: (summary) => onComplete?.(summary?.totalMistakes ?? mistakes),
    });

  // Practice mode demonstrates the stroke order once, then hands the pen over (#6). The
  // graded WRITE card skips the demo and quizzes straight away.
  if (demo) writer.animateCharacter({ onComplete: startQuiz });
  else startQuiz();

  return {
    writer,
    mistakes: () => mistakes,
    /**
     * Play the stroke order once, then resume the quiz. `onDone` fires when the animation
     * finishes, so the caller can chain characters one after another (feedback).
     */
    animate: (onDone) => {
      try {
        writer.cancelQuiz();
      } catch {
        // Nothing was running.
      }
      writer.animateCharacter({
        onComplete: () => {
          startQuiz();
          onDone?.();
        },
      });
    },
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
/** Past this, any path that has not lit a stroke gives up and shows the steady glyph. */
const FALLBACK_MS = 2000;

/** Honour the OS setting, and the app's own reduce-effects switch. */
const effectsOff = (doc = document) =>
  doc.documentElement.dataset.effects === 'off' ||
  (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** One line of local debug, never a network beat (§1.2). */
function debugPath(host, path, reason) {
  host.dataset.ignitePath = path;
  if (typeof console !== 'undefined') console.debug(`neonIgnite → ${path}${reason ? ` (${reason})` : ''}`);
}

/**
 * Light a character like a neon sign, stroke by stroke.
 *
 * The stroke data we already ship for handwriting quizzes turns out to be exactly what a
 * tube sign needs: an ordered set of paths. Drawing them in sequence under a blur filter
 * is a sign igniting — and it is the one thing this app can do that a flashcard app with
 * no stroke data cannot copy.
 *
 * The single implementation all four sanctioned uses share (§2). It is built to never
 * render nothing (audit F2): an earned reward that flickers out to an empty box is worse
 * than a plain one. The stroke data is fetched BEFORE any DOM is built, the target is
 * checked for being connected before the animation starts, and on ANY failure — bad data,
 * a detached node, a HanziWriter throw, or simply ~2s elapsing without a lit stroke — the
 * character is drawn at steady glow (`.neon-fallback`, a visible glyph with `--glow-sm`)
 * instead. Reduced motion and the reduce-effects switch take that steady render directly.
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

  let writer = null;
  let cancelled = false;
  let settled = false; // first of {animated, static} to run wins
  let notified = false;
  const notify = () => {
    if (!notified) {
      notified = true;
      onDone?.();
    }
  };
  const markLit = () => host.classList.add('lit');

  /** The guaranteed render: a visible, glowing character. Never an empty box (F2). */
  const goStatic = (reason) => {
    if (cancelled || settled) return;
    settled = true;
    neonFallback(host, char, size);
    markLit();
    debugPath(host, 'static', reason);
    notify();
  };

  /** The reward: draw the strokes one by one, from data already in hand. */
  const goAnimated = (data) => {
    if (cancelled || settled) return;
    settled = true;

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

    // The data is preloaded, so charDataLoader resolves synchronously — no in-flight fetch
    // can outlive the element and paint into a detached node.
    writer = HanziWriter.create(stage, char, {
      width: size,
      height: size,
      padding: 8,
      showOutline: false,
      showCharacter: false,
      strokeColor: color,
      charDataLoader: (_character, onLoad) => onLoad(data),
    });
    stage.querySelector('svg')?.setAttribute('filter', `url(#${filterId})`);
    debugPath(host, 'animated');

    let lit = false;
    writer.animateCharacter({
      onComplete: () => {
        if (cancelled) return;
        lit = true;
        markLit();
        notify();
      },
    });
    // Hold the finished glow even if the animation never reports back, forcing the glyph
    // visible; if even that fails, fall through to the steady character rather than a blank.
    setTimeout(() => {
      if (cancelled || lit) return;
      try {
        writer?.showCharacter();
        markLit();
        notify();
      } catch {
        neonFallback(host, char, size);
        markLit();
        debugPath(host, 'static', 'show-failed');
        notify();
      }
    }, duration);
  };

  // Reduced motion or effects off: the steady glyph is exactly the intended render.
  if (effectsOff(host.ownerDocument ?? document)) {
    goStatic('reduced-motion');
    return handle();
  }

  // A hard deadline in case the stroke fetch itself hangs — the reward still resolves.
  const deadline = setTimeout(() => goStatic('timeout'), FALLBACK_MS);

  // Preload the stroke data BEFORE touching the DOM; only a connected target animates.
  loadCharData(char)
    .then((data) => {
      clearTimeout(deadline);
      if (cancelled) return;
      if (!host.isConnected) return goStatic('detached');
      try {
        goAnimated(data);
      } catch {
        goStatic('animate-threw');
      }
    })
    .catch(() => {
      clearTimeout(deadline);
      goStatic('char-data');
    });

  function handle() {
    return {
      destroy: () => {
        cancelled = true;
        clearTimeout(deadline);
        try {
          writer?.cancelQuiz();
        } catch {
          // Nothing was running.
        }
        host.replaceChildren();
        host.classList.remove('neon-sign', 'lit');
        delete host.dataset.ignitePath;
      },
    };
  }
  return handle();
}

/** The steady-glow glyph: the character, visibly lit, drawn straight into the host. */
function neonFallback(host, char, size) {
  const text = document.createElement('div');
  text.className = 'neon-fallback';
  text.textContent = char;
  if (size) text.style.fontSize = `${size * 0.75}px`;
  host.replaceChildren(text);
}
