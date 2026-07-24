#!/usr/bin/env python3
"""Why single characters sound toneless, and the fix (Phase 8 §1 follow-up).

An isolated character is the hardest thing to ask a sentence-trained TTS model for: 好
phonemizes to just `['h', 'ao', '3']`. With no run-up and no sentence-final position, the
model lays almost no tone contour over it — measured, this voice moves 130-170 Hz of pitch
*inside a sentence* and collapses to 20-40 Hz for the same character alone, so third tone
never dips and everything sounds clipped.

The fix is to give the syllable the context the model needs and then take it back: render
it at the end of a short carrier phrase, where it gets full tone, and crop the carrier off.
This renders bare vs. carrier-cropped side by side so the difference can be judged by ear.

    python packs/zh/audio/isolated.py

Every clip is deterministic (noise off), trimmed and levelled, so the only thing that
differs between columns is the strategy. If carrier-cropped wins by ear, wire it into
generate.py for short words.
"""
from __future__ import annotations

import html
import json
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from carrier import crop_target, write_wav  # noqa: E402
from lib import duration, ensure_utf8_mode, f0_range, normalize, trim_silence  # noqa: E402

ensure_utf8_mode()

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = HERE / "samples" / "isolated"

# The chosen carrier (请说_。) is what generate.py ships; 这是_。 stays as a foil, to show
# on the page why a carrier that ends low flattens the target. `{}` is today's baseline.
STRATEGIES: dict[str, str | None] = {
    "bare": None,
    "carrier 这是_。": "这是{}。",
    "carrier 请说_。": "请说{}。",
}


def load_chars() -> list[dict]:
    """The single-character words from the bake-off set — the tone minimal pairs."""
    data = json.loads((HERE / "samples.json").read_text(encoding="utf-8"))
    return [word for word in data["words"] if len(word["simp"]) == 1]


def render(chars: list[dict]) -> dict[str, dict[str, dict]]:
    from piper import PiperVoice, SynthesisConfig

    from bakeoff import PIPER_VOICE

    model = HERE / "models" / f"{PIPER_VOICE}.onnx"
    if not model.exists():
        raise SystemExit(f"voice missing: {model} — see README.md")

    # include_alignments patches the model in memory so per-phoneme sample counts come back.
    voice = PiperVoice.load(str(model), download_dir=ROOT, include_alignments=True)
    if not any(voice.phonemize(chars[0]["simp"])):
        raise SystemExit("the Chinese phonemizer returned no phonemes — see README.md")

    config = SynthesisConfig(noise_scale=0.0, noise_w_scale=0.0)
    results: dict[str, dict[str, dict]] = {}

    for name, carrier in STRATEGIES.items():
        out = OUT / name.split()[0]  # "bare" / "carrier"
        out.mkdir(parents=True, exist_ok=True)
        results[name] = {}

        for word in chars:
            simp = word["simp"]
            path = out / (f"{simp}.wav" if carrier is None else f"{simp}-{name[-3]}.wav")

            if carrier is None:
                with wave.open(str(path), "wb") as target:
                    voice.synthesize_wav(simp, target, syn_config=config)
            else:
                pcm, rate = crop_target(voice, config, simp, carrier)
                if pcm is None:
                    continue
                write_wav(path, pcm, rate)

            trim_silence(path)
            normalize(path)
            results[name][simp] = {
                "path": path.relative_to(OUT).as_posix(),
                "dur": round(duration(path), 2),
                "f0": f0_range(path),
            }
        print(f"[{name}] {len(chars)} characters")

    return results


def write_index(chars: list[dict], results: dict[str, dict[str, dict]]) -> None:
    head = "".join(f"<th>{html.escape(name)}</th>" for name in STRATEGIES)
    rows = []
    for word in chars:
        simp = word["simp"]
        cells = ""
        for name in STRATEGIES:
            info = results[name].get(simp)
            if info is None:
                cells += "<td>—</td>"
                continue
            cells += (f'<td><audio controls src="{info["path"]}"></audio>'
                      f'<small>{info["dur"]:.2f}s · {info["f0"]} Hz swing</small></td>')
        rows.append(f'<tr><td class=zh>{html.escape(simp)}'
                    f'<small>{html.escape(word.get("pinyin", ""))} · {html.escape(word["why"])}'
                    f'</small></td>{cells}</tr>')

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.html").write_text(
        "<!doctype html><meta charset=utf-8><title>polyglot — isolated characters</title>"
        "<style>body{font:16px system-ui;max-width:64rem;margin:2rem auto;padding:0 1rem}"
        "table{border-collapse:collapse;width:100%}"
        "td,th{border-bottom:1px solid #ddd;padding:.6rem;text-align:left;vertical-align:middle}"
        "td small,th small{display:block;font-size:.75rem;color:#666;font-weight:400}"
        ".zh{font-size:1.7rem}audio{height:2rem;max-width:13rem}</style>"
        "<h1>Isolated characters</h1>"
        "<p>A single character is three phonemes with no run-up, and this sentence-trained "
        "voice lays almost no tone over it — that is why 好 / 号 / 巧 sound flat and clipped "
        "in the pack today (the <strong>bare</strong> column).</p>"
        "<p>The <strong>carrier</strong> columns render the character at the end of a short "
        "phrase, where it gets a real tone, then cut it back out at exact phoneme boundaries "
        "— so what you hear is one syllable, not the phrase. <strong>Listen across each "
        "row.</strong> The Hz figure is how far the pitch moves inside that syllable; it is "
        "a rough proxy, not the verdict. What matters is whether the tone is right and "
        "whether coarticulation from the carrier (the preceding 是 / 说) bends the onset — "
        "your ear decides.</p>"
        f"<table><tr><th>character</th>{head}</tr>" + "".join(rows) + "</table>",
        encoding="utf-8",
    )


def main() -> int:
    chars = load_chars()
    print(f"{len(chars)} single-character words × {len(STRATEGIES)} strategies")
    results = render(chars)
    write_index(chars, results)

    print("\nF0 swing (Hz) — bare vs carrier-cropped:")
    print(f"  {'char':6}" + "".join(f"{name:>16}" for name in STRATEGIES))
    for word in chars:
        simp = word["simp"]
        print(f"  {simp:6}" + "".join(f"{results[n][simp]['f0']:>16}" for n in STRATEGIES))

    print(f"\nOpen {OUT / 'index.html'} and compare across each row.")
    return 0


if __name__ == "__main__":
    main()
