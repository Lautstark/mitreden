/* Trimming, levelling and encoding — the part of the recording chain that is
 * only arithmetic.
 *
 * It lives apart from backend-local.js for two reasons. It is the half that
 * can be checked without a browser, and everything in here is now covered by
 * tests/browser/audio.test.mjs, which runs in plain node. And it is the half a
 * sibling project would share: vorlaut needs the same trim and the same
 * loudness measurement, and a different encoder, so the seam belongs exactly
 * where the arithmetic stops.
 *
 * What this file must NOT grow: anything that needs an AudioContext. Decoding
 * and resampling stay with the caller, so this stays testable.
 *
 * The chain is the one the container runs with ffmpeg — see mitreden.py. It is
 * written out by hand rather than run through ffmpeg.wasm because the newest
 * build of that is ffmpeg 5.1.4, whose loudnorm gets short sentences wrong by
 * about 13.6 dB. The measurements are in docs/spike/README.md.
 */

export const TARGET_LUFS = -16;
export const TARGET_PEAK_DB = -1.5;
export const MEASURE_RATE = 48000;   // the coefficients below assume it

/** silenceremove at both ends: the first and last sample above the threshold,
 *  with a little of the quiet left either side so the word does not start
 *  abruptly. Returns a view, not a copy. */
export function trim(x, rate, thresholdDb = -50, padSec = 0.05) {
  const th = Math.pow(10, thresholdDb / 20), pad = Math.round(padSec * rate);
  let a = 0, b = x.length - 1;
  while (a < x.length && Math.abs(x[a]) < th) a++;
  while (b > a && Math.abs(x[b]) < th) b--;
  if (a >= b) return x;                      // all silence — leave it alone
  return x.subarray(Math.max(0, a - pad), Math.min(x.length, b + pad + 1));
}

export function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** ITU-R BS.1770-4 integrated loudness. The coefficients are the 48 kHz ones,
 *  so the signal has to be at MEASURE_RATE when this runs. */
export function integratedLufs(x) {
  let k = biquad(x, 1.53512485958697, -2.69169618940638, 1.19839281085285,
                    -1.69065929318241, 0.73248077421585);          // head shelf
  k = biquad(k, 1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621);  // RLB
  const block = 0.4 * MEASURE_RATE, step = 0.1 * MEASURE_RATE, z = [];
  for (let s = 0; s + block <= k.length; s += step) {
    let sum = 0;
    for (let i = s; i < s + block; i++) sum += k[i] * k[i];
    z.push(sum / block);
  }
  if (!z.length) return -Infinity;
  const L = v => -0.691 + 10 * Math.log10(v || 1e-12);
  const mean = a => a.reduce((p, c) => p + c, 0) / a.length;
  let g = z.filter(v => L(v) > -70);                    // absolute gate
  if (!g.length) return -Infinity;
  g = g.filter(v => L(v) > L(mean(g)) - 10);            // relative gate
  return g.length ? L(mean(g)) : -Infinity;
}

/**
 * Trim, then bring to TARGET_LUFS without ever passing TARGET_PEAK_DB.
 *
 * One gain for the whole sentence, not a compressor. A sentence is short and
 * a talker plays them one at a time, so what matters is that two of them sit
 * at the same level — not that one of them is levelled within itself.
 *
 * When the peak would breach the ceiling the gain is reduced rather than the
 * signal clipped, which means a sentence with a loud consonant lands quieter
 * than the target. That is the right way round: too quiet is a volume knob,
 * clipped is a broken recording.
 */
export function level(samples, rate = MEASURE_RATE) {
  const cut = trim(samples, rate);
  const lufs = integratedLufs(cut);
  let gain = Number.isFinite(lufs) ? Math.pow(10, (TARGET_LUFS - lufs) / 20) : 1;
  let peak = 0;
  for (let i = 0; i < cut.length; i++) peak = Math.max(peak, Math.abs(cut[i]));
  const ceiling = Math.pow(10, TARGET_PEAK_DB / 20);
  const clamped = peak * gain > ceiling;
  if (clamped) gain = ceiling / peak;
  const out = new Float32Array(cut.length);
  for (let i = 0; i < cut.length; i++) out[i] = cut[i] * gain;
  return { samples: out, lufs, gain, clamped };
}

export function toPcm16(samples) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return pcm;
}

/** A 44-byte header and the samples. No encoder, nothing to depend on. */
export function encodeWav(samples, rate) {
  const pcm = toPcm16(samples);
  const buf = new ArrayBuffer(44 + pcm.byteLength), dv = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + pcm.byteLength, true); str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buf, 44).set(new Uint8Array(pcm.buffer));
  return new Blob([buf], { type: 'audio/wav' });
}
