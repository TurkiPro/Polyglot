/**
 * The teach screen (Phase 7 §3).
 *
 * A word's very first appearance is no longer a bare card asking a question nobody has
 * been given the means to answer. Before its REC card is first shown: the word, its
 * sound, its meaning, the sentence it was chosen to debut in, and what its characters are
 * made of. Under twenty seconds of content, no quiz — the quiz is the card, seconds later.
 */
import { audioControl, button, div, el, p, span, tianzige } from '../ui/components.js';
import { strings } from '../ui/strings.js';
import { colorMarkedPinyin, colorPinyin, highlightWord } from '../zh/tones.js';
import * as tts from '../zh/tts.js';

const s = strings.teach;

/** The sentence this word was ordered to debut in, if the pack picked one. */
export function introSentenceFor(word) {
  if (!word.sentences?.length) return null;
  if (word.introSentence) {
    const chosen = word.sentences.find((sentence) => sentence.src === word.introSentence);
    if (chosen) return chosen;
  }
  // Pre-v2 packs, or a word introduced bare: the shortest example still helps.
  return [...word.sentences].sort((a, b) => [...a.zh].length - [...b.zh].length)[0];
}

/**
 * @param {object} word
 * @param {() => void} onDone
 * @returns {HTMLElement}
 */
export function renderTeach(word, onDone) {
  const sentence = introSentenceFor(word);
  const speakable = word.splitPrimary !== false;

  // Autoplay, rotating voices: first exposure is where multi-talker input pays most.
  if (speakable) tts.speak(word.simp, { rotate: true });

  const pinyin = div({ class: 'pinyin teach-pinyin' });
  pinyin.append(colorPinyin(word.pinyinNum));

  return div({ class: 'teach' }, [
    div({ class: 'eyebrow' }, [span({ text: s.eyebrow })]),

    tianzige([div({ class: 'hanzi', text: word.simp })]),
    pinyin,
    el('ul', { class: 'defs teach-defs' }, (word.defs ?? []).map((def) => el('li', { text: def }))),
    speakable
      ? audioControl(
          () => tts.speak(word.simp, { rotate: true }),
          () => tts.speakSlow(word.simp),
          { label: strings.review.play, slowLabel: strings.review.playSlow },
        )
      : null,

    sentence ? sentenceBlock(sentence, word, speakable) : null,
    componentBlock(word),

    button(s.gotIt, onDone, { variant: 'btn-primary btn-cta teach-done' }),
  ].filter(Boolean));
}

/** The sentence this word debuts in — the whole point of the n+1 ordering. */
function sentenceBlock(sentence, word, speakable) {
  const pinyin = div({ class: 'sentence-pinyin' });
  pinyin.append(colorMarkedPinyin(sentence.pinyin));

  return div({ class: 'teach-sentence' }, [
    p(s.inContext, 'subtle-title'),
    div({ class: 'sentence-zh' }, [highlightWord(sentence.zh, word.simp)]),
    pinyin,
    p(sentence.en, 'sentence-en'),
    speakable
      ? audioControl(
          () => tts.speak(sentence.zh, { rotate: true }),
          () => tts.speakSlow(sentence.zh),
          { label: strings.review.play, slowLabel: strings.review.playSlow, compact: true },
        )
      : null,
  ].filter(Boolean));
}

/**
 * What the characters are made of.
 *
 * A character with visible parts is a structure; without them it is a squiggle to
 * memorise. Only shown when the pack actually has a breakdown worth reading.
 */
function componentBlock(word) {
  const chars = (word.components ?? []).filter((entry) => entry.parts?.length);
  if (chars.length === 0) return null;

  const rows = chars.map((entry) =>
    div({ class: 'component-row' }, [
      span({ class: 'component-char', text: entry.char }),
      span({ class: 'component-equals', text: '=' }),
      div({ class: 'component-parts' }, entry.parts.map((part) =>
        span({ class: 'component-part' }, [
          span({ class: 'component-part-char', text: part.char }),
          part.meaning ? span({ class: 'component-part-meaning', text: part.meaning }) : null,
        ].filter(Boolean)),
      )),
    ]),
  );

  return div({ class: 'teach-components' }, [p(s.madeOf, 'subtle-title'), ...rows]);
}
