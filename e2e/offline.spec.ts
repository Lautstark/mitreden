import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

/*
 * mitreden speaks without asking anyone. That is the claim the privacy notice
 * makes - GitHub Pages serves the page, Hugging Face serves a voice model once,
 * and with your own key Azure hears your sentences; nothing else - and it is
 * true only because the phonemizer and onnxruntime are npm packages this build
 * bundles, running on four wasm files the vendoring in vite.config.ts puts
 * into dist/wasm/.
 *
 * It used to rest on a rewrite instead: vits-web hardcoded two CDNs and the
 * build edited them out. Driving piper ourselves removed the strings rather
 * than rewriting them, which is a stronger arrangement and not a weaker one -
 * but it does not remove the way this breaks from above, which the rewrite's
 * own build guard never covered either: a new dependency, or an import
 * somebody added, that fetches from a host of its own. That does not fail
 * anything. It just quietly makes the privacy notice wrong, which is the one
 * kind of wrong here that is a legal defect rather than a bug.
 *
 * So this reads the built bundle and asks which hosts it names at all. A host
 * that is not in the list below fails, whether or not it is ever fetched -
 * telling those two apart from the outside is not possible, and the list is
 * short enough that adding to it deliberately is the point. If you are here
 * because this test failed on a host you just introduced: decide whether it is
 * fetched, and if it is, it belongs in the privacy notice before it belongs
 * here.
 */

const DIST = resolve(process.cwd(), 'dist');

/** Files worth reading. The wasm and the models are not text. */
const TEXT = new Set(['.js', '.css', '.html', '.json', '.webmanifest', '.map']);

/**
 * Every host the built site is allowed to name, and why. "Fetched" is the
 * column that matters: those are the ones the privacy notice has to declare.
 */
const ALLOWED = new Map([
  // Fetched. The voice model, once, on the first recording. Declared.
  ['huggingface.co', 'the piper voice models'],
  // Fetched, and only ever after a ?sammlung= link is opened: the one published
  // Sammlung that link names. Declared — „Eine fertige Sammlung holen".
  ['lautstark.tech', 'a published Sammlung a ?sammlung= link names'],
  // Linked in prose, never fetched - the about, Impressum and licence texts.
  ['github.com', 'the source code and the issue tracker'],
  ['lautstark.github.io', 'the sister projects'],
  ['creativecommons.org', 'the licence the symbols carry'],
  ['www.caito.de', 'the source of a bundled word list'],
  ['www.avery-zweckform.com', 'the label sheet an Anybook export is printed on'],
  // Never fetched and never linked: licence headers, XML namespaces and a
  // documentation link that travel inside third-party code.
  ['www.mp3dev.org', 'a licence header in lamejs'],
  ['www.w3.org', 'the SVG and XML namespaces'],
  ['web.dev', "a link in onnxruntime-web's message about cross-origin isolation"],
]);

/**
 * Hosts that would mean the vendoring has come undone. Named separately from
 * the sweep below only for the error message: "cdnjs is back" is a different
 * problem from "here is a host nobody has classified", and it wants a
 * different first move.
 */
const PACKAGE_CDNS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com', 'esm.sh', 'cdn.skypack.dev'];

const HOST = /https?:\/\/([a-zA-Z0-9.-]+)/g;

/**
 * The directory piper's runtime is pointed at, as the bundle carries it.
 *
 * There is no `"/wasm/"` in the built code to look for. `piperRuntime()` joins
 * the base and the directory itself, at runtime, so what survives minification
 * is the pair that was passed in - and the pair is the fact worth checking:
 * `base` is a path on this origin rather than a URL on a host, and `dir` is
 * the same `wasm` that `piperVendor()` was told to fill. Either order, because
 * which one is written first is not something this test has an opinion about.
 */
const POINTED_AT = /dir:"wasm",\s*base:"\/[^"]*"|base:"\/[^"]*",\s*dir:"wasm"/;

/** Every text file under dist/, however deep. */
function builtFiles(dir = DIST): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...builtFiles(full));
    else if (TEXT.has(extname(entry))) out.push(full);
  }
  return out;
}

/** Which hosts each file names, as host -> the files naming it. */
function hostsInBuild(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of builtFiles()) {
    const text = readFileSync(file, 'utf8');
    for (const [, host] of text.matchAll(HOST)) {
      const where = found.get(host) ?? [];
      if (!where.includes(file)) where.push(file);
      found.set(host, where);
    }
  }
  return found;
}

test.describe('the built bundle', () => {
  test('has been built at all', () => {
    // Without this the two below pass on an empty directory, which is the
    // worst way for a check like this to be green.
    const files = builtFiles();
    expect(files.length, `no built files under ${DIST} - run npm run build`).toBeGreaterThan(3);
    // The four the vendoring exists to produce.
    const wasm = readdirSync(join(DIST, 'wasm'));
    expect(wasm.sort()).toEqual([
      'ort-wasm-simd.wasm', 'ort-wasm.wasm', 'piper_phonemize.data', 'piper_phonemize.wasm',
    ]);
  });

  test('fetches its wasm from this origin and not from a package CDN', () => {
    const hosts = hostsInBuild();
    const back = PACKAGE_CDNS.filter((cdn) => hosts.has(cdn));
    expect(back, back.length
      ? `${back.join(', ')} is named in the bundle: piper's runtime would be fetched from `
        + 'that CDN at runtime rather than from this origin'
      : '').toEqual([]);

    // The other half of the same fact, because a host can also be absent for a
    // reason nobody wanted: the two modules that would otherwise come from a
    // CDN are chunks of this build, and the directory they are pointed at for
    // their binaries is this origin's own.
    const js = builtFiles().filter((f) => f.endsWith('.js'));
    for (const chunk of ['piper_phonemize', 'ort.wasm.min']) {
      expect(js.some((f) => basename(f).startsWith(`${chunk}-`)),
        `${chunk} is not a chunk of this build - it is being loaded from somewhere else`)
        .toBe(true);
    }
    const code = js.map((f) => readFileSync(f, 'utf8'));
    expect(code.some((text) => POINTED_AT.test(text)),
      'no wasmBase pointing at this origin - see usePiperRuntime in src/core/audio.ts')
      .toBe(true);
  });

  test('names no host it has not been told about', () => {
    const hosts = hostsInBuild();
    const strangers = [...hosts.keys()].filter((host) => !ALLOWED.has(host)).sort();
    expect(strangers, strangers.length
      ? 'the built site names ' + strangers.map((h) => `${h} (in ${hosts.get(h)!.join(', ')})`).join('; ')
        + ' - if anything is fetched from it, the privacy notice has to say so; '
        + 'then add it to ALLOWED in this file with the reason'
      : '').toEqual([]);
  });
});

test('opening the page reaches nothing but this origin', async ({ page, baseURL }) => {
  const outside: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!/^https?:/.test(url)) return;             // data:, blob: - not the network
    if (!url.startsWith(baseURL!)) outside.push(url);
  });

  await page.goto('/?lang=de');
  await page.waitForFunction(() => document.querySelectorAll('#rows .collections__item').length > 0);

  // Nothing at all until somebody records: the voice model is fetched on the
  // first recording, not on arrival, and that is what makes opening the page
  // cost the reader no third party whatsoever.
  expect(outside, outside.join('\n')).toEqual([]);
});
