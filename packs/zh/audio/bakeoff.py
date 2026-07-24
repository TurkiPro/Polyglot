#!/usr/bin/env python3
"""Render the bake-off set with each candidate engine (Phase 8 §1).

Build-time only, on a trusted machine. Neither engine is a project dependency; both are
tools you install locally, and a missing one is reported rather than fatal so the other
can still be judged.

    python packs/zh/audio/bakeoff.py
    python packs/zh/audio/bakeoff.py --engine piper

Then open samples/index.html, listen with headphones, and judge tone accuracy.
"""
from __future__ import annotations

import argparse
import html
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SAMPLES = HERE / "samples"
MODELS = HERE / "models"

# Only voices whose engine, model AND training dataset permit redistribution — see
# README.md. Piper's default zh voice (huayan) is deliberately not here: its dataset
# licence is stated as "Unknown", which is not a grant.
PIPER_VOICE = "zh_CN-chaowen-medium"
MELO_SPEAKER = "ZH"


def load_set() -> dict:
    return json.loads((HERE / "samples.json").read_text(encoding="utf-8"))


def have(command: str) -> bool:
    return shutil.which(command) is not None


# ── Piper ────────────────────────────────────────────────────────────────
def render_piper(items: list[tuple[str, str]], out: Path) -> str | None:
    """Piper via its Python API, with the model kept in models/ beside this script.

    Chinese is not the light path Piper's reputation suggests: it phonemizes through
    G2PW, which pulls in torch and downloads a model of its own on first use. See
    README.md — that finding is half the point of the bake-off.
    """
    try:
        import wave

        from piper import PiperVoice
    except ImportError:
        return "piper-tts is not installed (pip install piper-tts) — see README.md"

    model = MODELS / f"{PIPER_VOICE}.onnx"
    if not model.exists():
        return f"voice missing: run `python -m piper.download_voices {PIPER_VOICE}` and move it into {MODELS}"

    try:
        voice = PiperVoice.load(str(model))
    except Exception as err:  # noqa: BLE001
        return f"could not load {PIPER_VOICE}: {err}"

    # An empty phoneme list means the Chinese phonemizer is not actually working, and
    # every file would be silence. Fail loudly rather than shipping 25 silent samples.
    try:
        if not any(voice.phonemize(items[0][1])):
            return ("the Chinese phonemizer returned no phonemes — G2PW is installed but "
                    "not working (it needs torch and downloads a model on first use)")
    except Exception as err:  # noqa: BLE001
        return f"phonemizer unavailable: {type(err).__name__}: {err}"

    out.mkdir(parents=True, exist_ok=True)
    for name, text in items:
        try:
            with wave.open(str(out / f"{name}.wav"), "wb") as target:
                voice.synthesize_wav(text, target)
        except Exception as err:  # noqa: BLE001
            return f"piper failed on {name}: {err}"
    return None


# ── MeloTTS ──────────────────────────────────────────────────────────────
def render_melo(items: list[tuple[str, str]], out: Path) -> str | None:
    try:
        from melo.api import TTS
    except ImportError:
        return "MeloTTS is not installed (pip install git+https://github.com/myshell-ai/MeloTTS.git)"

    out.mkdir(parents=True, exist_ok=True)
    try:
        model = TTS(language="ZH", device="cpu")
        speaker_id = model.hps.data.spk2id[MELO_SPEAKER]
    except Exception as err:  # noqa: BLE001 — any model failure is the same to us
        return f"MeloTTS model failed to load: {err}"

    for name, text in items:
        try:
            model.tts_to_file(text, speaker_id, str(out / f"{name}.wav"), speed=1.0)
        except Exception as err:  # noqa: BLE001
            return f"MeloTTS failed on {name}: {err}"
    return None


ENGINES = {"piper": render_piper, "melotts": render_melo}


def write_index(data: dict, rendered: dict[str, bool]) -> None:
    """A page that puts the engines side by side, because that is how ears compare."""
    rows = []
    for group, key in (("words", "simp"), ("sentences", "zh")):
        rows.append(f"<h2>{group}</h2><table><tr><th>text</th><th>why it is here</th>"
                    + "".join(f"<th>{html.escape(e)}</th>" for e in ENGINES) + "</tr>")
        for index, item in enumerate(data[group]):
            name = f"{group}-{index:02d}"
            text = html.escape(item[key])
            extra = html.escape(item.get("pinyin", ""))
            cells = "".join(
                f'<td>{"<audio controls src=%r></audio>" % f"{engine}/{name}.wav" if ok else "—"}</td>'
                for engine, ok in rendered.items()
            )
            rows.append(f"<tr><td class=zh>{text}<small>{extra}</small></td>"
                        f"<td class=why>{html.escape(item['why'])}</td>{cells}</tr>")
        rows.append("</table>")

    SAMPLES.mkdir(parents=True, exist_ok=True)
    (SAMPLES / "index.html").write_text(
        "<!doctype html><meta charset=utf-8><title>polyglot — TTS bake-off</title>"
        "<style>body{font:16px system-ui;max-width:60rem;margin:2rem auto;padding:0 1rem}"
        "table{border-collapse:collapse;width:100%;margin-bottom:2rem}"
        "td,th{border-bottom:1px solid #ddd;padding:.5rem;text-align:left;vertical-align:middle}"
        ".zh{font-size:1.5rem}.zh small{display:block;font-size:.8rem;color:#666}"
        ".why{font-size:.85rem;color:#666;max-width:22rem}audio{height:2rem}</style>"
        "<h1>TTS bake-off</h1><p>Judge <strong>tone accuracy</strong>, not pleasantness. "
        "好 / 号 / 巧 must be unmistakably different, and third tone should dip rather "
        "than merely fall. Headphones.</p>" + "".join(rows),
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="TTS bake-off for the audio pack")
    parser.add_argument("--engine", choices=list(ENGINES), help="only this engine")
    args = parser.parse_args()

    data = load_set()
    items = [(f"words-{i:02d}", w["simp"]) for i, w in enumerate(data["words"])]
    items += [(f"sentences-{i:02d}", s["zh"]) for i, s in enumerate(data["sentences"])]

    chosen = [args.engine] if args.engine else list(ENGINES)
    rendered: dict[str, bool] = {}

    for engine in ENGINES:
        if engine not in chosen:
            rendered[engine] = False
            continue
        print(f"[{engine}] rendering {len(items)} items…")
        problem = ENGINES[engine](items, SAMPLES / engine)
        rendered[engine] = problem is None
        print(f"[{engine}] {'done' if problem is None else 'SKIPPED — ' + problem}")

    write_index(data, rendered)
    print(f"\nOpen {SAMPLES / 'index.html'} and listen.")

    if not any(rendered.values()):
        print("\nNothing was rendered. Install at least one engine — see README.md.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
