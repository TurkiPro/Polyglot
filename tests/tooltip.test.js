/**
 * @vitest-environment jsdom
 *
 * Hover glosses (feedback #1): the character wrapping. The deck lookup and popup are wired
 * at boot and checked by eye; here we prove the markup a view produces is hoverable.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../app/src/store.js';
import { glossify, initGloss } from '../app/src/ui/tooltip.js';

describe('glossify', () => {
  it('wraps each CJK character in a data-gloss span, leaving other text alone', () => {
    const host = document.createElement('div');
    host.append(glossify('你好，world'));

    const spans = [...host.querySelectorAll('.gloss')];
    expect(spans.map((s) => s.dataset.gloss)).toEqual(['你', '好']);
    expect(host.textContent).toBe('你好，world'); // nothing lost, punctuation/latin passthrough
  });

  it('handles a note that mixes hanzi and latin', () => {
    const host = document.createElement('div');
    host.append(glossify('吗 turns a statement into a question.'));
    expect(host.querySelectorAll('.gloss')).toHaveLength(1);
    expect(host.querySelector('.gloss').dataset.gloss).toBe('吗');
  });
});

/* The popup must never hang — the reason it kept getting reported. */
describe('gloss popup hides reliably', () => {
  let span;

  beforeEach(() => {
    store.deck = { words: [{ simp: '你', pinyin: 'nǐ', defs: ['you'] }] };
    document.body.innerHTML = '';
    initGloss(document);
    const host = document.createElement('div');
    host.append(glossify('你'));
    document.body.append(host);
    span = host.querySelector('.gloss');
  });

  const pop = () => document.querySelector('.gloss-pop');
  const fire = (node, type, init = {}) => node.dispatchEvent(new window.MouseEvent(type, { bubbles: true, ...init }));

  it('shows on hover and hides the moment the pointer moves off the character', () => {
    fire(span, 'mouseover');
    expect(pop().hidden).toBe(false);

    // Moving into empty space (no gloss entered) must clear it — the classic hang.
    fire(document.body, 'mousemove');
    expect(pop().hidden).toBe(true);
  });

  it('hides when the character is torn out of the DOM by a re-render', () => {
    fire(span, 'mouseover');
    expect(pop().hidden).toBe(false);

    span.remove(); // a view re-render removes the anchor
    fire(document.body, 'mousemove');
    expect(pop().hidden).toBe(true);
  });

  it('hides when the pointer leaves the window and on tab blur', () => {
    fire(span, 'mouseover');
    fire(span, 'mouseout', { relatedTarget: null }); // left the document entirely
    expect(pop().hidden).toBe(true);

    fire(span, 'mouseover');
    window.dispatchEvent(new window.Event('blur'));
    expect(pop().hidden).toBe(true);
  });
});
