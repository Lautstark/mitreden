# Spike: does mitreden run in a tab?

A throwaway page that asks one question — can the whole chain, text in and a
finished audio file out, happen in a browser with nothing behind it? Open
`index.html`, type a sentence, get an MP3.

```
python3 docs/spike/serve.py 8771     # then open http://localhost:8771/spike/
```

Nothing here is wired into mitreden. It exists to answer questions before
anyone commits to a static site, and it answered them.

## What it does

| step | in the container | here |
|---|---|---|
| speak | piper, a binary | `@diffusionstudio/vits-web` — piper compiled to WASM, models from Hugging Face, cached in the browser's origin private file system |
| trim, level, encode | ffmpeg | two paths, side by side: hand-written JS, or `ffmpeg.wasm` running the exact filter string from `mitreden.py:96` |
| store | `out/` and `phrases.json` | neither — download only. Deliberate: this spike is about the pipeline, not about storage |

"Compare both" runs one recording through both paths and measures each result
with ffmpeg's own `loudnorm` in measurement mode.

## What it found

**Piper works.** German and English, offline after the first download.
`de_DE-thorsten-medium` is about 63 MB and lands in OPFS; after that a sentence
takes 4–7 s on an M-series Mac, most of it session setup rather than inference.
`de_DE-kerstin-low` — mitreden's current default — **does not work**: its
phoneme table is older and smaller than the one vits-web's phonemizer produces,
so inference dies with `idx=140 must be within the inclusive range [-130,129]`.
Any voice picker on a static site has to be a tested list, not the piper
catalogue.

**ffmpeg.wasm cannot be used for the levelling.** This is the finding that
matters, and it reverses the obvious plan.

The newest `@ffmpeg/core` (0.12.10) is built from **ffmpeg 5.1.4**. On short
sentences its `loudnorm` computes a `target_offset` that the current ffmpeg
does not. Same input file, same measured loudness, same `normalization_type:
linear` — and a gain that differs by more than 13 dB:

```
short.wav   ffmpeg 9.0.1   i=-23.60 lra=0.00 tp=-7.89 linear  offset= 1.21
short.wav   ffmpeg 5.1.4   i=-23.60 lra=0.00 tp=-7.89 linear  offset=14.75
```

Twelve sentences through `de_DE-thorsten-medium`, the container's filter chain,
measured as integrated loudness of the finished MP3 (target −16 LUFS):

```
id     container       wasm          JS      JS-container
00       -16.25     -16.25      -16.30         -0.05
01       -16.95     -30.85      -16.95         +0.00
02       -16.28     -16.28      -16.09         +0.19
03       -16.23     -16.23      -16.35         -0.12
04       -17.91     -31.47      -18.27         -0.36
05       -16.27     -16.27      -16.35         -0.08
06       -18.52     -32.08      -18.33         +0.19
07       -16.28     -16.28      -16.68         -0.40
08       -16.27     -16.27      -16.22         +0.05
09       -17.45     -31.02      -17.68         -0.23
10       -16.55     -30.55      -16.04         +0.51
11       -18.23     -31.91      -17.95         +0.28
```

Six of twelve, about 13.6 dB too quiet. Not a rounding difference — that is one
sentence barely audible and the next one shouting, on the same talker, which is
the exact failure mitreden exists to prevent. It is also silent: the file plays,
it is just wrong.

**The hand-written path is fine.** Silence trim, BS.1770 integrated loudness,
one gain, a peak clamp at −1.5 dBTP, `lamejs` for the MP3. It tracks the
container within ±0.51 LU on all twelve, including every sentence the wasm build
gets wrong, and no output exceeds the peak ceiling. About 250 KB of library
against roughly 10 MB for the ffmpeg core.

So the argument for ffmpeg.wasm — one implementation, no drift — does not
survive: it is a *second* implementation, three years stale, and it drifts by
13 dB.

## Reproducing the numbers

`serve.py` accepts `PUT` and writes into `dump/` (gitignored), so the page can
hand files to a shell where the real ffmpeg can look at them. `window.spike`
exposes `synth`, `postJS`, `postFFmpeg` and `measure`, so a batch is a few
lines in the console:

```js
for (let i = 0; i < 12; i++) {
  const id = String(i).padStart(2, '0');
  const wav = await (await fetch(`/spike/dump/batch-${id}.wav`)).blob();
  await fetch(`/spike/js-${id}.mp3`, { method: 'PUT', body: await spike.postJS(wav) });
}
```

## What it did not test

- **iOS Safari.** Everything above is desktop Chromium. A 63 MB model in
  onnxruntime-web on an iPad is the next unknown, and tablets are where this
  would actually be used.
- **Storage.** No `phrases.json`, no rebuild-on-voice-change, no ids that stay
  stable when a text is corrected. All of that is real work and none of it is
  here.
- **Anything but piper.** Azure and ElevenLabs allow browser requests and would
  be simpler here than on the server, but were not tried.
