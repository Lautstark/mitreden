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
  asBlob, encodeMp3, encodeWav, resample, speak, usePiper,
  type Progress, type Spoken,
} from '@lautstark/stimmquelle/browser';
import { OUT } from './settings.ts';
import type { Format } from './types.ts';

/**
 * Where vits-web comes from. Bundled by Vite rather than vendored by hand, and
 * behind a dynamic import so opening the page does not cost a megabyte of
 * decoder nobody has asked to use yet.
 */
usePiper(() => import('@diffusionstudio/vits-web') as never);

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
