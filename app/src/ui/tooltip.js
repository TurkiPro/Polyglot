/**
 * Hover glosses (feedback #1, #4): point at a character (or a marked word) and see its
 * pinyin and meaning.
 *
 * One delegated listener at the document root serves the whole app — anything tagged
 * `data-gloss="<hanzi>"` is hoverable (or tappable on touch), so views only have to mark the
 * characters, not wire behaviour. The lookup is the in-memory deck, so it needs no network.
 */
import { store } from '../store.js';
import { humanDefs } from '../zh/defs.js';

let index = null;

/** simp → deck word, built once. Both single characters and whole words are hoverable. */
function wordIndex() {
  if (index && index.size) return index;
  index = new Map();
  for (const word of store.deck?.words ?? []) {
    if (!index.has(word.simp)) index.set(word.simp, word);
  }
  return index;
}

/** The pinyin + first meaning for a spelling, or null when the deck does not teach it. */
export function glossOf(simp) {
  const word = wordIndex().get(simp);
  if (!word) return null;
  return { pinyin: word.pinyin, meaning: humanDefs(word.defs)[0] ?? '' };
}

let pop = null;

function popup() {
  if (!pop) {
    pop = document.createElement('div');
    pop.className = 'gloss-pop';
    pop.hidden = true;
  }
  // Re-attach if anything detached it (defensive; the popup lives on <body>, not inside a view).
  if (!pop.isConnected) document.body.append(pop);
  return pop;
}

function show(target) {
  const gloss = glossOf(target.dataset.gloss);
  if (!gloss) return;
  const node = popup();
  const pinyin = document.createElement('span');
  pinyin.className = 'gloss-pop-pinyin';
  pinyin.textContent = gloss.pinyin;
  const meaning = document.createElement('span');
  meaning.className = 'gloss-pop-meaning';
  meaning.textContent = gloss.meaning;
  node.replaceChildren(pinyin, meaning);
  node.hidden = false;

  const rect = target.getBoundingClientRect();
  node.style.left = `${rect.left + rect.width / 2}px`;
  node.style.top = `${rect.top}px`;
}

let anchor = null;
let safety = null;

function hide() {
  anchor = null;
  if (safety) clearTimeout(safety);
  if (pop) pop.hidden = true;
}

function reveal(target) {
  if (target === anchor) return; // already showing this one
  anchor = target;
  show(target);
  // Last-resort net for the one case the pointer events below cannot see: the character is
  // ripped out by a re-render while the cursor sits perfectly still, so no mouse event follows.
  if (safety) clearTimeout(safety);
  safety = setTimeout(hide, 1500);
}

/** Wire the delegated hover/tap once, at boot. */
export function initGloss(root = document) {
  const targetOf = (event) => event.target.closest?.('[data-gloss]');

  // Moving onto a gloss shows it; onto anything else hides it.
  root.addEventListener('mouseover', (event) => {
    const target = targetOf(event);
    if (target) reveal(target);
    else if (anchor) hide();
  });

  // The pointer can leave a character WITHOUT entering another element — into a gap, or off the
  // window edge — and then `mouseover` never fires and the popup used to hang. Two catches:
  // any move whose target is no longer the anchor clears it, and so does the anchor being
  // detached by a re-render. Cheap: it early-returns whenever nothing is shown.
  root.addEventListener('mousemove', (event) => {
    if (anchor && (!anchor.isConnected || !anchor.contains(event.target))) hide();
  });
  root.addEventListener('mouseout', (event) => {
    if (anchor && !event.relatedTarget) hide(); // left the document/window entirely
  });

  // Touch has no hover: tap a character to reveal, tap elsewhere to dismiss.
  const touch = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
  if (touch) {
    root.addEventListener('click', (event) => {
      const target = targetOf(event);
      if (target) reveal(target);
      else hide();
    });
  }

  root.addEventListener('scroll', hide, true);
  window.addEventListener('hashchange', hide);
  window.addEventListener('blur', hide); // tab/window loses focus → never leave one hanging
}

/** Wrap each CJK character of `text` in a hoverable gloss span; other text passes through. */
export function glossify(text) {
  const fragment = document.createDocumentFragment();
  for (const ch of String(text)) {
    if (/[㐀-鿿]/u.test(ch)) {
      const span = document.createElement('span');
      span.className = 'gloss';
      span.dataset.gloss = ch;
      span.textContent = ch;
      fragment.append(span);
    } else {
      fragment.append(document.createTextNode(ch));
    }
  }
  return fragment;
}
