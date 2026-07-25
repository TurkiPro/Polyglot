/**
 * A single word: everything the deck knows about it, plus this device's progress.
 */
import { cardIdsForWord, parseCardId } from '../engine/deck.js';
import { addToMyWords, inMyWords, store } from '../store.js';
import { audioControl, button, checkStamp, div, el, empty, h, p, relativeDay, replace, span } from '../ui/components.js';
import { strings } from '../ui/strings.js';
import { colorMarkedPinyin, colorPinyin } from '../zh/tones.js';
import { classifiers, humanDefs } from '../zh/defs.js';
import * as tts from '../zh/audio.js';
import { mountQuiz } from '../zh/writer.js';

const s = strings.word;

export function renderWord(root, ctx, wordId) {
  const word = store.deck?.word(wordId);
  if (!word) return replace(root, div({ class: 'word' }, [empty(s.noSuchWord)]));

  const pinyin = div({ class: 'pinyin large' });
  pinyin.append(colorPinyin(word.pinyinNum));

  const header = div({ class: 'word-header' }, [
    div({ class: 'hanzi', text: word.simp }),
    pinyin,
    word.trad ? p(word.trad, 'trad') : null,
    word.splitPrimary === false
      ? null
      : audioControl(() => tts.speak(word.simp, { key: word.id }), () => tts.speakSlow(word.simp, { key: word.id }), {
          label: strings.review.play,
          slowLabel: strings.review.playSlow,
        }),
    p(word.band > 0 ? s.band(word.band) : s.custom, 'muted'),
    actionRow(word),
  ].filter(Boolean));

  const sections = [
    header,
    section(
      s.definitions,
      el('ul', { class: 'defs' }, humanDefs(word.defs).map((d) => el('li', { text: d }))),
    ),
  ];

  // Classifiers are rendered as language, not as the raw CL: field.
  const measures = classifiers(word.defs);
  if (measures.length) {
    sections.push(
      section(
        s.measureWords,
        p(measures.map((m) => m.form).join(' · '), 'measure-words'),
      ),
    );
  }

  if (word.sentences?.length) {
    sections.push(section(s.examples, div({ class: 'sentences' }, word.sentences.map(sentenceBlock))));
  }

  if (word.altReadings?.length) {
    sections.push(
      section(
        s.otherReadings,
        el('ul', { class: 'alt-list' }, word.altReadings.map((alt) =>
          el('li', {}, [span({ class: 'alt-pinyin', text: alt.pinyin }), ` — ${alt.gloss}`]),
        )),
      ),
    );
  }

  if (word.splitGroup?.length) {
    const siblings = word.splitGroup.map((id) => store.deck.word(id)).filter(Boolean);
    if (siblings.length) {
      sections.push(
        section(
          s.alsoTaught,
          div({ class: 'siblings' }, siblings.map((sibling) =>
            button(`${sibling.simp} ${sibling.pinyin}`, () => ctx.navigate(`#word/${encodeURIComponent(sibling.id)}`), {
              variant: 'btn-quiet',
            }),
          )),
        ),
      );
    }
  }

  sections.push(section(s.progress, progressList(word)));

  replace(root, div({ class: 'word' }, sections));
}

function section(title, body) {
  return el('section', { class: 'panel' }, [h(2, title, 'panel-title'), body]);
}

function sentenceBlock(sentence) {
  const pinyin = div({ class: 'sentence-pinyin' });
  pinyin.append(colorMarkedPinyin(sentence.pinyin));
  return div({ class: 'sentence' }, [
    div({ class: 'sentence-zh', text: sentence.zh }),
    pinyin,
    p(sentence.en, 'sentence-en'),
    audioControl(() => tts.speak(sentence.zh, { key: sentence.src }), () => tts.speakSlow(sentence.zh, { key: sentence.src }), {
      label: strings.review.play,
      slowLabel: strings.review.playSlow,
      compact: true,
    }),
  ]);
}

/**
 * Study next, and free writing practice (§3.4.1, §3.4.6).
 *
 * "Add to my words" is refused for curriculum words, which reads as the app saying no to
 * wanting to learn something. This is the yes: the same queue lane, without duplicating
 * the word.
 */
function actionRow(word) {
  const row = div({ class: 'row word-actions' });

  // Every word can go in My Words — a custom word is already there; a curriculum word is
  // pinned (the same lane "Study next" uses), so it appears in the list without duplicating
  // the pack. The added state is a clean stamp, not a stretched pill (#9).
  const mine = () => span({ class: 'chip chip-mine word-added' }, [checkStamp(s.inMyWords)]);
  if (inMyWords(word.id)) {
    row.append(mine());
  } else {
    const add = button(s.addToMyWords, async () => {
      await addToMyWords(word);
      add.replaceWith(mine());
    }, { variant: 'btn-primary' });
    row.append(add);
  }

  row.append(practiceButton(word));
  return row;
}

/**
 * WRITE cards unlock only once recognition matures (§5.4), so a new learner never sees
 * the stroke quiz and concludes it does not exist. This offers it from day one —
 * ungraded, no events, no schedule effect (§3.4.6).
 */
function practiceButton(word) {
  if (word.noWrite === true) return null;

  const open = button(s.practiceWriting, () => {
    const host = div({ class: 'practice' });
    const canvases = div({ class: 'write-row' });
    // Practice, not a test: every character shows its outline (so no box is blank) and
    // hints come after a single miss. Stroke demos are on demand, not automatic (feedback).
    const quizzes = [...word.simp].map((char) => {
      const target = div({ class: 'write-target' });
      canvases.append(div({ class: 'tianzige tianzige-write' }, [target]));
      return mountQuiz(target, char, { showOutline: true, showHintAfterMisses: 1 });
    });

    // Demonstrate the characters one after another, not all at once (feedback).
    const showStrokes = (index = 0) => {
      if (index < quizzes.length) quizzes[index].animate(() => showStrokes(index + 1));
    };
    const showBtn = button(s.showStrokes, () => showStrokes(0), { variant: 'btn-quiet btn-small' });
    const close = button(s.practiceDone, () => {
      for (const quiz of quizzes) quiz.destroy();
      host.replaceWith(open);
    }, { variant: 'btn-quiet' });

    host.append(p(s.practiceBlurb, 'muted'), canvases, div({ class: 'practice-actions' }, [showBtn, close]));
    open.replaceWith(host);
  }, { variant: 'btn-quiet' });

  return open;
}

/** Per-card scheduling state for this word. */
function progressList(word) {
  const rows = cardIdsForWord(word).map((cardId) => {
    const state = store.states.get(cardId);
    const { mode } = parseCardId(cardId);
    let detail = s.notStarted;
    if (state?.reps > 0) detail = s.due(relativeDay(state.due));
    else if (state?.suspended) detail = s.suspended;
    return el('li', {}, [span({ class: 'mode-tag', text: mode }), ` ${detail}`]);
  });
  return el('ul', { class: 'progress-list' }, rows);
}
