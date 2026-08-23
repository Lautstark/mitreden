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
  type OnnxModule, type PhonemizerFactory, type Progress, type Spoken,
} from '@lautstark/stimmquelle/browser';
import { OUT } from './settings.ts';
import type { Format } from './types.ts';

/**
 * One thread, said rather than discovered.
 *
 * onnxruntime picks a thread count off `hardwareConcurrency` and then warns
 * that threads need a cross-origin-isolated page — which GitHub Pages sends
 * none of the headers for. It falls back on its own, so this changes no
 * behaviour; what it changes is that the fallback is the arrangement rather
 * than a recovery, and that a first recording stops writing a warning nobody
 * can act on into a console this page otherwise keeps silent. It also matches
 * what vite.config.ts actually vendors: the two single-threaded binaries.
 *
 * Not in stimmquelle's `OnnxModule` because that describes only what the
 * package itself needs of the module. This is between mitreden and its own
 * dependency.
 */
const singleThreaded = (onnx: OnnxModule): OnnxModule => {
  (onnx.env.wasm as { numThreads?: number }).numThreads = 1;
  return onnx;
};
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
 * Three pieces, and each is here for its own reason:
 *  - the phonemizer by its deep path, because `@diffusionstudio/piper-wasm`
 *    declares a `main` that opens with a slash and resolves nowhere. The file
 *    is Emscripten's UMD: its exports exist for a bundler and there is no
 *    global fallback, so a browser handed the CDN URL gets an empty module and
 *    the factory has to arrive through CJS interop, on `.default`.
 *  - onnxruntime from node_modules rather than from a CDN, which is the whole
 *    of what this page promises about itself: e2e/offline.spec.ts fails the
 *    build if the bundle so much as names a package CDN. `/wasm` is the
 *    single-backend entry — the one whose binaries are the two we serve.
 *  - `wasmBase` is one directory answering for the phonemizer's wasm and its
 *    espeak data and for onnxruntime's binaries together. vite.config.ts is
 *    what fills it, in dev out of node_modules and in a build into dist/wasm/.
 *
 * Both imports are dynamic, so opening the page still costs nothing until
 * somebody records.
 */
usePiperRuntime({
  phonemizer: async () => ({
    createPiperPhonemize: (await import('@diffusionstudio/piper-wasm/build/piper_phonemize.js'))
      .default as PhonemizerFactory,
  }),
  onnx: async () => singleThreaded(await import('onnxruntime-web/wasm') as unknown as OnnxModule),
  // BASE_URL is "/" in dev and "/mitreden/" on Pages; the four files sit under
  // it either way.
  wasmBase: `${import.meta.env.BASE_URL}wasm/`,
});

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
