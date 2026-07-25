/**
 * `#tones` — the Tone gym (Phase 7 §1).
 *
 * The same drills onboarding uses, endless, weighted toward whatever this learner keeps
 * getting wrong. Results are counters in `meta`, never FSRS cards: tone perception has no
 * spacing schedule, and minting cards for it would pollute the review queue and the XP
 * that derives from it.
 */
import { config } from '../../../config/app.config.js';
import { recordToneResult, store } from '../store.js';
import { button, div, h, p, progressBar, replace, span } from '../ui/components.js';
import { stage } from '../ui/arcade.js';
import { strings } from '../ui/strings.js';
import { buildDrillSet, buildTonePool, isCorrect, summarize } from '../zh/tones-drill.js';
import * as tts from '../zh/audio.js';

const s = strings.tones;
const { toneGymSetSize } = config.learn;

export function renderToneGym(root, ctx) {
  const host = div({ class: 'tone-gym-view' });
  replace(root, stage('tones', [h(1, s.title, 'title'), host]));

  const menu = () => {
    const stats = summarize(store.toneStats);
    replace(
      host,
      p(s.blurb, 'muted'),
      div({ class: 'welcome-choices' }, [
        button(s.startSingles, () => run({ pairs: false }), { variant: 'btn-primary btn-cta' }),
        button(s.startPairs, () => run({ pairs: true }), { variant: 'btn-quiet' }),
      ]),
      stats ? accuracyPanel(stats) : p(s.noHistory, 'muted'),
    );
  };

  /** One set of drills, then back to the menu. */
  const run = async ({ pairs }) => {
    // Pack audio needs the manifest loaded before the pool can resolve keys; a miss just
    // means the fallback syllables (toneless) — the same graceful path as no pack at all.
    await tts.loadManifest();
    const pool = buildTonePool(store.deck?.words ?? [], (id) => Boolean(tts.packUrl(id)));
    const drills = buildDrillSet({ size: toneGymSetSize, pairs, stats: store.toneStats, pool });
    let index = 0;
    let score = 0;
    let chosen = [];

    // A pair is two words; play them in sequence, spaced so each tone lands on its own.
    const play = () =>
      drills[index].syllables.forEach((syl, i) => {
        const say = () => tts.speak(syl.text, { key: syl.key, rotate: true });
        if (i === 0) say();
        else setTimeout(say, i * 900);
      });

    const paint = () => {
      if (index >= drills.length) {
        replace(
          host,
          p(s.setDone(score, drills.length), 'welcome-lead'),
          div({ class: 'welcome-choices' }, [
            button(s.again, () => run({ pairs }), { variant: 'btn-primary' }),
            button(s.back, () => menu(), { variant: 'btn-quiet' }),
          ]),
        );
        return;
      }

      const drill = drills[index];
      chosen = [];
      const feedback = p('', 'verdict');
      const answers = div({ class: 'tone-answers' });

      const answer = (tone) => {
        chosen.push(tone);
        if (chosen.length < drill.answer.length) {
          feedback.textContent = strings.welcome.drillFirst(chosen[0]);
          return;
        }

        const right = isCorrect(drill, chosen);
        if (right) score += 1;
        feedback.textContent = right
          ? strings.welcome.drillRight
          : strings.welcome.drillWrong(drill.answer.join('–'));
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
          span({ class: 'tone-answer-name', text: strings.welcome.toneNames[tone - 1] }),
        );
        answers.append(node);
      }

      replace(
        host,
        p(strings.welcome.drillProgress(index + 1, drills.length), 'muted'),
        button(strings.welcome.drillReplay, () => play(), { variant: 'btn-quiet' }),
        p(pairs ? strings.welcome.drillPairsPrompt : strings.welcome.drillPrompt, 'welcome-lead'),
        answers,
        feedback,
      );
      play();
    };

    paint();
  };

  /** Where this learner actually stands, per tone. */
  function accuracyPanel(stats) {
    const bars = stats.perTone
      .filter((row) => row.attempts > 0)
      .map((row) =>
        progressBar(row.accuracy, s.toneAccuracy(row.tone, Math.round(row.accuracy * 100), row.attempts)),
      );

    return div({ class: 'panel' }, [
      p(s.overall(Math.round(stats.accuracy * 100), stats.attempts), 'muted'),
      div({ class: 'bars' }, bars),
    ]);
  }

  menu();
  return () => tts.stop();
}
