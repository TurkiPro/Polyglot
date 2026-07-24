#!/usr/bin/env python3
"""Render the bake-off set with each candidate engine (Phase 8 §1).

Build-time only, on a trusted machine. Neither engine is a project dependency; both are
tools you install locally, and a missing one is reported rather than fatal so the other
can still be judged.

    python packs/zh/audio/bakeoff.py                  # every engine that is installed
    python packs/zh/audio/bakeoff.py --engine piper   # one; the rest keep last run's audio

Engines: `piper` (chaowen at its defaults), `piper-fixed` (the same voice with synthesis
noise off, the only bit-reproducible option) and `melotts`.

Then open samples/index.html, listen with headphones, and judge tone accuracy. Samples are
peak-levelled first so loudness cannot decide the comparison.
"""
from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import ensure_utf8_mode, measure, normalize  # noqa: E402

ensure_utf8_mode()

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SAMPLES = HERE / "samples"
MODELS = HERE / "models"

# Only voices whose engine, model AND training dataset permit redistribution — see
# README.md. Piper's default zh voice (huayan) is deliberately not here: its dataset
# licence is stated as "Unknown", which is not a grant.
PIPER_VOICE = "zh_CN-chaowen-medium"
MELO_SPEAKER = "ZH"


def load_set() -> dict:
    return json.loads((HERE / "samples.json").read_text(encoding="utf-8"))


# ── Piper ────────────────────────────────────────────────────────────────
def render_piper_fixed(items: list[tuple[str, str]], out: Path) -> str | None:
    """The same voice with synthesis noise disabled, which makes rendering reproducible.

    Both engines are stochastic by default: the noise lives inside the ONNX graph, so
    seeding numpy does nothing and the same text yields different bytes every run. Since a
    file's name *is* its content hash, a re-run after a deck update would rename all ~17k
    files, orphan the uploaded pack and invalidate every cached client. Zeroing the noise
    scales fixes that — at some cost to prosody, which is exactly why it is a column here
    rather than a decision made for you.
    """
    return render_piper(items, out, deterministic=True)


def render_piper(items: list[tuple[str, str]], out: Path, deterministic: bool = False) -> str | None:
    """Piper via its Python API, with the model kept in models/ beside this script.

    Chinese is not the light path Piper's reputation suggests: it phonemizes through
    G2PW, which pulls in torch and downloads a model of its own on first use. See
    README.md — that finding is half the point of the bake-off.
    """
    try:
        import wave

        from piper import PiperVoice, SynthesisConfig
    except ImportError:
        return "piper-tts is not installed (pip install piper-tts) — see README.md"

    syn_config = SynthesisConfig(noise_scale=0.0, noise_w_scale=0.0) if deterministic else None

    model = MODELS / f"{PIPER_VOICE}.onnx"
    if not model.exists():
        return f"voice missing: run `python -m piper.download_voices {PIPER_VOICE}` and move it into {MODELS}"

    # G2PW's model lives in `<download_dir>/g2pW`, and download_dir defaults to the
    # *current* directory — so without this the 159 MB folder is only found when you
    # happen to run from the repo root, and is re-downloaded when you do not.
    try:
        voice = PiperVoice.load(str(model), download_dir=ROOT)
    except Exception as err:  # noqa: BLE001
        return f"could not load {PIPER_VOICE}: {err}"

    # An empty phoneme list means the Chinese phonemizer is not actually working, and
    # every file would be silence. Fail loudly rather than shipping 25 silent samples.
    try:
        phonemes = voice.phonemize(items[0][1])
        if not any(phonemes):
            return ("the Chinese phonemizer returned no phonemes — G2PW loaded but matched "
                    "nothing. This is usually the locale: g2pW reads its dictionaries in the "
                    "system codepage, so run under UTF-8 mode (this script re-execs itself, "
                    "so seeing this means something defeated that).")
    except Exception as err:  # noqa: BLE001
        return f"phonemizer unavailable: {type(err).__name__}: {err}"

    out.mkdir(parents=True, exist_ok=True)
    for name, text in items:
        try:
            with wave.open(str(out / f"{name}.wav"), "wb") as target:
                voice.synthesize_wav(text, target, syn_config=syn_config)
        except Exception as err:  # noqa: BLE001
            return f"piper failed on {name}: {err}"
    return None


# ── MeloTTS ──────────────────────────────────────────────────────────────
def render_melo(items: list[tuple[str, str]], out: Path) -> str | None:
    try:
        from melo.api import TTS
    except ImportError as err:
        # Report what actually failed. MeloTTS pulls a deep, elderly dependency tree, and
        # "not installed" is usually a lie: the package is present and something beneath it
        # broke. librosa 0.9.1 imports pkg_resources, which setuptools >= 81 removed, so a
        # current venv fails here with MeloTTS sitting right there in pip list.
        missing = getattr(err, "name", "") or ""
        if missing == "pkg_resources":
            return ("librosa needs pkg_resources, removed in setuptools >= 81 — "
                    "`pip install 'setuptools<81'` (see README.md)")
        if missing in {"melo", "melo.api"}:
            return "MeloTTS is not installed (see README.md for the install line)"
        return f"MeloTTS could not be imported: {type(err).__name__}: {err}"

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


ENGINES = {"piper": render_piper, "piper-fixed": render_piper_fixed, "melotts": render_melo}


def write_index(data: dict, rendered: dict[str, bool], levels: dict[str, dict]) -> None:
    """A page that puts the engines side by side, because that is how ears compare."""
    rows = []
    for group, key in (("words", "simp"), ("sentences", "zh")):
        rows.append(f"<h2>{group}</h2><table><tr><th>text</th><th>why it is here</th>"
                    + "".join(f"<th>{html.escape(e)}</th>" for e in ENGINES) + "</tr>")
        for index, item in enumerate(data[group]):
            name = f"{group}-{index:02d}"
            text = html.escape(item[key])
            extra = html.escape(item.get("pinyin", ""))
            cells = ""
            for engine, ok in rendered.items():
                if not ok:
                    cells += "<td>—</td>"
                    continue
                peak = levels.get(engine, {}).get(name, (None, None))[0]
                # Flag what arrived near-silent, since levelling hides it from the ear.
                flag = ("<small class=warn>was near-silent (peak %d/32767)</small>" % peak
                        if peak is not None and peak < 1000 else "")
                cells += f'<td><audio controls src="{engine}/{name}.wav"></audio>{flag}</td>'
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
        ".why{font-size:.85rem;color:#666;max-width:22rem}audio{height:2rem}"
        ".warn{display:block;font-size:.75rem;color:#b3362b;margin-top:.25rem}</style>"
        "<h1>TTS bake-off</h1><p>Judge <strong>tone accuracy</strong>, not pleasantness. "
        "好 / 号 / 巧 must be unmistakably different, and third tone should dip rather "
        "than merely fall. Headphones.</p>"
        "<p><small>Every sample is peak-levelled so loudness cannot decide the vote — the "
        "engines disagree about output gain by roughly 10&times;. Anything that arrived "
        "near-silent is flagged in red under its player; that is a real defect, not a "
        "volume preference.</small></p>"
        "<p><small><strong>piper-fixed</strong> is the same voice with synthesis noise "
        "switched off. Both engines are otherwise random: identical text renders different "
        "bytes each run, and since a file is named after its content hash, re-running the "
        "generator would rename all ~17k files and orphan the uploaded pack. Pick "
        "<strong>piper-fixed</strong> unless it sounds audibly worse than "
        "<strong>piper</strong> — reproducible regeneration is worth a little prosody.</small>"
        "</p>" + "".join(rows),
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
    attempted: list[str] = []

    for engine in ENGINES:
        # An engine left out by --engine keeps whatever it rendered last time, so the page
        # can still compare both. Only an engine we actually tried can be said to have failed.
        if engine not in chosen:
            rendered[engine] = (SAMPLES / engine).is_dir() and any((SAMPLES / engine).glob("*.wav"))
            continue

        attempted.append(engine)
        print(f"[{engine}] rendering {len(items)} items…")
        problem = ENGINES[engine](items, SAMPLES / engine)
        rendered[engine] = problem is None
        print(f"[{engine}] {'done' if problem is None else 'SKIPPED — ' + problem}")

    # Level the samples and report what the engines actually returned, before levelling.
    #
    # Raw levels are written beside the audio because levelling is destructive: on a later
    # partial run the untouched engine's files are already levelled, and re-measuring them
    # would erase the near-silence finding from the page. Measure once, at render time.
    levels: dict[str, dict[str, tuple[int, int]]] = {}
    for engine, ok in rendered.items():
        if not ok:
            continue
        sidecar = SAMPLES / engine / "levels.json"

        if engine not in attempted:
            # Never measure files this run did not render: they are already levelled, so the
            # numbers would be the levelling target rather than what the engine produced.
            # Trust the sidecar or report nothing.
            if sidecar.exists():
                levels[engine] = {k: tuple(v) for k, v in json.loads(sidecar.read_text()).items()}
            continue

        levels[engine] = {}
        for name, _ in items:
            path = SAMPLES / engine / f"{name}.wav"
            if path.exists():
                levels[engine][name] = measure(path)
                normalize(path)
        sidecar.write_text(json.dumps({k: list(v) for k, v in levels[engine].items()}))

    for engine, measured in levels.items():
        if not measured:
            continue
        quiet = [n for n, (peak, _) in measured.items() if peak < 1000]
        loudest = max(peak for peak, _ in measured.values())
        note = f", {len(quiet)} near-silent before levelling" if quiet else ""
        print(f"[{engine}] peak {loudest}/32767{note}")

    write_index(data, rendered, levels)
    print(f"\nOpen {SAMPLES / 'index.html'} and listen.")

    if not any(rendered.values()):
        print("\nNothing was rendered. Install at least one engine — see README.md.")
        return 1
    if attempted and not any(rendered[engine] for engine in attempted):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
