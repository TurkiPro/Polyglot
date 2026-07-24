/**
 * `#welcome` — onboarding (Phase 7 §1).
 *
 * Phonology first: a learner who cannot hear the four tones cannot store a Chinese word,
 * so tones come before any vocabulary card. Every step is skippable, and the whole flow
 * is revisitable from Settings — this teaches, it does not gate.
 */
import { config } from '../../../config/app.config.js';
import { recordToneResult, store, updateSettings } from '../store.js';
import { button, div, el, h, p, replace, sealMark, span } from '../ui/components.js';
import { strings } from '../ui/strings.js';
import { ARCHETYPE, buildDrillSet, isCorrect } from '../zh/tones-drill.js';
import { colorPinyin } from '../zh/tones.js';
import * as tts from '../zh/tts.js';

const s = strings.welcome;
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

/**
 * @param {HTMLElement} root
 * @param {{ navigate: (hash: string) => void }} ctx
 */
export function renderWelcome(root, ctx) {
  const stage = div({ class: 'welcome' });
  replace(root, stage);

  /** Every step returns nodes; this just swaps them in. */
  const show = (nodes) => replace(stage, ...nodes.filter(Boolean));

  const finish = async () => {
    await updateSettings({ onboarded: true, welcomeBannerDismissed: true });
    ctx.navigate('#home');
  };

  /* ── 1. One question ──────────────────────────────────── */
  const askExperience = () =>
    show([
      div({ class: 'welcome-mark' }, [sealMark(64)]),
      h(1, s.title, 'welcome-title'),
      p(s.intro, 'welcome-lead'),
      div({ class: 'welcome-choices' }, [
        button(s.newToChinese, () => teachTones(), { variant: 'btn-primary btn-cta' }),
        button(s.knowSome, () => askWriting(), { variant: 'btn-quiet' }),
      ]),
      skipLink(),
    ]);

  /* ── 2. Tone intro, then drills ───────────────────────── */
  const teachTones = () => {
    const samples = ARCHETYPE.map((entry) => {
      const node = button('', () => tts.speak(entry.pinyin), {
        variant: 'tone-sample',
        'aria-label': `${entry.pinyin} — ${entry.gloss}`,
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

    show([
      h(1, s.tonesTitle, 'welcome-title'),
      p(s.tonesBody, 'welcome-lead'),
      div({ class: 'tone-samples' }, samples),
      p(s.tonesTap, 'muted'),
      div({ class: 'welcome-choices' }, [
        button(s.tonesDrill, () => runDrills({ pairs: false, then: () => runDrills({ pairs: true, then: teachPinyin }) }), {
          variant: 'btn-primary btn-cta',
        }),
        button(s.skipStep, () => teachPinyin(), { variant: 'btn-quiet' }),
      ]),
      skipLink(),
    ]);
  };

  /** "Which tone did you hear?" — single syllables, then pairs. */
  const runDrills = ({ pairs, then }) => {
    const drills = buildDrillSet({ size: toneGymSetSize, pairs, stats: store.toneStats });
    let index = 0;
    let score = 0;
    let chosen = [];

    const host = div({ class: 'drill' });
    show([h(1, pairs ? s.drillPairsTitle : s.drillTitle, 'welcome-title'), host, skipLink()]);

    const play = () => tts.speak(drills[index].syllables.map((x) => x.syllable).join(' '), { rotate: true });

    const paint = () => {
      if (index >= drills.length) {
        replace(
          host,
          p(s.drillDone(score, drills.length), 'welcome-lead'),
          div({ class: 'welcome-choices' }, [
            button(s.continue, () => then(), { variant: 'btn-primary btn-cta' }),
          ]),
        );
        return;
      }

      const drill = drills[index];
      chosen = [];
      const feedback = p('', 'verdict');
      const buttons = div({ class: 'tone-answers' });

      const answer = (tone) => {
        chosen.push(tone);
        if (chosen.length < drill.answer.length) {
          feedback.textContent = s.drillFirst(chosen[0]);
          return;
        }

        const right = isCorrect(drill, chosen);
        if (right) score += 1;
        // Feedback is immediate, always — that is the retrieval-practice half of this.
        feedback.textContent = right ? s.drillRight : s.drillWrong(drill.answer.join('–'));
        feedback.className = `verdict ${right ? 'ok' : 'bad'}`;

        for (const [i, tone] of drill.answer.entries()) {
          recordToneResult({ tone, correct: right, pair: drill.answer.length > 1 && i > 0 });
        }

        setTimeout(() => {
          index += 1;
          paint();
        }, right ? 550 : 1400);
      };

      for (const tone of [1, 2, 3, 4, 5]) {
        const node = button('', () => answer(tone), { variant: `tone-answer t${tone}` });
        node.append(
          span({ class: 'tone-answer-num', text: tone === 5 ? '·' : String(tone) }),
          span({ class: 'tone-answer-name', text: s.toneNames[tone - 1] }),
        );
        buttons.append(node);
      }

      replace(
        host,
        p(s.drillProgress(index + 1, drills.length), 'muted'),
        button(s.drillReplay, () => play(), { variant: 'btn-quiet' }),
        p(pairs ? s.drillPairsPrompt : s.drillPrompt, 'welcome-lead'),
        buttons,
        feedback,
      );
      play();
    };

    paint();
  };

  /* ── 3. Pinyin crash intro ────────────────────────────── */
  const teachPinyin = () => {
    let index = 0;
    const host = div({ class: 'pinyin-note' });
    show([h(1, s.pinyinTitle, 'welcome-title'), host, skipLink()]);

    const paint = () => {
      if (index >= PINYIN_NOTES.length) return askWriting();
      const note = PINYIN_NOTES[index];
      replace(
        host,
        p(s.pinyinProgress(index + 1, PINYIN_NOTES.length), 'muted'),
        div({ class: 'pinyin-letters', text: note.letters }),
        p(note.hint, 'welcome-lead'),
        div({ class: 'pinyin-example', text: note.example }),
        div({ class: 'welcome-choices' }, [
          button(s.next, () => {
            index += 1;
            paint();
          }, { variant: 'btn-primary' }),
          button(s.skipStep, () => askWriting(), { variant: 'btn-quiet' }),
        ]),
      );
    };

    paint();
  };

  /* ── 4. Writing track ─────────────────────────────────── */
  const askWriting = () =>
    show([
      h(1, s.writingTitle, 'welcome-title'),
      p(s.writingBody, 'welcome-lead'),
      p(s.writingNote, 'muted'),
      div({ class: 'welcome-choices' }, [
        button(s.writingYes, async () => {
          await updateSettings({ writingTrack: true });
          done();
        }, { variant: 'btn-quiet' }),
        button(s.writingNo, async () => {
          await updateSettings({ writingTrack: false });
          done();
        }, { variant: 'btn-primary btn-cta' }),
      ]),
    ]);

  /* ── 5. Done ──────────────────────────────────────────── */
  const done = () =>
    show([
      div({ class: 'welcome-mark' }, [sealMark(96)]),
      h(1, s.readyTitle, 'welcome-title'),
      p(s.readyBody, 'welcome-lead'),
      div({ class: 'welcome-choices' }, [
        button(s.start, () => finish(), { variant: 'btn-primary btn-cta' }),
      ]),
    ]);

  const skipLink = () =>
    el('button', { class: 'btn btn-quiet welcome-skip', text: s.skipAll, on: { click: finish } });

  askExperience();
  return () => tts.stop();
}
