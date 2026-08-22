/* Trimming, levelling and encoding.
 *
 * All of it from stimmquelle, vendored like everything else in vendor/. What
 * is here is the glue: which format comes out, and converting a finished file
 * for a device that wants the other one.
 *
 * One piece of mitreden's browser backend; app/backend.js assembles them.
 */

import { OUT } from './settings.js';

// ------------------------------------------------- trim, level and encode
//
// All of it from stimmquelle, vendored like everything else in vendor/.
// docs/audio.js is gone and the two AudioContexts around it with it.
//
// The package reaches further than audio.js did. audio.js held the arithmetic
// and left decoding and resampling behind an AudioContext because they seemed
// to need one; stimmquelle carries its own RIFF decoder and a windowed-sinc
// resampler, so the whole chain runs under node. That is not tidiness. A
// second implementation of a filter chain is only defensible because it can
// be measured against the real ffmpeg, and the AudioContext version could
// never have had its first and last steps inside that measurement.
//
// vorlaut runs the same file. Two products that both put a sentence on a
// child's talker cannot afford to disagree about how loud it comes out, and
// until now the only thing keeping them in step was that one person wrote
// both.
let dspp = null;
const dsp = () => (dspp ||= import('../vendor/stimmquelle.js'));

// One recording, start to finish: piper's raw wav in, the finished file out.
// The mp3 encoder is lamejs, and it is behind its own import inside the
// package — a quarter of a megabyte that only arrives when something actually
// asks for an mp3.
export async function process(wavBlob) {
  const { postprocess, encodeMp3 } = await dsp();
  const { samples, rate } = postprocess(new Uint8Array(await wavBlob.arrayBuffer()),
                                        { rate: OUT.sample_rate });
  return new Blob([await encodeMp3(samples, rate, OUT.bitrate)],
                  { type: 'audio/mpeg' });
}

// Decoding a finished file back to samples, for a download in another format.
// Same rule as before: the audio is not touched again beyond the format
// change — it was trimmed and levelled when it was made.
//
// The AudioContext that survives, and the only one left. What it decodes is
// an mp3; the package reads RIFF because that is what synthesisers emit.
// Decoding what this program itself chose to write is this program's problem,
// and it genuinely needs the browser for it.
export async function asFormat(blob, fmt) {
  if (fmt === OUT.format || !fmt) return blob;
  if (fmt !== 'wav') throw new Error(`This page can only write mp3 and wav, not ${fmt}.`);
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  await ctx.close();
  const { resample, encodeWav } = await dsp();
  const at = decoded.sampleRate === OUT.sample_rate
    ? decoded.getChannelData(0)
    : resample(decoded.getChannelData(0), decoded.sampleRate, OUT.sample_rate);
  return new Blob([encodeWav(at, OUT.sample_rate)], { type: 'audio/wav' });
}
