/**
 * The voice picker (§3.4.4).
 *
 * Speech quality is the difference between a listening card that teaches and one that
 * misleads, and platform defaults vary wildly — Windows' built-in Chinese voice in
 * particular. Every Chinese voice the device offers is listed, with a preview, and the
 * choice is remembered.
 *
 * Voices come from the operating system. Nothing here reaches the network (§1.2).
 */
import { store, updateSettings } from '../store.js';
import { button, div, el, p, panel, replace, span } from '../ui/components.js';
import { strings } from '../ui/strings.js';
import * as tts from '../zh/audio.js';

const s = strings.voices;

export function voicePanel() {
  const body = div({ class: 'voices' });
  const host = panel(s.title, [p(s.body, 'muted'), body]);

  const paint = () => {
    const voices = tts.chineseVoices();
    if (voices.length === 0) {
      replace(body, p(s.none, 'muted'), p(s.tip, 'muted'));
      return;
    }

    const chosen = store.settings.voiceUri ?? null;
    replace(
      body,
      voiceRow({ voice: null, chosen, paint }),
      ...voices.map((voice) => voiceRow({ voice, chosen, paint })),
      p(s.tip, 'muted voice-tip'),
    );
  };

  // Several browsers populate the voice list asynchronously.
  tts.ready().then(paint);
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.addEventListener('voiceschanged', paint, { once: true });
  }
  paint();

  return host;
}

/** One row: choose it, or hear it first. */
function voiceRow({ voice, chosen, paint }) {
  const uri = voice?.voiceURI ?? null;
  const active = chosen === uri;

  const choose = el('input', {
    attrs: { type: 'radio', name: 'zh-voice', value: uri ?? 'auto' },
    checked: active,
    on: {
      change: async () => {
        tts.setPreferredVoice(uri);
        await updateSettings({ voiceUri: uri });
        paint();
      },
    },
  });

  const label = el('label', { class: `voice-row${active ? ' active' : ''}` }, [
    choose,
    div({ class: 'voice-text' }, [
      span({ class: 'voice-name', text: voice ? voice.name : s.auto }),
      span({ class: 'voice-lang muted', text: voice ? voice.lang : s.autoNote }),
    ]),
  ]);

  if (voice) {
    // Preview speaks with this voice specifically, not the saved one.
    label.append(
      button(s.preview, () => tts.speak(s.sample, { voice }), {
        variant: 'btn-quiet btn-small',
      }),
    );
  }

  return label;
}
