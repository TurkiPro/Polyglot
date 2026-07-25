/**
 * @vitest-environment jsdom
 *
 * Hover glosses (feedback #1): the character wrapping. The deck lookup and popup are wired
 * at boot and checked by eye; here we prove the markup a view produces is hoverable.
 */
import { describe, expect, it } from 'vitest';
import { glossify } from '../app/src/ui/tooltip.js';

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
