/**
 * Names, twins and fingerprints.
 *
 * Ported from mitreden.py and deliberately unchanged in behaviour: an id is a
 * file name, and the file it names may long since be sitting on a talker.
 */

import { keyFor } from '@lautstark/stimmquelle/browser';
import { ENGINE, OUT } from './settings.ts';
import { modelOf } from './voices.ts';

/** What every name this program writes is built from — §3.4's engine term and
 *  §3.6's output settings, in one place so the two callers cannot disagree. */
const ENGINE_KEY = { rate: OUT.sampleRate, out: OUT, engine: ENGINE } as const;

export const SLUG_WORDS = 6;
export const SLUG_CHARS = 40;

const KEEP = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SUBSTITUTE: Record<string, string> = {
  ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', é: 'e', è: 'e',
};

export function slug(text: string, fallback = 'phrase'): string {
  let out = '';
  for (const ch of text.toLowerCase().trim())
    for (const c of SUBSTITUTE[ch] ?? ch) out += KEEP.includes(c) ? c : '-';
  const words = out.split('-').filter(Boolean);
  const short: string[] = [];
  for (const word of words.slice(0, SLUG_WORDS)) {
    if (short.length && [...short, word].join('-').length > SLUG_CHARS) break;
    short.push(word);
  }
  return short.join('-').slice(0, SLUG_CHARS).replace(/^-+|-+$/g, '') || fallback;
}

/* normTag lived here: slug(name) cut to 24 characters, with the dangling
 * separator trimmed so that normTag(normTag(x)) === normTag(x). It was how a
 * Sammlung's key was made, and it is gone with the key — a Sammlung's identity
 * is a minted UUID now (conventions.md §1.1, core/types.ts).
 *
 * Worth keeping the reason it was delicate, because it is the argument for not
 * having had it: the idempotence above was load-bearing for every caller that
 * stored a key and later looked one up, the truncation meant two names agreeing
 * for 24 characters produced one key, and creating the second of those silently
 * returned the first. Three questions, all of them consequences of making the
 * identity out of a field somebody is allowed to edit.
 */

/** Punctuation stays in: "Nochmal!" and "Nochmal." are spoken differently. */
export const normText = (text: string): string =>
  text.split(/\s+/).filter(Boolean).join(' ').toLowerCase();

/* findTwin, freeKey and freeId used to live here, each taking the whole array
 * and scanning it, because the whole array was the only thing there was to ask.
 * They are questions about what the store already holds — "is there a sentence
 * like this", "is this id taken" — so they are db.ts's now, as twinsOf() and
 * idTaken(), answered by an index or a key lookup instead of a scan. What
 * stays here is the part that is a rule about names rather than a question
 * about storage: how a sentence becomes a file name, and what "like this"
 * means.
 *
 * A sentence's id is still derived, and that is not the same decision §1.1
 * makes about a Sammlung: it is a file name on somebody's talker, so it has to
 * be readable and stable, and the text it comes from is not a field anybody
 * renames in place.
 */

/**
 * A name nothing has taken, numbered the way both of them numbered.
 *
 * `taken` is asked rather than a list handed in, which is the whole of what
 * changed: a caller writing several at once has to count what it is about to
 * write as well as what the store holds, and the array version got that for
 * free by scanning the array it was appending to.
 */
export async function free(
  base: string, taken: (candidate: string) => boolean | Promise<boolean>,
): Promise<string> {
  if (!(await taken(base))) return base;
  for (let n = 2; ; n++) if (!(await taken(`${base}-${n}`))) return `${base}-${n}`;
}

/**
 * What "still counts as recorded" means: the text, the voice, and how it was
 * made. Change any of them and the recording is stale rather than wrong.
 *
 * **stimmquelle's since 2.8.0, and this file had it wrong.** CONTRACT.md §3 has
 * specified these six inputs since 1.0.0 and this function assembled them
 * itself. It read §3.4's "omitted for cloud backends" as covering both version
 * terms and so dropped §3.5, the pipeline version, from every `azure:` name.
 * §3.5 has no such exemption, and should not: §1's levelling and §2's trim are
 * applied *here*, by this machine, to whatever Azure sends back — so a change
 * to either alters a cloud recording exactly as much as a local one, and this
 * page would have gone on calling it current. vorlaut had the mirror-image
 * error in its own copy. Neither assembles it any more.
 *
 * The sentence that used to stand here — that Azure renders elsewhere, so the
 * engine bundled here says nothing about those recordings — is right, and it is
 * §3.4. It is keyFor()'s to keep now.
 *
 * Twelve characters is §3's per-product choice, unchanged: no two products
 * share a cache directory, so the length never has to agree.
 */
export async function fingerprint(text: string, voiceId: string): Promise<string> {
  return (await keyFor(text, voiceId, ENGINE_KEY)).slice(0, 12);
}

/**
 * The engine strings this program has ever named itself by, while §1, §2 and
 * §3a stood where they stand now.
 *
 * Only stimmquelle 2.7.0 and 2.8.0 shipped `PIPELINE_VERSION` 3, so only those
 * two can have written a name whose audio is still current. A recording made
 * under pipeline 2 sounds different from one made today, and *should* read as
 * stale — that is what the number is for.
 *
 * The list dies when no library in the wild still carries one of these, and
 * nothing but a guess says when that is. It costs two hashes per sentence on
 * one boot.
 */
const FORMER_ENGINES = ['stimmquelle@2.8.0 pipeline@3', 'stimmquelle@2.7.0 pipeline@3'];

/**
 * Every name this recording could already be filed under, across the two
 * schemes that came before the one in force.
 *
 * db/rekey.ts uses it for one job: deciding whether a stored name belongs to a
 * recording that is still current, so it can be renamed rather than spoken
 * again.
 *
 * **Scheme 1 needs the list above, and that is the bug this function was
 * written a second time to fix.** Its first version recomputed the old formula
 * using the *live* `stimmquelle@<VERSION>`, which by then said 2.8.0 — so a
 * library recorded under 2.7.0 matched nothing, was left alone as though it
 * were stale, and re-recorded itself for no reason. Precisely the cost the
 * move off a package version was meant to end, paid one last time on the way
 * out. The engine string has to be the one that *wrote* the name, so the
 * candidates are enumerated rather than derived.
 */
export async function formerNames(text: string, voiceId: string): Promise<string[]> {
  const cloud = voiceId.startsWith('azure:');
  const short = async (payload: string): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  };

  // Scheme 1: this file's own payload, before it asked stimmquelle for §3. A
  // cloud name had no engine term in it and no pipeline term either — the
  // second of those was the bug — so one candidate covers every version.
  const first = cloud
    ? [await short(JSON.stringify([text, 'azure', voiceId.slice(6), OUT]))]
    : await Promise.all(FORMER_ENGINES.map((engine) =>
      short(JSON.stringify([text, 'piper', modelOf(voiceId), engine, OUT]))));

  // Scheme 2: keyFor, but still naming stimmquelle as the engine — which is
  // its default, so this is what a name looked like between the two commits.
  const second = (await keyFor(text, voiceId, { rate: OUT.sampleRate, out: OUT })).slice(0, 12);

  return [...first, second];
}
