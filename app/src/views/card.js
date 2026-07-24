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
import { audioControl, button, div, el, icon, p, span, tianzige } from '../ui/components.js';
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

/**
 * Audio for a word or a sentence: normal and slow (§3.4.2, §3.4.4).
 *
 * Suppressed for non-primary split members (§9) — the default voice speaks the primary
 * reading, and wrong audio is worse than none.
 */
function audioFor(word, text, options = {}) {
  if (word.splitPrimary === false) return null;
  return audioControl(() => tts.speak(text), () => tts.speakSlow(text), {
    label: s.play,
    slowLabel: s.playSlow,
    ...options,
  });
}

/** The word's shortest example, for the back of any card (§3.4.5). */
function shortestSentence(word) {
  const sentences = word.sentences ?? [];
  if (sentences.length === 0) return null;
  return [...sentences].sort((a, b) => [...a.zh].length - [...b.zh].length)[0];
}

/** A hanzi or sentence that plays its own audio when tapped (§3.4.3). */
function speakable(node, word, text) {
  if (word.splitPrimary === false) return node;
  node.dataset.noFlip = '';
  node.classList.add('speakable');
  node.setAttribute('role', 'button');
  node.setAttribute('tabindex', '0');
  node.setAttribute('aria-label', s.tapToSpeak);
  node.addEventListener('click', () => tts.speak(text));
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      tts.speak(text);
    }
  });
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
        return listenFront(word, onReady, onSuggest, onFlip);
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
export function renderBack({ mode, word, typed }) {
  const sentence = firstSentence(word);
  const parts = [];

  // Listening and sentence cards answer with their sentence first — that was the prompt.
  if ((mode === 'LIS' || mode === 'SENT') && sentence) {
    parts.push(sentenceBlock(sentence, word, { highlight: mode === 'SENT', audio: true }));
  }

  // The SENT and LIS backs already lead with their sentence; every other back gets the
  // shortest one, between the definitions and the meta row (§3.4.5).
  const example = mode === 'SENT' || mode === 'LIS' ? null : shortestSentence(word);

  parts.push(
    speakable(div({ class: 'hanzi hanzi-back', text: word.simp }), word, word.simp),
    pinyinLine(word, 'pinyin pinyin-answer'),
    typedMismatch(word, typed),
    el('hr', { class: 'rule' }),
    defsList(word),
    example ? sentenceBlock(example, word, { audio: true }) : null,
    metaRow(word),
  );

  return div({ class: 'card-back' }, [eyebrow(mode), ...parts.filter(Boolean)]);
}

/** What the learner typed, when it was not the reading (§3.3.2). */
function typedMismatch(word, typed) {
  if (!typed) return null;
  const { correct } = gradeProduction(typed, word.pinyinNum);
  if (correct) return null;
  return p(`${s.youTyped}: ${typed}`, 'typed-answer');
}

/** Traditional form, alternate readings and audio — the details, quietly. */
function metaRow(word) {
  const bits = [];
  if (word.trad && word.trad !== word.simp) bits.push(span({ class: 'trad', text: word.trad }));
  for (const alt of word.altReadings ?? []) {
    bits.push(span({ class: 'alt', text: `${s.alsoRead(alt.pinyin)} — ${alt.gloss}` }));
  }
  const audio = audioFor(word, word.simp);
  if (audio) bits.push(audio);
  return bits.length ? div({ class: 'meta-row' }, bits) : null;
}

/** A sentence with its pinyin, translation, and its own audio (§3.4.2). */
function sentenceBlock(sentence, word, { highlight = false, audio = false } = {}) {
  const zh = div({ class: 'sentence-zh' });
  zh.append(highlight ? highlightWord(sentence.zh, word.simp) : document.createTextNode(sentence.zh));
  speakable(zh, word, sentence.zh);

  const pinyin = div({ class: 'sentence-pinyin' });
  pinyin.append(colorMarkedPinyin(sentence.pinyin));

  return div({ class: 'sentence' }, [
    zh,
    pinyin,
    p(sentence.en, 'sentence-en'),
    audio ? audioFor(word, sentence.zh, { compact: true }) : null,
  ].filter(Boolean));
}

/**
 * REC: the hanzi inside a practice grid.
 *
 * Tapping the character speaks it rather than revealing the answer (§3.4.3). Hearing a
 * word you are trying to recall is a hint, not a give-away — and tap-to-flip was firing
 * by accident.
 */
function recognizeFront(word) {
  return div({ class: 'front-body' }, [
    tianzige([speakable(div({ class: 'hanzi', text: word.simp }), word, word.simp)]),
    siblingHints(word),
  ].filter(Boolean));
}

/**
 * LIS: the grid with a speaker where the character would be — the grid says a character
 * belongs here, and deliberately withholds it. Falls back to text with no voice (§9).
 */
function listenFront(word, onReady, onSuggest, onFlip) {
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

  // Answer before you see it (§3.3.2): the same input and judge PROD uses.
  const answer = typedAnswer(word, onSuggest, onFlip, { autoFocus: false });
  const body = div({ class: 'front-body' }, [square, p(s.listenPrompt, 'prompt'), ...answer.nodes]);

  tts.ready().then((voice) => {
    if (voice) {
      play();
      body.append(
        audioControl(() => play(), () => tts.speakSlow(text), {
          label: s.replay,
          slowLabel: s.playSlow,
        }),
      );
    } else {
      // No voice: show the text, or the card is unanswerable.
      body.append(div({ class: 'sentence-zh', text }));
    }
  });

  onReady(() => tts.stop());
  return body;
}

/**
 * The typed-pinyin control, shared by PROD and LIS (§3.3.2).
 *
 * Committing to a guess before revealing is the point of active recall. Typing is never
 * required: an empty answer checks out as a plain reveal, self-graded as before.
 *
 * @returns {{ nodes: Node[], focus: () => void }}
 */
function typedAnswer(word, onSuggest, onFlip, { autoFocus = true } = {}) {
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
    const typed = input.value.trim();
    if (typed) {
      const { correct, suggested } = gradeProduction(typed, word.pinyinNum);
      onSuggest(suggested, typed);
      verdict.textContent = correct ? s.correct : s.incorrect;
      verdict.className = `verdict ${correct ? 'ok' : 'bad'}`;
    }
    // Empty: reveal and let the learner grade themselves. Nothing forces typing.
    onFlip();
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      check();
    }
  });

  if (autoFocus) queueMicrotask(() => input.focus({ preventScroll: true }));

  return {
    nodes: [input, button(s.check, check, { variant: 'btn-primary' }), verdict],
    focus: () => input.focus({ preventScroll: true }),
  };
}

/** PROD: the English is the prompt, so it is the hero. */
function produceFront(word, onSuggest, onFlip) {
  const answer = typedAnswer(word, onSuggest, onFlip);
  return div({ class: 'front-body' }, [defsList(word, 'defs prompt-defs'), ...answer.nodes]);
}

/** SENT: the sentence, with the target word underlined in grid ink rather than accent. */
function sentenceFront(word) {
  const sentence = firstSentence(word);
  if (!sentence) return recognizeFront(word);
  const zh = div({ class: 'sentence-zh prompt-sentence' }, [highlightWord(sentence.zh, word.simp)]);
  return div({ class: 'front-body' }, [
    speakable(zh, word, sentence.zh),
    audioFor(word, sentence.zh, { compact: true }),
  ].filter(Boolean));
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
