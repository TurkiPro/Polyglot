// @vitest-environment jsdom
/**
 * The reward renderer must never render nothing (audit F2).
 *
 * `neonIgnite` lights the two most load-bearing moments in the app — the nightly
 * hardest-word sign and the checkpoint clear. An earlier version flickered out to an
 * empty box under a lifecycle race, and the 语 hero was pulled for it. These tests pin
 * the guarantee that replaced the race: every failure mode lands on a visible, glowing
 * character, and only a clean run animates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let animateBehavior = 'complete'; // 'complete' | 'never'
const created = [];

vi.mock('hanzi-writer', () => ({
  default: {
    create(stage, char, opts) {
      // The real loader is now synchronous (data is preloaded); mirror that.
      let loaded = null;
      opts.charDataLoader(char, (data) => { loaded = data; });
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
      stage.appendChild(svg);
      const writer = {
        loaded,
        animateCharacter: ({ onComplete }) => { if (animateBehavior === 'complete') onComplete?.(); },
        showCharacter: vi.fn(),
        cancelQuiz: vi.fn(),
      };
      created.push(writer);
      return writer;
    },
  },
}));

const { neonIgnite } = await import('../app/src/zh/writer.js');

const strokeData = { strokes: ['M0 0'], medians: [[[0, 0]]] };
const okFetch = () => vi.fn(async () => ({ ok: true, json: async () => strokeData }));
const badFetch = () => vi.fn(async () => ({ ok: false, status: 404, statusText: 'nope' }));

const until = async (predicate, label) => {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
};

describe('neonIgnite never renders blank (F2)', () => {
  let host;

  beforeEach(() => {
    animateBehavior = 'complete';
    created.length = 0;
    document.documentElement.dataset.effects = 'on';
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    delete document.documentElement.dataset.effects;
    vi.restoreAllMocks();
  });

  it('animates the strokes on the happy path', async () => {
    globalThis.fetch = okFetch();
    let done = false;
    neonIgnite(host, '亮', { size: 120, onDone: () => { done = true; } });

    await until(() => host.dataset.ignitePath === 'animated', 'the animated path');
    expect(host.querySelector('svg')).not.toBeNull();
    expect(host.querySelector('.neon-fallback')).toBeNull();
    expect(host.classList.contains('lit')).toBe(true);
    await until(() => done, 'onDone');
  });

  it('falls back to the steady glyph when the stroke data will not load', async () => {
    globalThis.fetch = badFetch();
    let done = false;
    neonIgnite(host, '暗', { size: 120, onDone: () => { done = true; } });

    await until(() => host.dataset.ignitePath === 'static', 'the static path');
    const glyph = host.querySelector('.neon-fallback');
    expect(glyph).not.toBeNull();
    expect(glyph.textContent).toBe('暗');
    expect(host.classList.contains('lit')).toBe(true);
    await until(() => done, 'onDone');
  });

  it('falls back to the steady glyph when the target detached before the data arrived', async () => {
    globalThis.fetch = okFetch();
    host.remove(); // gone from the DOM before loadCharData resolves
    let done = false;
    neonIgnite(host, '灯', { size: 120, onDone: () => { done = true; } });

    await until(() => host.dataset.ignitePath === 'static', 'the static path');
    expect(host.querySelector('.neon-fallback')?.textContent).toBe('灯');
    expect(host.querySelector('svg')).toBeNull();
    await until(() => done, 'onDone');
  });

  it('takes the steady glyph directly under reduce-effects, without fetching', async () => {
    document.documentElement.dataset.effects = 'off';
    globalThis.fetch = vi.fn(async () => { throw new Error('should not fetch'); });
    let done = false;
    neonIgnite(host, '光', { size: 120, onDone: () => { done = true; } });

    expect(host.dataset.ignitePath).toBe('static'); // synchronous, no await
    expect(host.querySelector('.neon-fallback')?.textContent).toBe('光');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(done).toBe(true);
  });

  it('forces the character visible when the animation never reports back', async () => {
    animateBehavior = 'never';
    globalThis.fetch = okFetch();
    let done = false;
    neonIgnite(host, '电', { size: 120, duration: 20, onDone: () => { done = true; } });

    await until(() => host.dataset.ignitePath === 'animated', 'the animated path');
    await until(() => created.at(-1)?.showCharacter.mock.calls.length > 0, 'the safety showCharacter');
    expect(host.classList.contains('lit')).toBe(true);
    expect(host.querySelector('svg')).not.toBeNull(); // still the animated node, not a blank
    await until(() => done, 'onDone');
  });
});
