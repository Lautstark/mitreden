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
  getAudio, dropAudio, loadCollections, loadPhrases, loadSettings,
  putAudio, saveCollections, savePhrases, saveSettings, type Settings,
} from './db.ts';
import { record } from '../core/audio.ts';
import { fingerprint, findTwin, freeId, freeKey, normTag } from '../core/ids.ts';
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
  const declared = await loadCollections();
  if (declared.length) return declared;
  const name = defaultName(german);
  const made: Collection[] = [{ key: normTag(name) || 'sammlung', name }];
  await saveCollections(made);
  return made;
}

async function stateOf(item: Phrase): Promise<State> {
  if (!(await getAudio(item.id))) return 'missing';
  if (!item.voice || !item.fingerprint) return 'stale';
  return (await fingerprint(item.text, item.voice)) === item.fingerprint ? 'ok' : 'stale';
}

export async function phrases(): Promise<PhraseWithState[]> {
  const items = await loadPhrases();
  return Promise.all(items.map(async (item) => ({ ...item, state: await stateOf(item) })));
}

export async function collections(): Promise<CollectionWithCount[]> {
  const [declared, items] = await Promise.all([loadCollections(), loadPhrases()]);
  const counts = new Map<string, number>();
  for (const item of items)
    for (const key of item.collections) counts.set(key, (counts.get(key) ?? 0) + 1);
  return declared.map((c) => ({ ...c, count: counts.get(c.key) ?? 0 }));
}

export interface Added {
  added: number;
  merged: number;
  ids: string[];
}

/**
 * Adding is not recording. The sentences are saved and handed back at once so
 * the list can show them while the voice is still being made — on a first run
 * that is a 60 MB model download, and a list that stays empty for a minute
 * looks like the typing was thrown away.
 */
export async function addPhrases(lines: string[], into: string[]): Promise<Added> {
  const items = await loadPhrases();
  const fresh: Phrase[] = [];
  let merged = 0;
  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    const twin = findTwin(items, text);
    if (twin) {
      for (const key of into) if (!twin.collections.includes(key)) twin.collections.push(key);
      merged += 1;
      continue;
    }
    const item: Phrase = { id: freeId(items, text), text, collections: [...into] };
    items.push(item);
    fresh.push(item);
  }
  await savePhrases(items);
  return { added: fresh.length, merged, ids: fresh.map((i) => i.id) };
}

export interface Built {
  recorded: number;
  failed: string[];
}

/**
 * A sentence that cannot be recorded is still a sentence: it stays in the list
 * and asks to be recorded again. One failure does not lose the rest.
 */
export async function build(ids: string[], voiceId: string, force = false): Promise<Built> {
  const items = await loadPhrases();
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
      const { blob } = await record(item.text, voice, settings.azure);
      await putAudio(item.id, blob);
      item.voice = voice;
      item.fingerprint = mark;
      recorded += 1;
    } catch (error) {
      failed.push(`${item.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await savePhrases(items);
  return { recorded, failed };
}

export async function editPhrase(id: string, text: string): Promise<Phrase | null> {
  const items = await loadPhrases();
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  // The id stays. It is a file name, and the file may already be on a talker.
  item.text = text;
  await savePhrases(items);
  return item;
}

export async function deletePhrase(id: string): Promise<void> {
  const items = await loadPhrases();
  await savePhrases(items.filter((i) => i.id !== id));
  await dropAudio(id);
}

/**
 * Only `create` turns a name into a key. A key handed back in is used as it
 * stands: normTag truncates, so minting it twice returns something shorter that
 * matches nothing, and the Sammlung could then be neither renamed nor deleted.
 */
export async function createCollection(name: string | null, german: boolean): Promise<Collection> {
  const declared = await loadCollections();
  let shown = name?.trim() ?? '';
  let key: string;
  if (shown) {
    key = normTag(shown);
    const existing = declared.find((c) => c.key === key);
    if (existing) return existing;
  } else {
    const base = defaultName(german);
    shown = base;
    for (let n = 2; declared.some((c) => c.name === shown); n++) shown = `${base} (${n})`;
    key = freeKey(declared, shown);
  }
  const made: Collection = { key, name: shown };
  await saveCollections([...declared, made]);
  return made;
}

export async function renameCollection(key: string, to: string): Promise<Collection | null> {
  const declared = await loadCollections();
  const hit = declared.find((c) => c.key === key);
  if (!hit) return null;
  hit.name = to.trim();
  await saveCollections(declared);
  return hit;
}

/** The Sammlung goes, the sentences stay: they are the irreplaceable half. */
export async function deleteCollection(key: string): Promise<boolean> {
  const declared = await loadCollections();
  if (!declared.some((c) => c.key === key)) return false;
  await saveCollections(declared.filter((c) => c.key !== key));
  const items = await loadPhrases();
  for (const item of items) item.collections = item.collections.filter((k) => k !== key);
  await savePhrases(items);
  return true;
}

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
