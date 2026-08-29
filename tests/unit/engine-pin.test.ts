import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ENGINE } from '../../src/core/settings.ts';

/**
 * CONTRACT.md §3: *"The engine version must be pinned, and the pin tied to the
 * constant by a test."*
 *
 * The constant is written down rather than read from the installed package,
 * because §3 requires a recording's name to be derivable with no disk and no
 * network — a machine that cannot render a WAV still has to know what the file
 * would have been called. The cost of writing it down is drift, and §3 names it
 * in both directions: **pin bumped, constant left behind** means new audio
 * under old names; **constant bumped, pin left behind** means everything
 * re-rendered by the engine that already made it.
 *
 * So this reads the lockfile, which is what is actually installed and is
 * committed. A bump to either package now fails here until somebody has decided
 * what it means — and deciding is the point, because the answer is usually
 * "re-record the library", which is not something to do by accident.
 */
describe('the engine term names what is actually installed', () => {
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  const at = (name: string): string => lock.packages[`node_modules/${name}`].version;

  it('matches the lockfile, in both directions', () => {
    expect(ENGINE).toBe(
      `piper-wasm@${at('@diffusionstudio/piper-wasm')} `
      + `onnxruntime-web@${at('onnxruntime-web')}`);
  });

  it('names neither stimmquelle nor the pipeline', () => {
    // Both were in here until 2026-08-29 and both were wrong to be. stimmquelle
    // is the package that drives the engine, not the engine — so its releases
    // re-recorded the library for changes that made no sound. The pipeline
    // number is §3.5, and keyFor puts it into every name itself, on every
    // backend, which is the clause this program used to drop for cloud voices.
    expect(ENGINE).not.toMatch(/stimmquelle|pipeline/);
  });
});
