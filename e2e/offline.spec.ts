import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

/*
 * mitreden speaks without asking anyone. That is the claim the privacy notice
 * makes - GitHub Pages serves the page, Hugging Face serves a voice model once,
 * and with your own key Azure hears your sentences; nothing else - and it is
 * true only because vite.config.ts rewrites the two CDNs vits-web hardcodes to
 * files served from this origin.
 *
 * A rewrite is a silent thing to lose. The build guard catches the way it
 * breaks from underneath - a constant the package moved - but not the way it
 * breaks from above: a new dependency, or an import somebody added, that
 * fetches from a host of its own. That does not fail anything. It just quietly
 * makes the privacy notice wrong, which is the one kind of wrong here that is
 * a legal defect rather than a bug.
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
  // Linked in prose, never fetched - the about, Impressum and licence texts.
  ['github.com', 'the source code and the issue tracker'],
  ['lautstark.github.io', 'the sister projects'],
  ['creativecommons.org', 'the licence the symbols carry'],
  ['web.dev', 'a linked explanation'],
  ['www.caito.de', 'the source of a bundled word list'],
  // Never fetched and never linked: licence headers and XML namespaces that
  // travel inside third-party code.
  ['www.apache.org', 'a licence header in a vendored library'],
  ['www.mp3dev.org', 'a licence header in lamejs'],
  ['www.w3.org', 'the SVG and XML namespaces'],
]);

/**
 * Hosts that would mean the vendoring has come undone. Named separately from
 * the sweep below only for the error message: "cdnjs is back" is a different
 * problem from "here is a host nobody has classified", and it wants a
 * different first move.
 */
const PACKAGE_CDNS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com', 'esm.sh', 'cdn.skypack.dev'];

const HOST = /https?:\/\/([a-zA-Z0-9.-]+)/g;

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
      ? `${back.join(', ')} is named in the bundle: the rewrite in vite.config.ts did not `
        + 'reach it, so piper would be fetched from that CDN at runtime'
      : '').toEqual([]);

    // The other half of the same fact: the rewrite happened, rather than the
    // string having vanished for some unrelated reason.
    const js = builtFiles().filter((f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8'));
    expect(js.some((code) => code.includes('./wasm/piper_phonemize'))).toBe(true);
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
  await page.waitForFunction(() => document.querySelectorAll('#rows .list__item').length > 0);

  // Nothing at all until somebody records: the voice model is fetched on the
  // first recording, not on arrival, and that is what makes opening the page
  // cost the reader no third party whatsoever.
  expect(outside, outside.join('\n')).toEqual([]);
});
