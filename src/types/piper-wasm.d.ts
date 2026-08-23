/* The phonemizer's Emscripten glue, an npm package that ships no types.
 *
 * The deep path rather than the bare name: the package declares
 * `main: "/build/piper_phonemize.js"` — absolute, from 2023 — and has no
 * exports map to do better, so the bare specifier resolves nowhere. The file
 * itself is what a consumer of this package really imports.
 *
 * Declared as unknown rather than described. Writing a shape here would be a
 * second description of somebody else's module with nothing checking it; the
 * one caller casts it to stimmquelle's `PhonemizerFactory`, which is the
 * published description of what the factory has to be. It arrives on
 * `default` because the file is UMD and Rollup's CJS interop puts
 * `module.exports` there.
 */
declare module '@diffusionstudio/piper-wasm/build/piper_phonemize.js' {
  const createPiperPhonemize: unknown;
  export default createPiperPhonemize;
}
