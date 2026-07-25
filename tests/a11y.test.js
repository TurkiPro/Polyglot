// @vitest-environment jsdom
/**
 * Keyboard operability of the custom controls (audit F7).
 *
 * The rows in My Words and Browse navigate on click but are plain elements — mouse-only
 * until `activatable` gives them a role, a tab stop, and Enter/Space activation. This pins
 * that contract so the `:focus-visible` styling already in the stylesheet has something to
 * land on, and a keyboard user can actually open a word.
 */
import { describe, expect, it, vi } from 'vitest';
import { activatable, div } from '../app/src/ui/components.js';

const press = (node, key) =>
  node.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

describe('activatable (F7)', () => {
  it('gives the element a role, a tab stop, and an accessible name', () => {
    const node = activatable(div({ text: '好' }), vi.fn(), { role: 'link', label: 'Open 好' });
    expect(node.getAttribute('role')).toBe('link');
    expect(node.getAttribute('tabindex')).toBe('0');
    expect(node.getAttribute('aria-label')).toBe('Open 好');
  });

  it('activates on click, Enter, and Space', () => {
    const onActivate = vi.fn();
    const node = activatable(div({}), onActivate);
    node.click();
    press(node, 'Enter');
    press(node, ' ');
    expect(onActivate).toHaveBeenCalledTimes(3);
  });

  it('swallows the Space keypress so the page does not scroll', () => {
    const node = activatable(div({}), vi.fn());
    const event = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    node.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores other keys', () => {
    const onActivate = vi.fn();
    const node = activatable(div({}), onActivate);
    press(node, 'a');
    press(node, 'Tab');
    expect(onActivate).not.toHaveBeenCalled();
  });
});
