/**
 * Names, twins and fingerprints.
 *
 * Ported from mitreden.py and deliberately unchanged in behaviour: an id is a
 * file name, and the file it names may long since be sitting on a talker.
 */

import { ENGINE_VERSION, OUT } from './settings.ts';
import { modelOf } from './voices.ts';

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

/**
 * A Sammlung's key. Cutting at 24 characters can land mid-word and leave the
 * separator dangling; trimming it keeps `normTag(normTag(x)) === normTag(x)`,
 * which every caller that stores a key and later looks it up depends on.
 */
export const normTag = (text: string): string =>
  slug(text, '').slice(0, 24).replace(/-+$/, '');

/** Punctuation stays in: "Nochmal!" and "Nochmal." are spoken differently. */
export const normText = (text: string): string =>
  text.split(/\s+/).filter(Boolean).join(' ').toLowerCase();

/* findTwin, freeKey and freeId used to live here, each taking the whole array
 * and scanning it, because the whole array was the only thing there was to ask.
 * They are questions about what the store already holds — "is there a sentence
 * like this", "is this key taken" — so they are db.ts's now, as twinOf(),
 * freeKey() and freeId(), answered by an index or a key lookup instead of a
 * scan. What stays here is the part that is a rule about names rather than a
 * question about storage: how a name becomes a key, and what "like this" means.
 *
 * The disambiguation they did is unchanged and still matters: normTag
 * truncates, so two names differing only near the end — "Sammlung vom
 * 22.08.2026" and the same with "(2)" — arrive at the same key, and creating
 * the second one silently found the first. The number goes on the key.
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
 * Azure renders on somebody else's machine, so which engine is bundled here
 * says nothing about how those recordings came out. Naming it would re-record
 * every cloud-spoken sentence on an upgrade that cannot have changed them.
 */
export async function fingerprint(text: string, voiceId: string): Promise<string> {
  const cloud = voiceId.startsWith('azure:');
  const payload = JSON.stringify(cloud
    ? [text, 'azure', voiceId.slice(6), OUT]
    : [text, 'piper', modelOf(voiceId), ENGINE_VERSION, OUT]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}
