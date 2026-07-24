#!/usr/bin/env python3
"""Render the audio pack and write its manifest (Phase 8 §2).

Build-time only. Renders every deck word plus every Phase 7 intro sentence with the
engine chosen in config, encodes to mono Opus in .ogg, names each file by content hash,
and writes `app/assets/packs/zh/audio-manifest.json`.

    python packs/zh/audio/generate.py            # everything missing
    python packs/zh/audio/generate.py --limit 50 # a slice, to sanity-check first
    python packs/zh/audio/generate.py --force    # re-render even if present

The .ogg files are NOT committed — the manifest is (§2). Regeneration is deterministic
for a pinned engine version, so a rebuild reproduces the same hashes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = HERE / "out"
MODELS = HERE / "models"
DECK = ROOT / "app" / "assets" / "packs" / "zh" / "deck.zh.json"
MANIFEST = ROOT / "app" / "assets" / "packs" / "zh" / "audio-manifest.json"
CONFIG = ROOT / "config" / "app.config.js"

OPUS_BITRATE = "24k"


def read_engine() -> str:
    """The engine the maintainer picked, read from config so there is one source."""
    text = CONFIG.read_text(encoding="utf-8")
    for line in text.splitlines():
        if "engine:" in line and "audio" not in line:
            value = line.split("engine:")[1].strip().strip(",").strip("'\"")
            if value:
                return value
    return ""


def items_from_deck(limit: int | None) -> list[tuple[str, str]]:
    """Every deck word, plus the sentence each word debuts in (§2 scope)."""
    deck = json.loads(DECK.read_text(encoding="utf-8"))
    seen: dict[str, str] = {}

    for word in deck["words"]:
        seen.setdefault(word["id"], word["simp"])

    for word in deck["words"]:
        intro = word.get("introSentence")
        if not intro:
            continue
        for sentence in word.get("sentences", []):
            if sentence.get("src") == intro:
                seen.setdefault(intro, sentence["zh"])
                break

    pairs = list(seen.items())
    return pairs[:limit] if limit else pairs


def have_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def to_opus(wav: Path, ogg: Path) -> None:
    """Mono Opus at ~24 kbps — speech at conversational quality, ~6-12 KB a word."""
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav),
         "-ac", "1", "-c:a", "libopus", "-b:a", OPUS_BITRATE, str(ogg)],
        check=True,
    )


def content_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def render_piper(items: list[tuple[str, str]], force: bool) -> dict[str, dict]:
    from piper import PiperVoice  # imported here so --help works without it

    from bakeoff import PIPER_VOICE  # the licence-clean voice, one definition

    model = MODELS / f"{PIPER_VOICE}.onnx"
    if not model.exists():
        raise SystemExit(f"voice missing: {model} — see README.md")

    voice = PiperVoice.load(str(model))
    OUT.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict] = {}

    for index, (key, text) in enumerate(items, 1):
        temp = OUT / "_tmp.wav"
        with wave.open(str(temp), "wb") as target:
            voice.synthesize_wav(text, target)

        digest = content_hash(temp)
        ogg = OUT / f"{digest}.ogg"
        if force or not ogg.exists():
            to_opus(temp, ogg)

        manifest[key] = {"file": ogg.name, "hash": digest, "bytes": ogg.stat().st_size}
        temp.unlink(missing_ok=True)

        if index % 200 == 0:
            print(f"  {index}/{len(items)}")

    return manifest


ENGINES = {"piper": render_piper}


def main() -> int:
    parser = argparse.ArgumentParser(description="Render the audio pack")
    parser.add_argument("--limit", type=int, help="only the first N items")
    parser.add_argument("--force", action="store_true", help="re-encode existing files")
    args = parser.parse_args()

    engine = read_engine()
    if not engine:
        print("No engine chosen yet. Run the bake-off, listen, then set audio.engine in")
        print("config/app.config.js — see packs/zh/audio/README.md.")
        return 1
    if engine not in ENGINES:
        print(f"config names engine '{engine}', which has no renderer here.")
        return 1
    if not have_ffmpeg():
        print("ffmpeg is required to encode Opus. Install it and re-run.")
        return 1

    items = items_from_deck(args.limit)
    print(f"[{engine}] rendering {len(items)} items…")
    manifest = ENGINES[engine](items, args.force)

    total = sum(entry["bytes"] for entry in manifest.values())
    MANIFEST.write_text(
        json.dumps(
            {
                "engine": engine,
                "base": "/audio/",
                "generated": len(manifest),
                "bytes": total,
                "items": manifest,
            },
            ensure_ascii=False,
            indent=0,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"  {len(manifest)} files, {total / 1_048_576:.1f} MB")
    print(f"  manifest → {MANIFEST.relative_to(ROOT)}")
    print("  next: node packs/zh/audio/upload.mjs")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    raise SystemExit(main())
