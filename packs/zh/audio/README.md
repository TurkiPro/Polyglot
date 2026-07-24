# Audio pack — build-time generation

Everything in this directory runs **at build time on a trusted machine**, never at
runtime and never in the browser. Python is approved for this directory only, on the same
precedent as `packs/zh/lib/bunzip2.js`: a build-time tool over trusted input.

## Licensing — verified before any generation

An AGPL app has to be redistributable *and* commercially usable, so the engine, the voice
model **and the dataset the voice was trained on** all have to permit it. The dataset is
where this nearly went wrong.

| candidate | engine | voice | dataset | verdict |
|---|---|---|---|---|
| **MeloTTS** | MIT | `myshell-ai/MeloTTS-Chinese`, MIT | — | **usable** |
| **Piper** `zh_CN-chaowen` | MIT | MIT | [OHF-Voice](https://github.com/OHF-Voice/voice-datasets), **CC0** | **usable** |
| Piper `zh_CN-huayan` | MIT | MIT | [HuaYan_TTS](https://github.com/PlayVoice/HuaYan_TTS), **Unknown** | rejected |
| Piper `zh_CN-xiao_ya` | MIT | MIT | BZNSYP, **non-commercial** | rejected |

`huayan` is Piper's best-known Chinese voice and the one most guides reach for. Its model
card states the training dataset licence as "Unknown", which is not a grant — so the
bake-off uses **chaowen** instead. `xiao_ya` is explicitly non-commercial, which AGPL
cannot accept.

Commercial cloud voices and Edge's online voices are rejected outright per Phase 8 §1.

## The bake-off

```sh
python packs/zh/audio/bakeoff.py                  # every engine that is installed
python packs/zh/audio/bakeoff.py --engine piper   # just one; the others keep last run's audio
```

Renders the same 20 words and 5 sentences with each engine into `samples/<engine>/`, plus
`samples/index.html` — open it, listen with headphones, and judge **tone accuracy**: 好
hǎo vs 号 hào vs 巧 qiǎo should be unmistakably different contours, and the third tone
should dip rather than merely fall.

Three columns, because there are two questions:

| column | what it is |
|---|---|
| `piper` | chaowen at its default settings |
| `piper-fixed` | the same voice with synthesis noise off — **bit-reproducible** |
| `melotts` | MeloTTS `ZH` |

Prefer **`piper-fixed`** unless it sounds audibly worse than `piper`. Both engines are
otherwise random: identical text renders different bytes on every run, and because each
file is named after its content hash, re-running the generator after a deck update would
rename all ~17k files, orphan the uploaded pack and force every client to re-download.
Disabling the noise costs a little prosodic variation and buys reproducible rebuilds.

Samples are **peak-levelled** before you hear them, so loudness cannot decide the vote —
the engines disagree about output gain by roughly 10×. Anything that arrived near-silent
is flagged in red under its player; that is a defect, not a volume preference.

Then set the winner in `config/app.config.js` as `audio.engine`.

### Installing the engines

Neither is a project dependency — they are tools you install on the build machine.
**Both need torch**; "Piper is the light one" stops being true as soon as the language is
Chinese, because its Mandarin path phonemizes through G2PW.

```sh
# Piper — torch, g2pw, and a 159 MB G2PW model downloaded on first use.
# onnx is for the single-character carrier crop (see Generation); without it those
# words fall back to a bare, toneless render rather than failing.
pip install piper-tts g2pw torch requests unicode_rbnf sentence_stream onnx
python -m piper.download_voices zh_CN-chaowen-medium   # then move the .onnx into models/

# MeloTTS (heavier: torch, ~2 GB)
pip install git+https://github.com/myshell-ai/MeloTTS.git
pip install "setuptools<81"     # see below
python -m unidic download
```

`ffmpeg` must also be on `PATH` — `generate.py` encodes Opus with it. The bake-off writes
plain `.wav` and does not need it.

### Known traps

Each of these was hit on a real machine, and each fails *quietly*.

- **Locale.** g2pW opens its character dictionaries with no explicit encoding, so Python
  uses the system codepage. On any non-UTF-8 locale — cp1256, cp1252, cp936, most of the
  world outside en_US — every Chinese key decodes to mojibake, nothing matches, and the
  phonemizer returns `None` for *every character without raising*, rendering silence.
  Both scripts now re-exec themselves under `-X utf8`, so this is handled; it is recorded
  because the symptom (silent output, no error) points nowhere near the cause.
- **`pkg_resources`.** MeloTTS pins `librosa==0.9.1`, which imports `pkg_resources`;
  setuptools ≥ 81 removed it. A current venv fails with `ModuleNotFoundError:
  pkg_resources` while `pip list` cheerfully shows `melotts`. Hence `setuptools<81`.
- **`transformers` v5.** g2pw 0.1.1 does `from transformers import BertTokenizer`, which
  in v5 is a fast-tokenizer wrapper requiring `tokenizers>=0.22`. A stale `tokenizers`
  makes `import transformers` fail outright. Either keep transformers 4.x (MeloTTS's own
  pin, 4.27) or upgrade `tokenizers` to match.
- **Working directory.** G2PW's model is looked up in `<cwd>/g2pW` by default, so running
  from anywhere but the repo root silently re-downloaded 159 MB. Both scripts now pass an
  explicit path.

## Generation and upload

Once an engine is chosen:

```sh
python packs/zh/audio/generate.py     # renders every deck word + intro sentence
node packs/zh/audio/upload.mjs        # uploads to R2, idempotent by hash
```

`audio-manifest.json` **is** committed; the `.ogg` files are **not** — that is the one
sanctioned exception to committed build artifacts (Phase 8 §2), because the pack runs to
hundreds of megabytes.

Regeneration reproduces the same hashes **only under `piper-fixed`**. Under `piper` or
`melotts` every re-run renames every file, so treat a regeneration as a full re-upload and
expect the previous objects to be orphaned in the bucket.

Every clip is peak-levelled during generation. Engines render isolated words far quieter
than sentences — MeloTTS put single characters 5–50× below its own sentence level — and a
word that plays at a tenth of the volume of its example sentence reads as broken.

### Single characters get a carrier phrase

A lone character is three phonemes with no run-up, and a sentence-trained voice lays almost
no tone over it: this voice swings 130–170 Hz of pitch inside a sentence and only 20–40 Hz
for the same character alone, so 好 / 号 / 巧 come out flat and clipped. See `carrier.py`.

The fix, applied automatically to every single-character word (nothing longer, since
multi-syllable words already carry their own tone context): render the character at the end
of the carrier `请说{}。` — where it gets a real tone — then cut the target syllable back out
at exact phoneme boundaries. Two details earned their place:

- The carrier ends **high** (说, tone 1) on purpose. Its final syllable coarticulates into
  the target, and a low-ending carrier (是, tone 4) flattens a following third tone while a
  high-ending one lets it move. Measured, `请说` beat `这是` on every tone.
- The crop uses phoneme→sample **alignment**, not energy gaps. Chinese syllables run
  together with no silence between them, so an energy-based cut keeps whole neighbours.
  Piper's own Chinese alignment is broken (it assumes a PAD after every phoneme; the zh
  phonemizer only pads after tones and punctuation), so `carrier.py` rebuilds the mapping
  from the raw per-id sample counts, which are correct.

`isolated.py` renders bare vs. both carriers side by side into `samples/isolated/` for
listening — that is how the carrier was chosen.
