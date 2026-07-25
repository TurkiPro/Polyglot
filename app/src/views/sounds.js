/**
 * Unit 0 "The Sounds" — the step renderers (Phase 10 B).
 *
 * The old `#welcome` flow, reborn as ordinary course content: the same tone samples, the same
 * "which tone did you hear?" drills, the same pinyin crash intro — but now they are the steps of
 * the course's first unit, run by the ordinary lesson runner and skippable exactly like any
 * other step. Nothing here is forced; it is simply where the course begins.
 *
 * The strings still live under `strings.welcome` (the tone gym shares them); only the old view
 * was retired.
 */
import { config } from '../../../config/app.config.js';
import { recordCheckpoint, recordToneResult, store } from '../store.js';
import { button, div, h, p, replace, span } from '../ui/components.js';
import { stage } from '../ui/arcade.js';
import { strings } from '../ui/strings.js';
import { ARCHETYPE, buildDrillSet, buildTonePool, isCorrect } from '../zh/tones-drill.js';
import { colorPinyin } from '../zh/tones.js';
import { neonIgnite } from '../zh/writer.js';
import * as tts from '../zh/audio.js';

const s = strings.welcome;
const q = strings.quiz;
const { toneGymSetSize } = config.learn;

/** The unintuitive letters, for the pinyin crash intro (§1.3). */
const PINYIN_NOTES = [
  { letters: 'x', hint: 'like the "sh" in "sheep", with the tongue low and forward', example: '西 xī' },
  { letters: 'q', hint: 'like the "ch" in "cheese", tongue low and forward', example: '七 qī' },
  { letters: 'j', hint: 'like the "j" in "jeep", tongue low and forward', example: '鸡 jī' },
  { letters: 'c', hint: 'not "k" — it is "ts", as in "cats"', example: '菜 cài' },
  { letters: 'z', hint: '"ds", as in "beds"', example: '在 zài' },
  { letters: 'zh ch sh', hint: 'the same as j q x, but with the tongue curled back', example: '中 zhōng' },
  { letters: 'r', hint: 'between English "r" and the "s" in "measure"', example: '人 rén' },
  { letters: 'ü', hint: 'say "ee", then round your lips without moving your tongue', example: '女 nǚ' },
  { letters: 'u after j q x y', hint: 'always ü, even though the dots are dropped', example: '去 qù' },
  { letters: 'e', hint: 'usually the "u" in "sun", not the "e" in "bed"', example: '和 hé' },
];

/** A TONES step. `intro` shows the archetype to tap; `singles`/`pairs` run a scored drill. */
export function renderTonesStep(host, set, onDone) {
  if (set === 'intro') return tonesIntro(host, onDone);
  runDrill(host, { pairs: set === 'pairs' }, onDone);
}

/** The mā má mǎ mà · ma archetype — tap each to hear it. */
function tonesIntro(host, onDone) {
  const samples = ARCHETYPE.map((entry) => {
    const key = store.deck?.lookup(entry.simp, entry.pinyinNum)?.id;
    const node = button('', () => tts.speak(entry.simp, { key }), {
      variant: 'tone-sample', 'aria-label': `${entry.pinyin} — ${entry.gloss}`,
    });
    const pinyin = span({ class: 'tone-sample-pinyin' });
    pinyin.append(colorPinyin(entry.pinyinNum));
    node.append(
      span({ class: `tone-sample-mark t${entry.tone}`, text: entry.tone === 5 ? '·' : String(entry.tone) }),
      pinyin,
      span({ class: 'tone-sample-gloss', text: entry.gloss }),
    );
    return node;
  });

  replace(host, div({ class: 'sounds-step' }, [
    h(1, s.tonesTitle, 'lesson-title'),
    p(s.tonesBody, 'welcome-lead'),
    div({ class: 'tone-samples' }, samples),
    p(s.tonesTap, 'muted'),
    div({ class: 'welcome-choices' }, [button(s.continue, onDone, { variant: 'btn-primary btn-cta' })]),
  ]));
}

/**
 * "Which tone did you hear?" — a set of drills, scored into the tone stats. Returns via `onDone`.
 * When `scoreOut` is given it also reports {score,total}, which the checkpoint uses.
 */
function runDrill(host, { pairs, scoreOut }, onDone) {
  let drills = [];
  let index = 0;
  let score = 0;
  let chosen = [];

  (async () => {
    await tts.loadManifest();
    const pool = buildTonePool(store.deck?.words ?? [], (id) => Boolean(tts.packUrl(id)));
    drills = buildDrillSet({ size: toneGymSetSize, pairs, stats: store.toneStats, pool });
    paint();
  })();

  const play = () =>
    drills[index]?.syllables.forEach((syl, i) => {
      const say = () => tts.speak(syl.text, { key: syl.key, rotate: true });
      if (i === 0) say(); else setTimeout(say, i * 900);
    });

  function paint() {
    if (!drills.length) return replace(host, p(strings.common.loading, 'muted'));
    if (index >= drills.length) {
      scoreOut?.({ score, total: drills.length });
      return onDone({ score, total: drills.length });
    }
    const drill = drills[index];
    chosen = [];
    const feedback = p('', 'verdict');
    const answers = div({ class: 'tone-answers' });

    const answer = (tone) => {
      chosen.push(tone);
      if (chosen.length < drill.answer.length) { feedback.textContent = s.drillFirst(chosen[0]); return; }
      const right = isCorrect(drill, chosen);
      if (right) score += 1;
      feedback.textContent = right ? s.drillRight : s.drillWrong(drill.answer.join('–'));
      feedback.className = `verdict ${right ? 'ok' : 'bad'}`;
      for (const [i, answered] of drill.answer.entries()) {
        recordToneResult({ tone: answered, correct: right, pair: drill.answer.length > 1 && i > 0 });
      }
      setTimeout(() => { index += 1; paint(); }, right ? 550 : 1400);
    };

    for (const tone of [1, 2, 3, 4, 5]) {
      const node = button('', () => answer(tone), { variant: `tone-answer t${tone}` });
      node.append(
        span({ class: 'tone-answer-num', text: tone === 5 ? '·' : String(tone) }),
        span({ class: 'tone-answer-name', text: s.toneNames[tone - 1] }),
      );
      answers.append(node);
    }

    replace(host, div({ class: 'sounds-step' }, [
      h(1, pairs ? s.drillPairsTitle : s.drillTitle, 'lesson-title'),
      p(s.drillProgress(index + 1, drills.length), 'muted'),
      button(s.drillReplay, () => play(), { variant: 'btn-quiet' }),
      p(pairs ? s.drillPairsPrompt : s.drillPrompt, 'welcome-lead'),
      answers,
      feedback,
    ]));
    play();
  }
}

/** The pinyin crash intro: one unintuitive letter at a time. */
export function renderPinyinStep(host, onDone) {
  let index = 0;
  const body = div({ class: 'pinyin-note' });
  replace(host, div({ class: 'sounds-step' }, [h(1, s.pinyinTitle, 'lesson-title'), body]));

  const paint = () => {
    if (index >= PINYIN_NOTES.length) return onDone();
    const note = PINYIN_NOTES[index];
    replace(body,
      p(s.pinyinProgress(index + 1, PINYIN_NOTES.length), 'muted'),
      div({ class: 'pinyin-letters', text: note.letters }),
      p(note.hint, 'welcome-lead'),
      div({ class: 'pinyin-example', text: note.example }),
      div({ class: 'welcome-choices' }, [
        button(s.next, () => { index += 1; paint(); }, { variant: 'btn-primary' }),
      ]),
    );
  };
  paint();
}

/**
 * The wordless mini-checkpoint: a mixed tone drill scored against QUIZ_PASS. Clearing it logs a
 * CHECKPOINT practice event for Unit 0 (so the syllabus marks it cleared, from the log alone) and
 * ignites its sign, exactly like any other checkpoint.
 */
export function renderSoundsCheckpoint(root, ctx, unit) {
  const host = div({ class: 'quiz' });
  replace(root, stage('quiz', [
    div({ class: 'lesson-head' }, [
      button(strings.lesson.leave, () => ctx.navigate('#course'), { variant: 'btn-quiet lesson-leave' }),
      h(1, q.title(unit.title), 'lesson-title'),
    ]),
    host,
  ]));

  // The checkpoint is a single scored pairs drill — the hardest of the tone skills.
  runDrill(host, { pairs: true }, async ({ score, total }) => {
    const fraction = total ? score / total : 0;
    const { cleared, gold } = await recordCheckpoint(unit.id, fraction);

    const sign = div({ class: 'quiz-sign' });
    if (cleared) neonIgnite(sign, '声', { color: gold ? 'var(--neon-yellow)' : 'var(--accent)', size: 120 });
    else sign.append(div({ class: 'quiz-sign-flat', text: '·' }));

    replace(root, stage('quiz', [div({ class: 'quiz-result' }, [
      sign,
      h(1, cleared ? (gold ? q.goldTitle : q.clearedTitle) : q.tryAgainTitle, 'lesson-title'),
      p(cleared ? (gold ? q.goldBody : q.clearedBody) : q.tryAgainBody(Math.round(config.course.quizPass * 100)), 'welcome-lead'),
      div({ class: 'welcome-choices' }, [
        button(q.retake, () => renderSoundsCheckpoint(root, ctx, unit), { variant: cleared ? 'btn-quiet' : 'btn-primary btn-cta' }),
        button(q.backToPath, () => ctx.navigate('#course'), { variant: cleared ? 'btn-primary btn-cta' : 'btn-quiet' }),
      ]),
    ])]));
  });
}
