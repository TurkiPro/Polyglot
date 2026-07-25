/**
 * Exercise views (Phase 9 §2–3): render one item, take an answer, give immediate feedback.
 *
 * The engine (`engine/exercises.js`) owns the generators and graders; this is only their
 * face. Every type ends the same way — answer, see the correct answer, press Continue — and
 * calls `onDone(correct)` so the lesson or checkpoint can log a practice event and move on.
 */
import { grade } from '../engine/exercises.js';
import { button, div, el, p, span } from '../ui/components.js';
import { strings } from '../ui/strings.js';
import { colorPinyin, highlightWord } from '../zh/tones.js';
import * as tts from '../zh/audio.js';

const s = strings.exercise;

/** The bar that names the outcome and lets the learner move on. `answer` may be text or a node. */
function feedback(host, correct, answer, onDone) {
  const answerLine = div({ class: 'answer-line' }, [
    span({ text: s.answerLabel }),
    answer instanceof Node ? answer : span({ text: String(answer ?? '') }),
  ]);
  const bar = div({ class: `exercise-feedback ${correct ? 'ok' : 'bad'}` }, [
    p(correct ? s.correct : s.wrong, 'verdict-line'),
    correct ? null : answerLine,
    button(s.continue, () => onDone(correct), { variant: 'btn-primary btn-cta' }),
  ].filter(Boolean));
  host.append(bar);
  bar.querySelector('button')?.focus();
}

/** MCQ_MEANING and MCQ_AUDIO: one prompt, four options, immediate reveal. */
function renderMcq(item, onDone) {
  const audio = item.type === 'MCQ_AUDIO';
  const host = div({ class: 'exercise exercise-mcq' });

  const prompt = audio
    ? button(s.playPrompt, () => tts.speak(item.prompt, { key: item.wordId }), { variant: 'btn-quiet exercise-audio' })
    : div({ class: 'exercise-hanzi', text: item.prompt });
  if (audio) tts.speak(item.prompt, { key: item.wordId });

  const options = div({ class: 'exercise-options' });
  let answered = false;
  for (const option of item.options) {
    const label = audio ? option.simp : option.text;
    const node = button(label, () => {
      if (answered) return;
      answered = true;
      const { correct } = grade(item, option.id);
      for (const b of options.querySelectorAll('button')) b.disabled = true;
      node.classList.add(correct ? 'chosen-right' : 'chosen-wrong');
      if (!correct) options.querySelector(`[data-id="${cssEscape(item.answer)}"]`)?.classList.add('chosen-right');
      feedback(host, correct, audio ? textById(item, item.answer) : item.options.find((o) => o.id === item.answer)?.text, onDone);
    }, { variant: `exercise-option${audio ? ' t-hanzi' : ''}` });
    node.dataset.id = option.id;
    options.append(node);
  }

  host.append(prompt, options);
  return host;
}

const textById = (item, id) => item.options.find((o) => o.id === id)?.simp ?? '';
const cssEscape = (value) => String(value).replace(/["\\]/g, '\\$&');

/** TYPE_PINYIN: see hanzi + meaning, type the reading (graded by the PROD normalizer). */
function renderType(item, onDone) {
  const host = div({ class: 'exercise exercise-type' });
  const input = el('input', {
    class: 'exercise-input',
    attrs: { type: 'text', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': s.typePinyin },
  });
  let answered = false;
  const submit = () => {
    if (answered || !input.value.trim()) return;
    answered = true;
    input.disabled = true;
    const { correct } = grade(item, input.value);
    feedback(host, correct, colorPinyin(item.answer), onDone);
  };
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') submit(); });

  host.append(
    div({ class: 'exercise-hanzi', text: item.prompt }),
    p(item.meaning, 'exercise-meaning'),
    input,
    button(s.check, submit, { variant: 'btn-primary' }),
  );
  setTimeout(() => input.focus(), 0);
  return host;
}

/** MATCH: link each hanzi to its meaning/pinyin; graded once all five are linked. */
function renderMatch(item, onDone) {
  const host = div({ class: 'exercise exercise-match' });
  const pairing = {};
  let activeLeft = null;

  const leftCol = div({ class: 'match-col match-left' });
  const rightCol = div({ class: 'match-col match-right' });

  const leftButtons = new Map();
  const rightButtons = new Map();

  const tryFinish = () => {
    if (Object.keys(pairing).length < item.left.length) return;
    const { correct } = grade(item, pairing);
    for (const id of item.answer) {
      const ok = pairing[id] === id;
      leftButtons.get(id)?.classList.add(ok ? 'match-ok' : 'match-bad');
      rightButtons.get(pairing[id])?.classList.add(ok ? 'match-ok' : 'match-bad');
    }
    feedback(host, correct, s.matchWhole, onDone);
  };

  for (const left of item.left) {
    const node = button(left.simp, () => {
      if (pairing[left.id]) return;
      activeLeft = left.id;
      for (const b of leftButtons.values()) b.classList.remove('match-active');
      node.classList.add('match-active');
    }, { variant: 'match-item t-hanzi' });
    leftButtons.set(left.id, node);
    leftCol.append(node);
  }
  for (const right of item.right) {
    const node = button(right.text, () => {
      if (!activeLeft || Object.values(pairing).includes(right.id)) return;
      pairing[activeLeft] = right.id;
      leftButtons.get(activeLeft)?.classList.remove('match-active');
      leftButtons.get(activeLeft)?.classList.add('match-linked');
      node.classList.add('match-linked');
      activeLeft = null;
      tryFinish();
    }, { variant: 'match-item' });
    rightButtons.set(right.id, node);
    rightCol.append(node);
  }

  host.append(p(s.matchPrompt, 'exercise-meaning'), div({ class: 'match-grid' }, [leftCol, rightCol]));
  return host;
}

/** REORDER: arrange shuffled word tiles into the sentence's order. */
function renderReorder(item, onDone) {
  const host = div({ class: 'exercise exercise-reorder' });
  const chosen = [];
  const line = div({ class: 'reorder-line' });
  const bank = div({ class: 'reorder-bank' });

  const repaint = () => {
    line.replaceChildren(...chosen.map((t) => span({ class: 'reorder-tile placed', text: t.simp })));
    if (chosen.length === item.tiles.length) {
      const { correct } = grade(item, chosen.map((t) => t.i));
      feedback(host, correct, item.tiles.join(' '), onDone);
    }
  };

  for (const tile of item.tiles) {
    const node = button(tile.simp, () => {
      if (node.disabled) return;
      node.disabled = true;
      chosen.push(tile);
      repaint();
    }, { variant: 'reorder-tile t-hanzi' });
    bank.append(node);
  }

  host.append(p(s.reorderPrompt, 'exercise-meaning'), p(item.en, 'exercise-en'), line, bank);
  return host;
}

/** CLOZE: a sentence with the target blanked; pick which word fills it. */
function renderCloze(item, onDone) {
  const host = div({ class: 'exercise exercise-cloze' });
  const sentence = div({ class: 'cloze-sentence' });
  item.tiles.forEach((simp, i) => {
    sentence.append(i === item.blankAt
      ? span({ class: 'cloze-blank', text: '＿' })
      : span({ class: 'cloze-word', text: simp }));
  });

  const options = div({ class: 'exercise-options' });
  let answered = false;
  for (const option of item.options) {
    const node = button(option.simp, () => {
      if (answered) return;
      answered = true;
      const { correct } = grade(item, option.id);
      for (const b of options.querySelectorAll('button')) b.disabled = true;
      node.classList.add(correct ? 'chosen-right' : 'chosen-wrong');
      const answerSimp = item.options.find((o) => o.id === item.answer)?.simp;
      const blank = sentence.querySelector('.cloze-blank');
      if (correct && blank) { blank.textContent = answerSimp; blank.classList.add('filled'); }
      feedback(host, correct, answerSimp, onDone);
    }, { variant: 'exercise-option t-hanzi' });
    options.append(node);
  }

  host.append(p(s.clozePrompt, 'exercise-meaning'), sentence, p(item.en, 'exercise-en'), options);
  return host;
}

const RENDERERS = {
  MCQ_MEANING: renderMcq,
  MCQ_AUDIO: renderMcq,
  TYPE_PINYIN: renderType,
  MATCH: renderMatch,
  REORDER: renderReorder,
  CLOZE: renderCloze,
};

/**
 * Render an exercise item. `onDone(correct)` fires after the learner has answered and seen
 * the outcome — the caller logs the practice event and advances.
 */
export function renderExercise(item, onDone) {
  return (RENDERERS[item.type] ?? (() => div({ text: `?${item.type}` })))(item, onDone);
}
