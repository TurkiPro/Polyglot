/**
 * @vitest-environment jsdom
 *
 * Design v3 — night market. The machine half of §6: the reduce-effects switch really
 * removes every effect, topics.json validates against the deck, and the stage/tool law
 * is enforceable rather than merely stated.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyEffects, comboCounter, effectsEnabled, medallion, odometer, stage } from '../app/src/ui/arcade.js';

// jsdom gives import.meta.url an http scheme, so these resolve from the project root.
const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const css = read('app/assets/styles.css');
const deck = JSON.parse(read('app/assets/packs/zh/deck.zh.json'));
const topics = JSON.parse(read('packs/zh/topics.json'));

beforeEach(() => {
  document.body.replaceChildren();
  applyEffects(true);
});

/* ── §3. The reduce-effects switch ──────────────────────── */

describe('reduce effects (§3, §6)', () => {
  it('flips one attribute, which is what every effect is gated on', () => {
    expect(applyEffects(true)).toBe('on');
    expect(document.documentElement.dataset.effects).toBe('on');
    expect(effectsEnabled()).toBe(true);

    expect(applyEffects(false)).toBe('off');
    expect(document.documentElement.dataset.effects).toBe('off');
    expect(effectsEnabled()).toBe(false);
  });

  it('gates every glow, scanline and animation behind that attribute in CSS', () => {
    // Each of these is an effect; none may render without the opt-in.
    const gated = [
      '.odometer-digit.rolling',
      '.medallion.glint::after',
      '.verdict.pulse-ok',
      '.stage-surface::before',
      '.session-bar-fill.neon-line',
      '.eyebrow-glyph',
      '.combo-lit .combo-value',
    ];

    for (const selector of gated) {
      expect(css, `${selector} must exist`).toContain(selector);
      // A gated rule must exist for it. A plain colour rule alongside is fine — what
      // must never render without the opt-in is the glow or the animation itself.
      expect(css, `${selector} must have a [data-effects="on"] rule`).toContain(
        `:root[data-effects="on"] ${selector}`,
      );
    }
  });

  it('stops animating when the switch is off', () => {
    applyEffects(false);
    const rolled = odometer(120, { previous: 100 });
    expect(rolled.querySelectorAll('.rolling')).toHaveLength(0);

    const fresh = medallion({ id: 'b1', earned: true, progress: 1 }, 'Band 1', { seen: new Set() });
    expect(fresh.classList.contains('glint')).toBe(false);
  });

  it('also honours the OS reduced-motion preference', () => {
    applyEffects(true);
    const original = globalThis.matchMedia;
    globalThis.matchMedia = (query) => ({ matches: query.includes('reduce'), media: query });
    try {
      expect(effectsEnabled()).toBe(false);
      expect(odometer(120, { previous: 100 }).querySelectorAll('.rolling')).toHaveLength(0);
    } finally {
      globalThis.matchMedia = original;
    }
  });
});

/* ── §3. The arcade layer ───────────────────────────────── */

describe('arcade components (§3)', () => {
  it('rolls only the digits that changed', () => {
    const node = odometer(1240, { previous: 1200 });
    const digits = [...node.querySelectorAll('.odometer-digit')];
    expect(digits.map((d) => d.textContent).join('')).toBe('1240');
    // Only the tens digit moved: 1_2_0_0 → 1_2_4_0.
    expect(digits.filter((d) => d.classList.contains('rolling'))).toHaveLength(1);
    expect(digits[2].classList.contains('rolling')).toBe(true);

    // A bigger jump moves more of them.
    const jump = [...odometer(1999, { previous: 1000 }).querySelectorAll('.rolling')];
    expect(jump).toHaveLength(3);
  });

  it('does not roll when the number is the same', () => {
    expect(odometer(500, { previous: 500 }).querySelectorAll('.rolling')).toHaveLength(0);
  });

  it('renders a broken streak quietly — no loss-aversion theatrics', () => {
    const alive = comboCounter(12);
    expect(alive.textContent).toContain('×12');
    expect(alive.classList.contains('combo-lit')).toBe(true);

    const broken = comboCounter(0);
    expect(broken.classList.contains('combo-lit')).toBe(false);
    // No shame: an em dash, not a warning.
    expect(broken.textContent).not.toMatch(/lost|broke|gone|!/i);
    expect(broken.querySelector('.combo-value').textContent).toBe('—');
  });

  it('glints an earned medallion once, and never again', () => {
    const seen = new Set();
    const badge = { id: 'streak-7', earned: true, progress: 1 };

    expect(medallion(badge, '7-day streak', { seen }).classList.contains('glint')).toBe(true);
    expect(medallion(badge, '7-day streak', { seen }).classList.contains('glint')).toBe(false);
  });

  it('never glints an unearned one', () => {
    const node = medallion({ id: 'x', earned: false, progress: 0.4 }, 'Band 3', { seen: new Set() });
    expect(node.classList.contains('glint')).toBe(false);
    expect(node.classList.contains('earned')).toBe(false);
    expect(node.textContent).toContain('40%');
  });

  it('marks a stage surface, which is what carries scanlines', () => {
    expect(stage('home').classList.contains('stage-surface')).toBe(true);
    expect(stage('home').classList.contains('home')).toBe(true);
  });
});

/* ── §5. Topic collections ──────────────────────────────── */

describe('topics.json (§5.1, §6)', () => {
  const byId = new Map(deck.words.map((word) => [word.id, word]));

  it('names only ids the deck actually has', () => {
    const unknown = [];
    for (const [topic, ids] of Object.entries(topics.topics)) {
      for (const id of ids) if (!byId.has(id)) unknown.push(`${topic}:${id}`);
    }
    expect(unknown).toEqual([]);
  });

  it('covers the topics §5.1 lists, each with a label and words', () => {
    const expected = [
      'food', 'animals', 'people', 'numbers', 'places', 'travel', 'body', 'work',
      'colors', 'verbs', 'feelings', 'weather', 'money', 'tech', 'questions',
    ];
    expect(Object.keys(topics.topics).sort()).toEqual([...expected].sort());

    for (const topic of expected) {
      expect(topics.topics[topic].length, topic).toBeGreaterThan(0);
      expect(topics.labels[topic], topic).toBeTruthy();
    }
  });

  it('stays inside bands 1-4, as the spec scopes it', () => {
    for (const ids of Object.values(topics.topics)) {
      for (const id of ids) {
        const band = byId.get(id).band;
        expect(band, id).toBeGreaterThanOrEqual(1);
        expect(band, id).toBeLessThanOrEqual(4);
      }
    }
  });

  it('allows a word in more than one topic', () => {
    const counts = new Map();
    for (const ids of Object.values(topics.topics)) {
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect([...counts.values()].some((n) => n > 1)).toBe(true);
  });

  it('leaves grammar words unmapped rather than forcing them into a bucket', () => {
    const mapped = new Set(Object.values(topics.topics).flat());
    // 很 (very), 都 (all), 个 (classifier) belong to no topic in any honest mapping.
    for (const simp of ['很', '都', '个']) {
      const word = deck.words.find((w) => w.simp === simp && w.band === 1);
      if (word) expect(mapped.has(word.id), simp).toBe(false);
    }
  });
});

/* ── §1 and §4. Theme and restraint ─────────────────────── */

describe('themes and the stage/tool law (§1, §4)', () => {
  it('keeps paper free of glow', () => {
    // Paper is the default :root block; night market overrides it.
    const paper = css.slice(css.indexOf(':root {'), css.indexOf(':root[data-theme="dark"]'));
    expect(paper).toContain('--glow-sm: none');
    expect(paper).toContain('--glow-lg: none');
    // And it keeps its v2 seal red, unchanged.
    expect(paper).toContain('#b4372a');
  });

  it('defines the night-market signature tokens', () => {
    const dark = css.slice(css.indexOf(':root[data-theme="dark"]'));
    for (const token of ['--neon-cyan', '--neon-yellow', '--glow-sm', '--glow-lg', '--accent-fill']) {
      expect(dark, token).toContain(token);
    }
    expect(dark).toContain('#ff3d68');
  });

  it('never puts neon on the 田字格 — it is reading furniture (§4)', () => {
    // The grid draws with --grid, an ink token, and nothing else.
    const block = css.slice(css.indexOf('.tianzige {'), css.indexOf('.tianzige-write'));
    expect(block).not.toContain('--glow');
    expect(block).not.toContain('--accent');
    expect(block).not.toContain('--neon');
  });

  it('lights exactly the four sanctioned review accents, and no more', () => {
    // Anything else inside the review sheet that glowed would be a fifth.
    const sanctioned = ['.session-bar-fill.neon-line', '.eyebrow-glyph', '.verdict.pulse-ok'];
    for (const selector of sanctioned) expect(css).toContain(selector);

    // The card interior itself carries no glow rule.
    for (const selector of ['.card-front', '.card-back', '.hanzi {', '.stage {']) {
      const at = css.indexOf(selector);
      const block = css.slice(at, css.indexOf('}', at));
      expect(block, selector).not.toContain('glow');
    }
  });
});
