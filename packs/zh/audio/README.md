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
python packs/zh/audio/bakeoff.py            # both engines, if installed
python packs/zh/audio/bakeoff.py --engine piper
```

Renders the same 20 words and 5 sentences with each engine into `samples/<engine>/`, plus
`samples/index.html` — open it, listen with headphones, and judge **tone accuracy**: 好
hǎo vs 号 hào vs 巧 qiǎo should be unmistakably different contours, and the third tone
should dip rather than merely fall.

Then set the winner in `config/app.config.js` as `audio.engine`.

### Installing the engines

Neither is a project dependency — they are tools you install on the build machine.

```sh
# Piper (lighter, ~100 MB with the voice)
pip install piper-tts
python -m piper.download_voices zh_CN-chaowen-medium

# MeloTTS (heavier: torch, ~2 GB)
pip install git+https://github.com/myshell-ai/MeloTTS.git
python -m unidic download
```

## Generation and upload

Once an engine is chosen:

```sh
python packs/zh/audio/generate.py     # renders every deck word + intro sentence
node packs/zh/audio/upload.mjs        # uploads to R2, idempotent by hash
```

`audio-manifest.json` **is** committed; the `.ogg` files are **not** — that is the one
sanctioned exception to committed build artifacts (Phase 8 §2), because the pack runs to
hundreds of megabytes. Regeneration is deterministic for a pinned engine version.
