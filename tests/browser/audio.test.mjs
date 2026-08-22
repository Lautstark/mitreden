/* What the recording chain promises, checked without a browser.
 *
 * This is the safety-critical part of mitreden. If two sentences come out at
 * different levels, a child's talker says one of them too quietly to hear and
 * the next one loudly enough to startle — which is the failure the whole
 * program exists to prevent, and it is silent: both files play.
 *
 * So these are checks on the promise, not on the arithmetic. They say what a
 * finished recording must be true of, and they would still be the right checks
 * if the inside were rewritten.
 *
 *     node tests/browser/audio.test.mjs
 *
 * Run by tests/test_browser_audio.py, so `python3 tests/run.py` includes them.
 *
 * The chain moved to Lautstark/stimmquelle, which vorlaut runs too, and it has
 * checks of its own. These stayed, pointed at the vendored copy: a package's
 * tests say it was right when it was published, and these say the file in
 * docs/vendor/ is right now, at the commit tools/vendor.lock.json pins. A bad
 * pin, a bad refresh, or a bundle that was never rebuilt passes the first and
 * fails the second.
 */

import {
  MEASURE_RATE, TARGET_LUFS, TARGET_PEAK_DBTP as TARGET_PEAK_DB,
  trim, integratedLufs, postprocess, toPcm16, encodeWav,
} from '../../docs/vendor/stimmquelle.js';

/* The package takes a WAV and gives one back; audio.js took samples and gave
 * samples. Everything below was written against the second shape and none of it
 * is worth rewriting, so the difference is one wrapper — which also means these
 * checks now cover the decoder and the resampler, because the round trip goes
 * through both. audio.js could not be checked that far: it left those two
 * behind an AudioContext. */
const level = (x, rate = MEASURE_RATE) => postprocess(encodeWav(x, rate), { rate });

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
  if (!ok) failures.push(name);
};

/* A sentence-shaped noise: a band-limited tone that starts and stops, with
 * silence either side, at a chosen loudness. Speech is not a sine, but what
 * is being checked is level and length, and for those a steady signal is a
 * harder test than speech — there is nowhere for an error to hide. */
function utterance({ seconds = 1.2, lead = 0.4, tail = 0.4, amp = 0.05, rate = MEASURE_RATE } = {}) {
  const n = Math.round((lead + seconds + tail) * rate);
  const x = new Float32Array(n);
  const from = Math.round(lead * rate), to = Math.round((lead + seconds) * rate);
  for (let i = from; i < to; i++) {
    const t = (i - from) / rate;
    // two partials and a slow envelope, so the loudness gate has blocks that
    // differ from each other the way speech does
    x[i] = amp * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 440 * t))
             * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t));
  }
  return x;
}

const peakOf = x => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const dbfs = v => 20 * Math.log10(v);

/* --- is the ruler itself right? ---------------------------------------- */

/*
 * Everything below measures the output with integratedLufs — the same function
 * that decided the gain in the first place. That is circular: a wrong
 * implementation would satisfy every one of those checks.
 *
 * These three break the circle. The expected values were produced by ffmpeg's
 * ebur128 filter, reading WAV files this module itself wrote, while mitreden
 * still had a Python half with real ffmpeg to be checked against. They are
 * therefore an outside opinion, frozen. 440 Hz is in the list on purpose:
 * K-weighting is deliberately not flat there, so a tone off 1 kHz catches a
 * filter that is merely plausible.
 *
 * If these drift, the fault is in this module, not in the test. Do not
 * re-derive the numbers from this code.
 */
function theMeasurementAgreesWithAnOutsideOpinion() {
  const tone = (freq, amp, seconds = 5, rate = MEASURE_RATE) => {
    const x = new Float32Array(rate * seconds);
    for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin(2 * Math.PI * freq * i / rate);
    return x;
  };
  for (const [freq, amp, expected] of [[1000, 0.1, -23.0], [1000, 0.5, -9.0], [440, 0.2, -17.7]]) {
    const got = integratedLufs(tone(freq, amp));
    check(`${freq} Hz at amplitude ${amp} measures ${expected} LUFS, as ffmpeg reads it`,
          Math.abs(got - expected) < 0.1, `got ${got.toFixed(2)}`);
  }
}

/* --- the promise ------------------------------------------------------- */

function levelsLandOnTarget() {
  // The same sentence recorded at wildly different input levels has to come
  // out at the same level. This is the whole contract.
  const results = [];
  for (const amp of [0.002, 0.02, 0.2]) {
    const { samples, lufs } = level(utterance({ amp }));
    const out = integratedLufs(samples);
    results.push({ amp, inLufs: lufs, outLufs: out });
    check(`input at amplitude ${amp} lands on ${TARGET_LUFS} LUFS`,
          Math.abs(out - TARGET_LUFS) < 0.5,
          `in ${lufs.toFixed(1)} → out ${out.toFixed(2)}`);
  }
  const spread = Math.max(...results.map(r => r.outLufs)) - Math.min(...results.map(r => r.outLufs));
  check('three different inputs end up within 0.5 LU of each other',
        spread < 0.5, `spread ${spread.toFixed(2)} LU`);
}

function neverBreachesTheCeiling() {
  // A quiet sentence with one loud consonant. The gain that would reach the
  // target would also clip it, so the gain must give way, not the signal.
  const x = utterance({ amp: 0.01 });
  x[Math.round(0.8 * MEASURE_RATE)] = 0.98;               // the consonant
  const { samples, clamped } = level(x);
  const peak = dbfs(peakOf(samples));
  check('a loud peak is not clipped', peakOf(samples) <= 1.0);
  check('and the true peak stays under the ceiling',
        peak <= TARGET_PEAK_DB + 0.01, `${peak.toFixed(2)} dBFS`);
  check('the gain gave way rather than the signal', clamped === true);

  // Nothing anywhere may come out above the ceiling.
  for (const amp of [0.002, 0.05, 0.4, 0.9]) {
    const p = dbfs(peakOf(level(utterance({ amp })).samples));
    check(`amplitude ${amp} respects the ceiling`, p <= TARGET_PEAK_DB + 0.01,
          `${p.toFixed(2)} dBFS`);
  }
}

function silenceIsTrimmedButNotTheWord() {
  const rate = MEASURE_RATE;
  const x = utterance({ seconds: 1.0, lead: 0.5, tail: 0.5, amp: 0.1, rate });
  const cut = trim(x, rate);
  const removed = (x.length - cut.length) / rate;
  check('most of the silence goes', removed > 0.7, `${removed.toFixed(2)} s removed`);
  // 50 ms is kept either side on purpose: a word that starts on sample zero
  // sounds clipped.
  check('but a little is kept, so the word does not start abruptly',
        cut.length / rate > 1.0 + 0.08, `${(cut.length / rate).toFixed(3)} s left`);

  const silent = new Float32Array(rate);
  check('a silent recording is left alone rather than emptied',
        trim(silent, rate).length === silent.length);
}

function degenerateInputDoesNotThrow() {
  const rate = MEASURE_RATE;
  for (const [name, x] of [
    ['silence', new Float32Array(rate)],
    ['a single sample', new Float32Array([0.5])],
    ['nothing at all', new Float32Array(0)],
  ]) {
    try {
      const { samples } = level(x);
      check(`${name} produces a result rather than an exception`, samples instanceof Float32Array);
    } catch (e) {
      check(`${name} produces a result rather than an exception`, false, String(e.message || e));
    }
  }
}

function wavIsAWav() {
  // Bytes rather than a Blob: the package has no browser in it, which is the
  // property that lets this file run under node at all.
  const { samples } = level(utterance({ amp: 0.05 }));
  const bytes = encodeWav(samples, 44100);
  return Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).then(buf => {
    const dv = new DataView(buf), txt = o => String.fromCharCode(
      dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
    check('the wav says RIFF/WAVE', txt(0) === 'RIFF' && txt(8) === 'WAVE');
    check('mono', dv.getUint16(22, true) === 1);
    check('16 bit', dv.getUint16(34, true) === 16);
    check('at the rate it was asked for', dv.getUint32(24, true) === 44100);
    check('the declared length matches the bytes present',
          dv.getUint32(40, true) === buf.byteLength - 44);
  });
}

function pcmClampsRatherThanWraps() {
  // Out-of-range input must saturate. Wrapping turns a loud sample into a
  // loud sample of the opposite sign, which is an audible click.
  const pcm = toPcm16(new Float32Array([1.5, -1.5, 0, 1, -1]));
  check('samples above 1.0 saturate instead of wrapping', pcm[0] === 32767, String(pcm[0]));
  check('samples below -1.0 saturate too', pcm[1] === -32768, String(pcm[1]));
  check('silence stays silent', pcm[2] === 0);
}

theMeasurementAgreesWithAnOutsideOpinion();
levelsLandOnTarget();
neverBreachesTheCeiling();
silenceIsTrimmedButNotTheWord();
degenerateInputDoesNotThrow();
pcmClampsRatherThanWraps();
await wavIsAWav();

if (failures.length) {
  console.log(`\n  ${failures.length} problem(s): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\n  All good.');
