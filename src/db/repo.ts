/**
 * Everything the interface can ask of the data, as functions.
 *
 * This replaces a route table. The page used to call `post('/api/phrases', …)`
 * and a switch on the string answered it — a seam kept for a container that no
 * longer exists. Inside one bundle it bought nothing and cost the compiler its
 * view: a call to a route that was never handled, or a handler reaching for a
 * name nothing declared, both looked exactly like working code.
 */

import {
  allCollections, allPhrases, countIn, dropAudio, dropCollection, dropPhrase,
  getAudio, getCollection, getPhrase, idTaken, keyTaken, loadSettings, putAudio,
  putCollection, putPhrase, putPhrases, saveSettings, twinOf, type Settings,
} from './db.ts';
import { record } from '../core/audio.ts';
import { fingerprint, free, normText, normTag, slug } from '../core/ids.ts';
import type { Collection, CollectionWithCount, Phrase, PhraseWithState, State } from '../core/types.ts';

/** A Sammlung named after the day, the way a new notebook gets a date. */
export function defaultName(german: boolean): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
  return `${german ? 'Sammlung vom' : 'Collection of'} ${date}`;
}

/**
 * A sentence always belongs to a Sammlung, which means there always has to be
 * one. bildhaft's rule, and it removes a whole class of question the page would
 * otherwise have to ask.
 */
export async function ensureCollection(german: boolean): Promise<Collection[]> {
  const declared = await allCollections();
  if (declared.length) return declared;
  const name = defaultName(german);
  const made: Collection = { key: normTag(name) || 'sammlung', name };
  await putCollection(made);
  return [made];
}

async function stateOf(item: Phrase): Promise<State> {
  if (!(await getAudio(item.id))) return 'missing';
  if (!item.voice || !item.fingerprint) return 'stale';
  return (await fingerprint(item.text, item.voice)) === item.fingerprint ? 'ok' : 'stale';
}

export async function phrases(): Promise<PhraseWithState[]> {
  const items = await allPhrases();
  return Promise.all(items.map(async (item) => ({ ...item, state: await stateOf(item) })));
}

/** Every Sammlung with how much is in it. The count comes off the membership
 *  index and touches no sentence at all; it used to mean loading the whole
 *  library and tallying it. §1.8 wants this number in every row. */
export async function collections(): Promise<CollectionWithCount[]> {
  const declared = await allCollections();
  return Promise.all(declared.map(async (c) => ({ ...c, count: await countIn(c.key) })));
}

/**
 * A sentence on its way in: the text alone, or the text with the voice it was
 * recorded in. Only a file carries the second — somebody typing cannot know a
 * voice yet, and picks one afterwards.
 */
export type Line = string | { text: string; voice?: string };

export interface Added {
  added: number;
  merged: number;
  /** Of the added, how many named a voice this browser cannot reach. */
  revoiced: number;
  ids: string[];
}

/**
 * Adding is not recording. The sentences are saved and handed back at once so
 * the list can show them while the voice is still being made — on a first run
 * that is a 60 MB model download, and a list that stays empty for a minute
 * looks like the typing was thrown away.
 *
 * `reachable` is the voices this page can actually speak in, and only an import
 * has one: it decides whether a voice arriving with a sentence is kept.
 */
export async function addPhrases(
  lines: readonly Line[], into: string[], reachable?: ReadonlySet<string>,
): Promise<Added> {
  /* What this call will write, collected and put in one transaction at the end
     rather than saved per line. Twins are looked up in the store *and* here:
     two identical lines in one paste have no twin in the database yet, and the
     array version got that for free by mutating the array it was scanning. */
  const writing = new Map<string, Phrase>();
  const twinIn = async (text: string): Promise<Phrase | undefined> => {
    const key = normText(text);
    for (const held of writing.values()) if (normText(held.text) === key) return held;
    return twinOf(text);
  };
  const fresh: Phrase[] = [];
  let merged = 0;
  let revoiced = 0;
  for (const line of lines) {
    const named = typeof line === 'string' ? undefined : line.voice;
    const text = (typeof line === 'string' ? line : line.text).trim();
    if (!text) continue;
    const twin = await twinIn(text);
    if (twin) {
      // A twin keeps its own voice: it may already have the recording, and the
      // file's voice is about a copy of the sentence that did not survive.
      for (const key of into) if (!twin.collections.includes(key)) twin.collections.push(key);
      writing.set(twin.id, twin);
      merged += 1;
      continue;
    }
    const id = await free(slug(text), async (c) => writing.has(c) || idTaken(c));
    const item: Phrase = { id, text, collections: [...into] };
    // A sentence that arrives naming its voice keeps it, so the same file on a
    // second device records the way it did on the first — that is the whole
    // point of the program. A voice this page cannot reach is the exception:
    // build() prefers the sentence's own voice over the picked one, so keeping
    // an Azure voice here without a key would fail the recording rather than
    // fall back to a voice that works.
    if (named && (!reachable || reachable.has(named))) item.voice = named;
    else if (named) revoiced += 1;
    writing.set(item.id, item);
    fresh.push(item);
  }
  await putPhrases([...writing.values()]);
  return { added: fresh.length, merged, revoiced, ids: fresh.map((i) => i.id) };
}

export interface Built {
  recorded: number;
  failed: string[];
}

/**
 * A sentence that cannot be recorded is still a sentence: it stays in the list
 * and asks to be recorded again. One failure does not lose the rest.
 *
 * `onStep` is told which sentence is starting and which has finished, because
 * only this loop knows: recording is one await per sentence and the first of
 * them may spend a minute fetching the voice, so a page that hears nothing
 * until the batch ends can only say "not recorded yet" about work already
 * under way — and about work already done.
 */
export async function build(
  ids: string[], voiceId: string, force = false,
  onStep?: (id: string, done: boolean) => void,
): Promise<Built> {
  const items = await allPhrases();
  const settings = await loadSettings();
  const wanted = new Set(ids);
  let recorded = 0;
  const failed: string[] = [];
  for (const item of items) {
    if (wanted.size && !wanted.has(item.id)) continue;
    const voice = force ? voiceId : item.voice ?? voiceId;
    try {
      const mark = await fingerprint(item.text, voice);
      if (!force && item.fingerprint === mark && (await getAudio(item.id))) continue;
      onStep?.(item.id, false);
      const { blob } = await record(item.text, voice, settings.azure);
      await putAudio(item.id, blob);
      item.voice = voice;
      item.fingerprint = mark;
      recorded += 1;
      // Saved before it is announced: the row answers by reading the store,
      // and a sentence reported as finished has to be findable there.
      //
      // One sentence, not the library. This loop is where the JSON array cost
      // the most - two hundred recordings meant two hundred rewrites of a
      // two-hundred-entry array, each one to change two fields on one of them.
      await putPhrase(item);
      onStep?.(item.id, true);
    } catch (error) {
      failed.push(`${item.id}: ${error instanceof Error ? error.message : String(error)}`);
      onStep?.(item.id, true);
    }
  }
  return { recorded, failed };
}

export async function editPhrase(id: string, text: string): Promise<Phrase | null> {
  const item = await getPhrase(id);
  if (!item) return null;
  // The id stays. It is a file name, and the file may already be on a talker.
  item.text = text;
  await putPhrase(item);
  return item;
}

export async function deletePhrase(id: string): Promise<void> {
  await dropPhrase(id);
  await dropAudio(id);
}

/**
 * Only `create` turns a name into a key. A key handed back in is used as it
 * stands: normTag truncates, so minting it twice returns something shorter that
 * matches nothing, and the Sammlung could then be neither renamed nor deleted.
 */
export async function createCollection(name: string | null, german: boolean): Promise<Collection> {
  let shown = name?.trim() ?? '';
  let key: string;
  if (shown) {
    key = normTag(shown);
    const existing = await getCollection(key);
    if (existing) return existing;
  } else {
    const base = defaultName(german);
    shown = base;
    // The shown name is uniquified before the key is, so that two made on the
    // same day read as two rather than as one with a puzzling key.
    for (let n = 2; await named(shown); n++) shown = `${base} (${n})`;
    key = await free(normTag(shown), keyTaken);
  }
  const made: Collection = { key, name: shown };
  await putCollection(made);
  return made;
}

/** Whether a Sammlung is already called this. The one question here that is
 *  genuinely about every one of them - names are not keys and are not indexed,
 *  because nothing else ever looks one up by name. */
const named = async (name: string): Promise<boolean> =>
  (await allCollections()).some((c) => c.name === name);

export async function renameCollection(key: string, to: string): Promise<Collection | null> {
  const hit = await getCollection(key);
  if (!hit) return null;
  hit.name = to.trim();
  // Keeps its place in the list: putCollection carries the old stamp across,
  // because renaming is not making.
  await putCollection(hit);
  return hit;
}

/** The Sammlung goes, the sentences stay: they are the irreplaceable half.
 *  One transaction, and only over the sentences that were actually in it. */
export const deleteCollection = dropCollection;

export const settings = loadSettings;
export const saveVoice = async (voice: string): Promise<void> =>
  saveSettings({ ...(await loadSettings()), voice });
export async function saveAzure(azure: Settings['azure']): Promise<void> {
  const now = await loadSettings();
  if (azure) await saveSettings({ ...now, azure });
  else {
    const { azure: _drop, ...rest } = now;
    await saveSettings(rest);
  }
}
