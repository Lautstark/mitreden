/**
 * One recording, start to finish.
 *
 * Almost nothing happens here any more: stimmquelle's `speak()` returns a WAV
 * already trimmed and levelled to the contract both halves of a talker agree
 * on, so the trim, the loudness measurement and the gain that used to live in
 * this repository are gone. What is left is the format the files are written
 * in, which is mitreden's decision rather than the package's.
 */

import {
  asBlob, encodeMp3, encodeWav, resample, speak, usePiperRuntime,
  type OnnxModule, type Progress, type Spoken,
} from '@lautstark/stimmquelle/browser';
import { piperRuntime } from '@lautstark/stimmquelle/runtime';
import { OUT, PEN } from './settings.ts';
import type { Format } from './types.ts';

/**
 * Where piper's pieces come from — mitreden drives it itself rather than
 * handing the whole job to vits-web's `predict()`.
 *
 * That is what makes `de_DE-kerstin-low` and `en_US-john-medium` speakable at
 * all, and they are the only licence-clear candidates for the two slots the
 * picker had nothing in: vits-web phonemises against one fixed symbol table, so
 * every `low` model gets ids its own table has never seen, and John is simply
 * absent from its hardcoded `PATH_MAP`. Owning the three steps — phonemise,
 * remap the ids onto the model's own table, infer — is the only place the remap
 * can go. A voice that already spoke comes out of this with identical phoneme
 * ids, so nothing re-renders and no fingerprint moves.
 *
 * `piperRuntime()` answers the two questions that had the same answer here as
 * anywhere: the phonemizer's deep import — `@diffusionstudio/piper-wasm`
 * declares a `main` that opens with a slash and resolves nowhere — and the
 * single thread, which used to be a `singleThreaded` wrapper in this file and
 * is now the package's default. Neither was ever a decision about mitreden.
 *
 * The three that are stay here:
 *  - `onnx` from node_modules rather than from a CDN, which is the whole of
 *    what this page promises about itself: e2e/offline.spec.ts fails the build
 *    if the bundle so much as names a package CDN. vorlaut passes a pinned CDN
 *    URL in this same slot and is right to, which is why the package asks
 *    rather than defaults. `/wasm` is the single-backend entry — the one whose
 *    binaries are the two `piperVendor()` copies.
 *  - `dir` is `wasm` rather than the package's `vendor`, because that is the
 *    directory this page has served them from since before there was a package
 *    to ask. It is the same string vite.config.ts hands `piperVendor()`; they
 *    are two ends of one URL.
 *  - `base`, which the package would rather default. Its default reads
 *    `import.meta.env.BASE_URL` through a local alias, and vite only
 *    substitutes that name where it is written out in full — so in a build the
 *    expression survives into the bundle, `import.meta.env` is undefined in a
 *    browser module, and the base silently falls back to `/`. That is right in
 *    dev and wrong on Pages, where it would send every one of the four files
 *    to `/wasm/` instead of `/mitreden/wasm/` and fail the first recording.
 *    Written here, vite replaces it at build time, which is the whole point of
 *    not having the repository name in the source. Worth pushing back into the
 *    package, and harmless there once it is.
 *
 * The import is dynamic, so opening the page still costs nothing until
 * somebody records.
 */
usePiperRuntime(piperRuntime({
  onnx: () => import('onnxruntime-web/wasm') as unknown as Promise<OnnxModule>,
  dir: 'wasm',
  base: import.meta.env.BASE_URL,
}));

let onProgress: ((percent: number) => void) | null = null;

/** Set while a batch is running, so the page can say how far the model got. */
export const setProgress = (fn: ((percent: number) => void) | null): void => {
  onProgress = fn;
};

export async function record(
  text: string,
  voiceId: string,
  azure?: { key: string; region: string },
): Promise<{ blob: Blob; spoken: Spoken }> {
  const spoken = await speak(text, voiceId, {
    azure,
    rate: OUT.sampleRate,
    // The same claim voices.ts lists with, and it has to be made twice: the
    // licence gate in speak() takes it from these options and deliberately
    // does not infer it from the usePiperRuntime() call above. Without it
    // Kerstin is refused at the door the picker just offered her through —
    // and nothing red points here, because every voice that spoke before
    // passes the gate unclaimed. It stays out of the fingerprint in ids.ts
    // for the reason the Azure key does: it says who may ask, not how a
    // sentence sounds.
    ownsInference: true,
    onProgress: (p: Progress) => onProgress?.(Math.round(p.share * 100)),
  });
  const mp3 = await encodeMp3(spoken.samples, spoken.rate, OUT.bitrate);
  return { blob: new Blob([mp3 as BlobPart], { type: 'audio/mpeg' }), spoken };
}

/** Playable without re-encoding, for the row's own audio element. */
export const wavBlob = (spoken: Spoken): Blob => asBlob(encodeWav(spoken.samples, spoken.rate));

/**
 * A finished file in another format. The audio is not touched again beyond the
 * format change — it was trimmed and levelled when it was made.
 */
export async function asFormat(blob: Blob, format: Format): Promise<Blob> {
  if (format === OUT.format) return blob;
  if (format !== 'wav') throw new Error(`This page can only write mp3 and wav, not ${format}.`);
  // The one AudioContext left. What it decodes is an mp3 this program wrote,
  // which is this program's problem and genuinely needs the browser for it.
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  await ctx.close();
  const samples = decoded.sampleRate === OUT.sampleRate
    ? decoded.getChannelData(0)
    : resample(decoded.getChannelData(0), decoded.sampleRate, OUT.sampleRate);
  return new Blob([encodeWav(samples, OUT.sampleRate) as BlobPart], { type: 'audio/wav' });
}

/**
 * The same recording at the rate the reading pen keeps its audio in.
 *
 * A decode and a re-encode, which is a loss — and the same loss Studio applies
 * on its own if this is skipped, so the choice is not whether it happens but
 * whether it happens somewhere the result can be seen. Doing it here also lets
 * the project claim `IsPipelineCompliant`, which is the difference between
 * Studio importing sixty files and Studio converting sixty files.
 */
export async function asPenMp3(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  await ctx.close();
  const samples = decoded.sampleRate === PEN.sampleRate
    ? decoded.getChannelData(0)
    : resample(decoded.getChannelData(0), decoded.sampleRate, PEN.sampleRate);
  const mp3 = await encodeMp3(samples, PEN.sampleRate, PEN.bitrate);
  return new Blob([mp3 as BlobPart], { type: 'audio/mpeg' });
}
