/**
 * Card fronts and backs, one per mode, following the §9 table exactly.
 *
 * Split out of review.js to stay under the file cap (§4.6): review.js owns the session
 * loop, this owns what a card looks like.
 */
import { RATING, gradeProduction, gradeWriting } from '../engine/srs.js';
import { button, div, el, h, p, span } from '../ui/components.js';
import { strings } from '../ui/strings.js';
import { colorMarkedPinyin, colorPinyin, highlightWord } from '../zh/tones.js';
import { mountQuiz } from '../zh/writer.js';
import * as tts from '../zh/tts.js';
import { store } from '../store.js';

const s = strings.review;

/** The sentence a listening or sentence card uses. */
const firstSentence = (word) => word.sentences?.[0] ?? null;

/** Audio button — suppressed for non-primary split members (§9). */
function audioButton(word, text, label = s.play) {
  if (word.splitPrimary === false) return null;
  return button(label, () => tts.speak(text), { variant: 'btn-quiet btn-audio' });
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
const defsList = (word) =>
  el('ul', { class: 'defs' }, (word.defs ?? []).map((d) => el('li', { text: d })));

/** Coloured word pinyin. */
function pinyinLine(word, className = 'pinyin') {
  const node = div({ class: className });
  node.append(colorPinyin(word.pinyinNum));
  return node;
}

/**
 * The full answer shown on most backs.
 */
function fullCard(word) {
  const parts = [
    div({ class: 'hanzi hanzi-back', text: word.simp }),
    pinyinLine(word),
    word.trad ? p(word.trad, 'trad') : null,
    defsList(word),
    audioButton(word, word.simp),
  ];

  if (word.altReadings?.length) {
    parts.push(
      div({ class: 'alt-readings' }, [
        h(3, strings.word.otherReadings, 'subtle-title'),
        el(
          'ul',
          { class: 'alt-list' },
          word.altReadings.map((alt) =>
            el('li', {}, [span({ class: 'alt-pinyin', text: alt.pinyin }), ` — ${alt.gloss}`]),
          ),
        ),
      ]),
    );
  }

  return div({ class: 'card-back' }, parts.filter(Boolean));
}

/** A sentence with its pinyin and translation. */
function sentenceBlock(sentence, word, { highlight = false } = {}) {
  const zh = div({ class: 'sentence-zh' });
  zh.append(highlight ? highlightWord(sentence.zh, word.simp) : document.createTextNode(sentence.zh));

  const pinyin = div({ class: 'sentence-pinyin' });
  pinyin.append(colorMarkedPinyin(sentence.pinyin));

  return div({ class: 'sentence' }, [zh, pinyin, p(sentence.en, 'sentence-en')]);
}

/**
 * Render a card front.
 * @param {{ mode: string, word: object, onReady: (teardown: () => void) => void,
 *           onSuggest: (rating: number) => void, onFlip: () => void }} ctx
 */
export function renderFront({ mode, word, onReady, onSuggest, onFlip }) {
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
}

/** Render a card back. */
export function renderBack({ mode, word }) {
  const sentence = firstSentence(word);

  if (mode === 'LIS' && sentence) {
    return div({ class: 'card-back' }, [
      sentenceBlock(sentence, word),
      defsList(word),
      audioButton(word, sentence.zh, s.replay),
    ].filter(Boolean));
  }

  if (mode === 'SENT' && sentence) {
    const pinyin = div({ class: 'sentence-pinyin' });
    pinyin.append(colorMarkedPinyin(sentence.pinyin));
    return div({ class: 'card-back' }, [
      div({ class: 'sentence-zh' }, [highlightWord(sentence.zh, word.simp)]),
      pinyin,
      p(sentence.en, 'sentence-en'),
      pinyinLine(word),
      defsList(word),
    ]);
  }

  return fullCard(word);
}

/** REC: large hanzi, plus sibling hints for split members. */
function recognizeFront(word) {
  return div({ class: 'card-front' }, [
    div({ class: 'hanzi', text: word.simp }),
    siblingHints(word),
  ].filter(Boolean));
}

/** LIS: audio only. Falls back to showing the sentence when no voice exists (§9). */
function listenFront(word, onReady) {
  const sentence = firstSentence(word);
  const text = sentence ? sentence.zh : word.simp;
  const node = div({ class: 'card-front listen' }, [p(s.listenPrompt, 'muted')]);

  tts.ready().then((voice) => {
    if (voice) {
      tts.speak(text);
      node.append(button(s.replay, () => tts.speak(text), { variant: 'btn-quiet btn-audio' }));
    } else {
      // No voice: show the text so the card is still answerable.
      node.append(div({ class: 'sentence-zh', text }));
    }
  });

  onReady(() => tts.stop());
  return node;
}

/** PROD: English definitions, and an input judged per §8. */
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

  // Focus without stealing the first keystroke on mobile.
  queueMicrotask(() => input.focus({ preventScroll: true }));

  return div({ class: 'card-front produce' }, [
    defsList(word),
    input,
    button(s.check, check, { variant: 'btn-primary' }),
    verdict,
  ]);
}

/** SENT: the sentence in hanzi with the target word marked. */
function sentenceFront(word) {
  const sentence = firstSentence(word);
  if (!sentence) return recognizeFront(word);
  return div({ class: 'card-front' }, [
    div({ class: 'sentence-zh large' }, [highlightWord(sentence.zh, word.simp)]),
  ]);
}

/**
 * WRITE: definitions, pinyin, and a quiz canvas per character.
 * The outline is on for the first character and off for the rest (§9).
 */
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
    const target = div({ class: 'write-cell' });
    canvases.append(target);
    const quiz = mountQuiz(target, char, {
      showOutline: index === 0,
      onMistake: (count) => {
        mistakes[index] = count;
      },
      onComplete: (total) => {
        mistakes[index] = total;
        done[index] = true;
        settle();
      },
    });
    quizzes.push(quiz);
  });

  const reveal = button(
    s.reveal,
    () => {
      for (const quiz of quizzes) quiz.reveal();
      onSuggest(RATING.AGAIN);
    },
    { variant: 'btn-quiet' },
  );

  onReady(() => {
    for (const quiz of quizzes) quiz.destroy();
  });

  return div({ class: 'card-front write' }, [
    defsList(word),
    pinyinLine(word),
    canvases,
    reveal,
  ]);
}
