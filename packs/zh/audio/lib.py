"""Shared helpers for the audio build scripts (Phase 8).

Build-time only. Kept separate so `bakeoff.py`, `isolated.py` and `generate.py` agree on
UTF-8 handling and levelling rather than each carrying a copy.
"""
from __future__ import annotations

import array
import os
import sys
import wave
from pathlib import Path


def ensure_utf8_mode() -> None:
    """Re-exec under Python's UTF-8 mode unless we are already in it.

    g2pW opens its character dictionaries with no explicit encoding, so Python falls back
    to the locale's ANSI codepage. On any machine whose codepage is not UTF-8 — cp1256,
    cp1252, cp936, most of the non-en_US world — every Chinese key in POLYPHONIC_CHARS.txt
    decodes to mojibake, no lookup ever matches, and the phonemizer returns None for every
    character *without raising*. That is silence, not an error, which is exactly the kind
    of failure these scripts exist to catch.

    `open()`'s default encoding is fixed when the interpreter starts, so this cannot be
    repaired in-process; hence the re-exec.
    """
    if sys.flags.utf8_mode or os.environ.get("_POLYGLOT_UTF8"):
        return
    os.environ["_POLYGLOT_UTF8"] = "1"  # belt and braces against a re-exec loop
    os.environ["PYTHONUTF8"] = "1"
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    os.execv(sys.executable, [sys.executable, "-X", "utf8", *sys.argv])


def read_wav(path: Path) -> tuple[wave._wave_params, array.array]:
    with wave.open(str(path), "rb") as source:
        params = source.getparams()
        samples = array.array("h")
        samples.frombytes(source.readframes(source.getnframes()))
    return params, samples


def write_wav(path: Path, params, samples: array.array) -> None:
    with wave.open(str(path), "wb") as target:
        target.setparams(params)
        target.writeframes(samples.tobytes())


def measure(path: Path) -> tuple[int, int]:
    """Peak and RMS of a 16-bit mono wav, as raw sample values."""
    _, samples = read_wav(path)
    if not samples:
        return 0, 0
    peak = max(abs(value) for value in samples)
    rms = int((sum(value * value for value in samples) / len(samples)) ** 0.5)
    return peak, rms


def normalize(path: Path, target: float = 0.89) -> None:
    """Scale a file to a common peak.

    The engines disagree about output gain by an order of magnitude — Piper returns
    full-scale audio, MeloTTS returns something far quieter — and they render isolated
    words far quieter than sentences. Loudness would otherwise dominate both the listening
    comparison and the finished pack. Measured levels are reported separately rather than
    thrown away, because the gain difference is itself a finding.
    """
    params, samples = read_wav(path)
    peak = max((abs(value) for value in samples), default=0)
    if peak == 0:
        return

    gain = (target * 32767) / peak
    if abs(gain - 1.0) < 0.01:
        return
    for index, value in enumerate(samples):
        samples[index] = max(-32768, min(32767, int(value * gain)))
    write_wav(path, params, samples)


def trim_silence(path: Path, threshold: int = 300, keep_ms: int = 40) -> None:
    """Trim leading and trailing near-silence, keeping a short tail.

    Terminal punctuation buys better prosody but also a pause the listener does not need,
    and every millisecond is bytes in a 17k-file pack. `keep_ms` leaves the release of the
    final syllable intact instead of clipping it.
    """
    params, samples = read_wav(path)
    if not samples:
        return

    rate = params.framerate
    keep = int(rate * keep_ms / 1000)

    first, last = 0, len(samples) - 1
    while first < len(samples) and abs(samples[first]) < threshold:
        first += 1
    while last > first and abs(samples[last]) < threshold:
        last -= 1
    if first >= last:
        return

    start = max(0, first - keep)
    end = min(len(samples), last + keep)
    write_wav(path, params, samples[start:end])


def duration(path: Path) -> float:
    with wave.open(str(path), "rb") as source:
        return source.getnframes() / source.getframerate()


def f0_range(path: Path, min_hz: int = 70, max_hz: int = 400) -> int:
    """How far the pitch moves across a clip, in Hz — a proxy for "is there a tone here".

    Mandarin tone *is* pitch movement, so this turns "sounds wrong" into a number. In this
    voice a syllable inside a sentence swings 130-170 Hz; the same character rendered alone
    manages 20-40 Hz, which is why isolated characters sound toneless.

    Autocorrelation on a decimated signal. Validated against a synthetic 150→250 Hz glide,
    where it reports 88 Hz for a true 100 Hz — it reads roughly 10% low, so compare figures
    with each other rather than treating them as absolute. Ears decide; this only says
    where to point them.
    """
    with wave.open(str(path), "rb") as source:
        rate = source.getframerate()
        samples = array.array("h")
        samples.frombytes(source.readframes(source.getnframes()))

    step = 3  # decimate; autocorrelation in pure Python is O(n²) per frame
    rate //= step
    samples = samples[::step]

    window = int(rate * 0.04)
    hop = int(rate * 0.01)
    lo, hi = int(rate / max_hz), int(rate / min_hz)
    if window <= hi or hop < 1:
        return 0

    tracked = []
    for start in range(0, max(1, len(samples) - window), hop):
        frame = samples[start:start + window]
        energy = sum(v * v for v in frame) / len(frame)
        if energy < 2_000_000:
            continue
        r0 = sum(v * v for v in frame)
        best, best_lag = 0.0, 0
        for lag in range(lo, min(hi, len(frame) - 1)):
            r = sum(frame[i] * frame[i + lag] for i in range(len(frame) - lag))
            if (norm := r / (r0 + 1e-9)) > best:
                best, best_lag = norm, lag
        if best_lag and best > 0.35:
            tracked.append(rate / best_lag)

    return int(max(tracked) - min(tracked)) if len(tracked) > 3 else 0
