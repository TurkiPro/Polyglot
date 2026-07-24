"""Carrier-phrase rendering for single-character words (Phase 8 §1 follow-up).

A lone character is three phonemes with no run-up, and this sentence-trained voice lays
almost no tone over it: measured, it moves 130-170 Hz of pitch inside a sentence and only
20-40 Hz for the same character alone, so 好 / 号 / 巧 come out flat and clipped.

The fix is to give the syllable the context the model needs and then take it back: render
it at the end of a short carrier phrase, where it gets a real tone, and cut it back out at
exact phoneme boundaries. The carrier ends *high* on purpose — its final syllable
coarticulates into the target, and a low-ending carrier (是, tone 4) flattens a following
third tone, while a high-ending one (说, tone 1) lets it move.

Multi-syllable words already carry their own tone context and are rendered as-is; only
single characters go through here.
"""
from __future__ import annotations

from pathlib import Path

# 请说 <target> 。 — "please say <target>." The target lands sentence-final, after 说
# (shuō, high level), which measured best of the carriers tried.
CARRIER = "请说{}。"

# Non-syllable tokens the phonemizer emits — never part of the target syllable.
PUNCT = frozenset("。，？！.,?! —…、：；:;")


def phoneme_spans(phonemes, phoneme_id_samples) -> list[tuple[str, int, int]]:
    """Per-phoneme (name, start_sample, end_sample), computed by hand.

    Piper's own alignment assumes a PAD after every phoneme; the Chinese phonemizer only
    pads after tones and punctuation, so its reconciliation always fails for zh. The raw
    per-id sample counts are correct, though, and phonemes_to_ids' padding rule is known,
    so the mapping is rebuildable: BOS, then each phoneme's id (plus a trailing PAD id when
    it is group-end), then EOS. Each phoneme keeps its trailing PAD — the syllable release.
    """
    from piper.phonemize_chinese import GROUP_END_PHONEMES

    spans, idx, cum = [], 1, int(phoneme_id_samples[0])  # step past BOS
    for phoneme in phonemes:
        start = cum
        cum += int(phoneme_id_samples[idx])
        idx += 1
        if phoneme in GROUP_END_PHONEMES:
            cum += int(phoneme_id_samples[idx])
            idx += 1
        spans.append((phoneme, start, cum))
    return spans


def crop_target(voice, config, char: str, carrier: str = CARRIER):
    """Render `char` inside `carrier` and return just the target syllable as PCM bytes.

    Returns `(pcm_bytes, sample_rate)`, or `(None, rate)` if alignment is unavailable so
    the caller can fall back to a bare render. The voice must be loaded with
    `include_alignments=True`.
    """
    import numpy as np

    chunk = next(iter(voice.synthesize(carrier.format(char), syn_config=config,
                                       include_alignments=True)))
    rate = chunk.sample_rate
    if chunk.phoneme_id_samples is None:
        return None, rate

    spans = phoneme_spans(chunk.phonemes, chunk.phoneme_id_samples)
    speech = [span for span in spans if span[0] not in PUNCT]
    n = len(voice.phonemize(char)[0])  # phonemes in the bare character
    if len(speech) < n:
        return None, rate

    target = speech[-n:]
    pad = int(rate * 0.015)
    begin = max(0, target[0][1] - pad)
    end = min(len(chunk.audio_float_array), target[-1][2] + pad)
    pcm = np.clip(chunk.audio_float_array[begin:end], -1, 1)
    return (pcm * 32767).astype("<i2").tobytes(), rate


def write_wav(path: Path, pcm: bytes, rate: int) -> None:
    import wave

    with wave.open(str(path), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(rate)
        target.writeframes(pcm)


def use_sync_phonemizer(voice) -> None:
    """Run g2pW's DataLoader in-process, which is ~36× faster here.

    g2pW phonemizes through a torch DataLoader whose default two workers are spawned fresh
    on every call. On Windows that is process-spawn overhead — ~4.5 s per item against
    0.13 s of actual work, which is the difference between a 25-hour build and a 40-minute
    one. num_workers=0 runs it synchronously; the phoneme output is identical, so hashes
    are unaffected. The phonemizer is created lazily, so call this after one phonemize.
    """
    phonemizer = getattr(voice, "_chinese_phonemizer", None)
    if phonemizer is not None and hasattr(phonemizer, "g2p"):
        phonemizer.g2p.num_workers = 0
