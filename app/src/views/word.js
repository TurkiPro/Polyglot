/**
 * A single word: everything the deck knows about it, plus this device's progress.
 */
import { cardIdsForWord, parseCardId } from '../engine/deck.js';
import { store } from '../store.js';
import { button, div, el, empty, h, p, relativeDay, replace, span } from '../ui/components.js';
import { strings } from '../ui/strings.js';
import { colorMarkedPinyin, colorPinyin } from '../zh/tones.js';
import * as tts from '../zh/tts.js';

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
    word.splitPrimary === false ? null : button(strings.review.play, () => tts.speak(word.simp), {
      variant: 'btn-quiet btn-audio',
    }),
    p(word.band > 0 ? s.band(word.band) : s.custom, 'muted'),
  ].filter(Boolean));

  const sections = [
    header,
    section(s.definitions, el('ul', { class: 'defs' }, word.defs.map((d) => el('li', { text: d })))),
  ];

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
  ]);
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
