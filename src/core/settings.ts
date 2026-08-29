/** What the whole program agrees on: the output format, and which engine made
 *  a recording. */


/**
 * Fixed, because there is no file to edit and mp3 at 44.1 kHz mono is what
 * talkers, reading pens and phone apps expect.
 */
export const OUT = { format: 'mp3', sampleRate: 44100, channels: 1, bitrate: 192 } as const;

/**
 * What the Anybook Pro's own files are, and so what core/anybook.ts writes.
 *
 * Not a preference. Studio transcodes whatever it is handed down to 24 kHz
 * mono on import — the mp3s inside a project it saved are at this rate whatever
 * went in — so writing them here is not a conversion the pen needs, it is the
 * one conversion it was going to do anyway, done once and marked as done.
 * 48 kbps because that is what Studio's own transcode produced; the published
 * books sit at 24 and sound it.
 */
export const PEN = { format: 'mp3', sampleRate: 24000, channels: 1, bitrate: 48 } as const;

/**
 * Which engine made a recording — CONTRACT.md §3.4, which is about *the engine*
 * and not about the package that drives it.
 *
 * §3's own example is two implementations of one chain: "the container names
 * its engine `piper 1.7.0`; a browser names its own `vits-web@1.0.3`". The
 * container was mitreden's Python build, and it is gone — so what is left here
 * is the second half, and the honest answer is the pair that actually turns a
 * sentence into samples: piper-wasm phonemising and inferring, onnxruntime-web
 * running the model. Nothing else in this program can change what a voice
 * sounds like without one of these two moving.
 *
 * **It used to say `stimmquelle@<version>`, and that was a recurring bill.**
 * stimmquelle releases for documentation, for types, for a new export — 2.8.0
 * shipped a hashing function and changed no audio at all — and every one of
 * those re-recorded this library from scratch: minutes of inference, and money
 * for anyone on an Azure voice. It was defensible while the container existed,
 * because then "which build of the family made this" really did distinguish two
 * renderers. With one renderer left it distinguished nothing and charged for it.
 *
 * The pipeline number is not here any more either, and has not been lost:
 * `keyFor` puts §3.5 into every name itself, on every backend — which is the
 * clause this file used to drop for cloud voices.
 *
 * Written down rather than read from the installed package, because §3 requires
 * a name derivable with no disk and no network. That is exactly the drift §3
 * warns about — "pin bumped, constant left behind" — so
 * tests/unit/engine-pin.test.ts ties this string to the lockfile.
 */
export const ENGINE = 'piper-wasm@1.0.0 onnxruntime-web@1.18.0';
