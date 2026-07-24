/**
 * The arcade layer (Design v3 §3) — stage surfaces only.
 *
 * Coin-op playfulness applied where a learner is *between* work: Home, the finished
 * session, Stats. Never mid-review — hundreds of study hours happen on tool surfaces, and
 * drama there is fatigue rather than delight (the stage/tool law).
 *
 * Everything here is inert when effects are off, which is both the OS reduced-motion
 * setting and the app's own switch.
 */
import { div, span } from './components.js';

/** One roll of the odometer. */
const ROLL_MS = 300;

/** True when animation should not happen — OS preference or the app's own switch. */
export function effectsEnabled(doc = document) {
  if (doc.documentElement.dataset.effects === 'off') return false;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return false;
  }
  return true;
}

/** Apply the reduce-effects setting to the document, killing glow and scanlines in CSS. */
export function applyEffects(enabled, el = document.documentElement) {
  el.dataset.effects = enabled === false ? 'off' : 'on';
  return el.dataset.effects;
}

/**
 * XP as an arcade SCORE, with digits that roll when the number changes.
 *
 * The roll is per digit and only for digits that actually changed, so gaining 2 XP moves
 * the last digit rather than churning the whole display.
 *
 * @param {number} value
 * @param {{ previous?: number, digits?: number }} [options]
 */
export function odometer(value, { previous = value, digits = 0 } = {}) {
  const text = String(Math.max(0, Math.round(value)));
  const padded = digits > 0 ? text.padStart(digits, '0') : text;
  const before = String(Math.max(0, Math.round(previous))).padStart(padded.length, '0');
  const animate = effectsEnabled() && previous !== value;

  const host = div({ class: 'odometer', attrs: { 'aria-label': String(value) } });

  padded.split('').forEach((digit, index) => {
    const cell = span({ class: 'odometer-digit', text: digit });
    if (animate && before[index] !== digit) {
      cell.classList.add('rolling');
      cell.style.setProperty('--roll-delay', `${index * 40}ms`);
    }
    host.append(cell);
  });

  if (animate) {
    setTimeout(() => {
      for (const cell of host.querySelectorAll('.rolling')) cell.classList.remove('rolling');
    }, ROLL_MS + padded.length * 40);
  }

  return host;
}

/**
 * The streak, as an arcade combo counter.
 *
 * A break renders quietly — no shake, no red, no "you lost it". Loss-aversion mechanics
 * are exactly the extrinsic pressure Phase 7 §6 rules out, and that reasoning applies to
 * visuals as much as to XP.
 */
export function comboCounter(streak, label) {
  const alive = streak > 0;
  const host = div({ class: `combo${alive ? ' combo-lit' : ''}` }, [
    span({ class: 'combo-flame', text: alive ? '🔥' : '' }),
    span({ class: 'combo-value', text: alive ? `×${streak}` : '—' }),
  ]);
  if (label) host.append(span({ class: 'combo-label', text: label }));
  return host;
}

/**
 * A badge as an enamel-pin medallion, with a glint the first time it is seen.
 *
 * `seen` is the caller's memory of which ids have already glinted — a reward that
 * re-fires on every visit stops reading as a reward.
 */
export function medallion(badge, label, { seen = new Set() } = {}) {
  const fresh = badge.earned && !seen.has(badge.id);
  const host = div({
    class: `medallion${badge.earned ? ' earned' : ''}${fresh && effectsEnabled() ? ' glint' : ''}`,
  }, [
    div({ class: 'medallion-face', text: badge.earned ? '✦' : '' }),
    div({ class: 'medallion-text' }, [
      span({ class: 'medallion-label', text: label }),
      badge.earned ? null : span({ class: 'medallion-progress', text: `${Math.round(badge.progress * 100)}%` }),
    ].filter(Boolean)),
  ]);

  if (fresh) seen.add(badge.id);
  return host;
}

/**
 * The CRT scanline overlay — stage backgrounds only, and never over reading.
 * Static when effects are off; the CSS handles that, this just marks the surface.
 */
export function stage(className, children = []) {
  return div({ class: `stage-surface ${className}`.trim() }, children);
}
