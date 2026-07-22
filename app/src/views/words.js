/**
 * My Words: the words the learner added themselves (§9).
 *
 * Adding a word used to be invisible — it went into the deck and waited its turn, so the
 * feature read as broken. This lists them newest first with live scheduling state.
 */
import { cardId } from '../engine/deck.js';
import { removeCustomWord, store } from '../store.js';
import { button, div, el, emptyState, h, p, relativeDay, replace, span } from '../ui/components.js';
import { strings } from '../ui/strings.js';
import { colorPinyin } from '../zh/tones.js';

const s = strings.words;

/** ts-fsrs State: 0 New, 1 Learning, 2 Review, 3 Relearning. */
const LEARNING_STATES = new Set([1, 3]);

/**
 * What the learner should understand about this word right now.
 * @returns {{ label: string, kind: 'next'|'learning'|'due' }}
 */
export function statusOf(word, states, now = Date.now()) {
  const state = states.get(cardId(word.id, 'REC'));
  if (!state || !state.reps) return { label: s.upNext, kind: 'next' };
  if (LEARNING_STATES.has(state.state)) return { label: s.learning, kind: 'learning' };
  return { label: s.due(relativeDay(state.due, now)), kind: 'due' };
}

export function renderWords(root, ctx) {
  const list = div({ class: 'word-list' });

  function paint() {
    const words = store.deck?.custom() ?? [];

    if (words.length === 0) {
      replace(
        list,
        emptyState(
          'grid',
          s.empty,
          button(s.browse, () => ctx.navigate('#browse'), { variant: 'btn-primary' }),
          { note: s.explain },
        ),
      );
      return;
    }

    replace(list, p(s.count(words.length), 'muted'), ...words.map((word) => row(word, paint, ctx)));
  }

  paint();
  replace(root, div({ class: 'words' }, [h(1, s.title, 'title'), list]));
}

function row(word, repaint, ctx) {
  const status = statusOf(word, store.states);

  const pinyin = span({ class: 'pinyin' });
  pinyin.append(colorPinyin(word.pinyinNum));

  const open = () => ctx.navigate(`#word/${encodeURIComponent(word.id)}`);
  const main = div({ class: 'row-main', on: { click: open } }, [
    div({ class: 'row-head' }, [
      span({ class: 'row-hanzi', text: word.simp }),
      pinyin,
      span({ class: `chip chip-${status.kind}`, text: status.label }),
    ]),
    p(word.defs.slice(0, 3).join('; '), 'row-defs'),
  ]);

  const actions = div({ class: 'row-actions' });
  const remove = button(s.remove, () => confirmRemove(), { variant: 'btn-quiet btn-small' });
  actions.append(remove);

  function confirmRemove() {
    replace(
      actions,
      p(s.removeConfirm(word.simp), 'muted'),
      button(s.cancel, () => replace(actions, remove), { variant: 'btn-quiet btn-small' }),
      button(s.remove, async () => {
        await removeCustomWord(word.id);
        repaint();
      }, { variant: 'btn-danger btn-small' }),
    );
  }

  return div({ class: 'list-row' }, [main, actions]);
}
