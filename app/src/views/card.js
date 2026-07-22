/**
 * Card fronts and backs (§3.2.5).
 *
 * Every card opens with a mode eyebrow, so it always answers "what is this asking me?".
 * Fronts differ per mode; backs share one structure: eyebrow, hanzi, pinyin, divider,
 * definitions, meta row.
 *
 * Split from review.js, which owns the session loop, to stay under the file cap (§4.6).
 */
import { RATING, gradeWriting, gradeProduction } from '../engine/srs.js';
import { button, div, el, icon, p, span, tianzige } from '../ui/components.js';
import { iconForMode } from '../ui/icons.js';
import { strings } from '../ui/strings.js';
import { colorMarkedPinyin, colorPinyin, highlightWord } from '../zh/tones.js';
import { mountQuiz } from '../zh/writer.js';
import * as tts from '../zh/tts.js';
import { store } from '../store.js';

const s = strings.review;

/** The sentence a listening or sentence card uses. */
const firstSentence = (word) => word.sentences?.[0] ?? null;

/** The label + icon that names the card's mode. */
function eyebrow(mode) {
  const glyph = iconForMode(mode, 16);
  return div({ class: 'eyebrow' }, [glyph, span({ text: s.modes[mode] ?? s.modes.REC })]);
}

/** Audio control — suppressed for non-primary split members (§9). */
function audioButton(word, text, label = s.play) {
  if (word.splitPrimary === false) return null;
  const node = button('', () => tts.speak(text), { variant: 'btn-quiet btn-audio', 'aria-label': label });
  node.append(icon('volume-2', 18), span({ text: label }));
  return node;
}

/** "not <sibling pinyin>" hints on a split member's REC front (§9). */
function siblingHints(word) {
  if (!word.splitGroup?.length) return null;
  const hints = word.splitGroup
    .map((id) => store.deck?.word(id))
    .filter(Boolean)
    .map((sibling) => p(s.notSibling(sibling.pinyin), 'hint'));
  return hints.length ? div({ class: 'hints' }, hints) : null;
}

/** Definitions as a list. */
const defsList = (word, className = 'defs') =>
  el('ul', { class: className }, (word.defs ?? []).map((d) => el('li', { text: d })));

/** Coloured word pinyin. */
function pinyinLine(word, className = 'pinyin') {
  const node = div({ class: className });
  node.append(colorPinyin(word.pinyinNum));
  return node;
}

/**
 * Render a card front.
 * @param {{ mode: string, word: object, onReady: (teardown: () => void) => void,
 *           onSuggest: (rating: number) => void, onFlip: () => void }} ctx
 */
export function renderFront({ mode, word, onReady, onSuggest, onFlip }) {
  const body = (() => {
    switch (mode) {
      case 'LIS':
        return listenFront(word, onReady);
      case 'PROD':
        return produceFront(word, onSuggest, onFlip);
      case 'SENT':
        return sentenceFront(word);
      case 'WRITE':
        return writeFront(word, onReady, onSuggest);
      default:
        return recognizeFront(word);
    }
  })();

  return div({ class: `card-front card-${mode.toLowerCase()}` }, [eyebrow(mode), body]);
}

/**
 * Render a card back. One structure for every mode, so the answer always reads the same
 * way: what it is, how it sounds, what it means, then the details.
 */
export function renderBack({ mode, word }) {
  const sentence = firstSentence(word);
  const parts = [];

  // Listening and sentence cards answer with their sentence first — that was the prompt.
  if ((mode === 'LIS' || mode === 'SENT') && sentence) {
    parts.push(sentenceBlock(sentence, word, { highlight: mode === 'SENT' }));
  }

  parts.push(
    div({ class: 'hanzi hanzi-back', text: word.simp }),
    pinyinLine(word, 'pinyin pinyin-answer'),
    el('hr', { class: 'rule' }),
    defsList(word),
    metaRow(word),
  );

  return div({ class: 'card-back stamp-in' }, [eyebrow(mode), ...parts.filter(Boolean)]);
}

/** Traditional form, alternate readings and audio — the details, quietly. */
function metaRow(word) {
  const bits = [];
  if (word.trad && word.trad !== word.simp) bits.push(span({ class: 'trad', text: word.trad }));
  for (const alt of word.altReadings ?? []) {
    bits.push(span({ class: 'alt', text: `${s.alsoRead(alt.pinyin)} — ${alt.gloss}` }));
  }
  const audio = audioButton(word, word.simp);
  if (audio) bits.push(audio);
  return bits.length ? div({ class: 'meta-row' }, bits) : null;
}

/** A sentence with its pinyin and translation. */
function sentenceBlock(sentence, word, { highlight = false } = {}) {
  const zh = div({ class: 'sentence-zh' });
  zh.append(highlight ? highlightWord(sentence.zh, word.simp) : document.createTextNode(sentence.zh));

  const pinyin = div({ class: 'sentence-pinyin' });
  pinyin.append(colorMarkedPinyin(sentence.pinyin));

  return div({ class: 'sentence' }, [zh, pinyin, p(sentence.en, 'sentence-en')]);
}

/** REC: the hanzi inside a practice grid. */
function recognizeFront(word) {
  return div({ class: 'front-body' }, [
    tianzige([div({ class: 'hanzi', text: word.simp })]),
    siblingHints(word),
  ].filter(Boolean));
}

/**
 * LIS: the grid with a speaker where the character would be — the grid says a character
 * belongs here, and deliberately withholds it. Falls back to text with no voice (§9).
 */
function listenFront(word, onReady) {
  const sentence = firstSentence(word);
  const text = sentence ? sentence.zh : word.simp;

  const speaker = icon('volume-2', 64);
  const square = tianzige([speaker], { className: 'tianzige-audio' });
  square.setAttribute('role', 'button');
  square.setAttribute('tabindex', '0');
  square.setAttribute('aria-label', s.tapToPlay);

  const pulse = () => {
    square.classList.remove('pulse');
    // Restart the animation rather than letting a second play be silent visually.
    void square.offsetWidth;
    square.classList.add('pulse');
  };
  const play = () => {
    tts.speak(text);
    pulse();
  };

  square.addEventListener('click', play);
  square.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      play();
    }
  });

  const body = div({ class: 'front-body' }, [square, p(s.listenPrompt, 'prompt')]);

  tts.ready().then((voice) => {
    if (voice) {
      play();
      body.append(replayButton(() => play()));
    } else {
      // No voice: show the text, or the card is unanswerable.
      body.append(div({ class: 'sentence-zh', text }));
    }
  });

  onReady(() => tts.stop());
  return body;
}

/** A quiet secondary control, per §3.2.5. */
function replayButton(onClick) {
  const node = button('', onClick, { variant: 'btn-quiet btn-replay', 'aria-label': s.replay });
  node.append(icon('rotate-ccw', 18), span({ text: s.replay }));
  return node;
}

/** PROD: the English is the prompt, so it is the hero. */
function produceFront(word, onSuggest, onFlip) {
  const input = el('input', {
    class: 'answer',
    attrs: {
      type: 'text',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      placeholder: s.typeAnswer,
      'aria-label': s.typeAnswer,
    },
  });

  const verdict = p('', 'verdict');

  const check = () => {
    const { correct, suggested } = gradeProduction(input.value, word.pinyinNum);
    onSuggest(suggested);
    verdict.textContent = correct ? s.correct : s.incorrect;
    verdict.className = `verdict ${correct ? 'ok' : 'bad'}`;
    onFlip();
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      check();
    }
  });

  queueMicrotask(() => input.focus({ preventScroll: true }));

  return div({ class: 'front-body' }, [
    defsList(word, 'defs prompt-defs'),
    input,
    button(s.check, check, { variant: 'btn-primary' }),
    verdict,
  ]);
}

/** SENT: the sentence, with the target word underlined in grid ink rather than accent. */
function sentenceFront(word) {
  const sentence = firstSentence(word);
  if (!sentence) return recognizeFront(word);
  return div({ class: 'front-body' }, [
    div({ class: 'sentence-zh prompt-sentence' }, [highlightWord(sentence.zh, word.simp)]),
  ]);
}

/** WRITE: definitions and pinyin above, the canvas inside a full practice grid. */
function writeFront(word, onReady, onSuggest) {
  const chars = [...word.simp];
  const canvases = div({ class: 'write-row' });
  const quizzes = [];
  const mistakes = new Array(chars.length).fill(0);
  const done = new Array(chars.length).fill(false);

  const settle = () => {
    if (!done.every(Boolean)) return;
    onSuggest(gradeWriting(mistakes));
  };

  chars.forEach((char, index) => {
    const target = div({ class: 'write-target' });
    canvases.append(tianzige([target], { className: 'tianzige-write' }));
    quizzes.push(
      mountQuiz(target, char, {
        showOutline: index === 0,
        onMistake: (count) => {
          mistakes[index] = count;
        },
        onComplete: (total) => {
          mistakes[index] = total;
          done[index] = true;
          settle();
        },
      }),
    );
  });

  const reveal = button(s.reveal, () => {
    for (const quiz of quizzes) quiz.reveal();
    onSuggest(RATING.AGAIN);
  }, { variant: 'btn-quiet' });

  onReady(() => {
    for (const quiz of quizzes) quiz.destroy();
  });

  return div({ class: 'front-body' }, [
    defsList(word),
    pinyinLine(word),
    canvases,
    reveal,
  ]);
}
