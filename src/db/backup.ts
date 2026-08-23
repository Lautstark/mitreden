/**
 * The Sicherung: everything, as one file, for the case where the storage is
 * gone.
 *
 * mitreden could already export and import — but the two did not meet in the
 * middle. `exportAll` wrote a bare array of sentences, and `importFile` put
 * whatever it read into **one** new Sammlung. So a library of six Sammlungen
 * went out as six hundred sentences and came back as one heap, with the
 * membership silently gone. That is a working export and a working import
 * either side of a lossy round trip, which is the kind of gap nobody finds
 * until the day they need it.
 *
 * This is the format that survives the trip. The older shapes still read —
 * see readFile in ui/settings.ts, which also takes a bildhaft archive and a
 * bare list — because a file somebody already has must keep working.
 *
 * ## What is deliberately not in it
 *
 * **The recordings.** They are the big half by three orders of magnitude and
 * they are reproducible: a sentence carries its voice and its fingerprint, so
 * a restored library knows exactly what to re-record and what it would sound
 * like. A backup that took an hour and filled a Dropbox quota is a backup
 * people switch off.
 *
 * **The Azure key.** This one is not a size decision. A Sicherung is written
 * into a folder the user picked, and the entire point of picking one is that a
 * sync client carries it off the machine — so a key in this file is a paid
 * credential posted to somebody's cloud, and then to every device that shares
 * the folder, and then to whoever they share it with. The voice choice travels
 * because it is a preference; the key stays in the browser it was typed into.
 * `stripSecrets` is where that happens, and it is written as an allow-list so
 * that a field added to Settings later is excluded until somebody says
 * otherwise.
 */

import { loadCollections, loadPhrases, loadSettings, saveCollections, savePhrases, type Settings } from './db.ts';
import { freeId, freeKey, findTwin, normTag } from '../core/ids.ts';
import type { Collection, Phrase } from '../core/types.ts';

export const BACKUP_FORMAT = 'mitreden-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  collections: Collection[];
  phrases: Phrase[];
  /** Preferences only. Never a credential — see stripSecrets. */
  settings: SafeSettings;
  notice: string;
}

/** The half of Settings that may leave the browser. An allow-list, on purpose. */
export interface SafeSettings {
  voice?: string;
}

/** Thrown when the file is from a later mitreden. A code rather than a
 *  sentence: this layer has no language, and the caller has the table. */
export const TOO_NEW = 'backup:too-new';

/**
 * Copies across exactly the fields named, and nothing else.
 *
 * Written this way round rather than as `{ ...settings, azure: undefined }`
 * because the two behave identically today and differently the moment somebody
 * adds a second credential: the spread would ship it, this drops it. The
 * failure mode of being too careful here is a preference somebody re-picks.
 */
export function stripSecrets(settings: Settings): SafeSettings {
  const safe: SafeSettings = {};
  if (settings.voice) safe.voice = settings.voice;
  return safe;
}

/**
 * The notice is passed in rather than written here.
 *
 * mitreden ships in German and English, and this sentence travels *inside* the
 * file — so a hard-coded German one would hand an English user a German
 * explanation of what they are allowed to do with their own backup. The db
 * layer holds no strings for the same reason the rest of it holds none: the
 * page knows which language it is in, and this does not.
 */
export async function exportEverything(notice: string): Promise<Backup> {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    collections: await loadCollections(),
    phrases: await loadPhrases(),
    settings: stripSecrets(await loadSettings()),
    notice,
  };
}

export interface Restored {
  collections: number;
  added: number;
  merged: number;
}

export const isBackup = (data: unknown): data is Backup =>
  typeof data === 'object' && data !== null
  && (data as { format?: unknown }).format === BACKUP_FORMAT;

/**
 * Restores a full backup, keeping the Sammlungen apart.
 *
 * Adds, never overwrites — the same rule bildhaft's import follows, and for
 * the same reason: restoring a backup must not be able to destroy work that is
 * already here. A Sammlung whose key is taken gets a free one, and a sentence
 * that already exists joins the restored Sammlungen instead of being
 * duplicated.
 */
export async function importBackup(backup: Backup): Promise<Restored> {
  if (typeof backup.version !== 'number' || backup.version > BACKUP_VERSION) {
    throw new Error(TOO_NEW);
  }

  const declared = await loadCollections();
  const items = await loadPhrases();

  // Old key -> the key it got here, so membership survives a renamed collision.
  const moved = new Map<string, string>();
  for (const source of backup.collections ?? []) {
    if (!source?.key) continue;
    const name = source.name || source.key;
    const taken = declared.some((one) => one.key === source.key);
    const key = taken ? freeKey(declared, name) : (normTag(source.key) || freeKey(declared, name));
    moved.set(source.key, key);
    declared.push({ key, name: taken ? `${name} (importiert)` : name });
  }

  let added = 0;
  let merged = 0;
  for (const source of backup.phrases ?? []) {
    const text = String(source?.text ?? '').trim();
    if (!text) continue;
    // Membership, translated through whatever the Sammlungen became here. A
    // sentence naming a Sammlung the file did not carry is not dropped: it
    // keeps the tag, and shows up under it once that Sammlung exists again.
    const into = (source.collections ?? []).map((key) => moved.get(key) ?? key);

    const twin = findTwin(items, text);
    if (twin) {
      for (const key of into) if (!twin.collections.includes(key)) twin.collections.push(key);
      merged += 1;
      continue;
    }

    const phrase: Phrase = { id: freeId(items, text), text, collections: into };
    // The voice and the fingerprint travel together or not at all: a
    // fingerprint without the voice it was taken with cannot decide staleness,
    // and would make a missing recording look current.
    if (source.voice) {
      phrase.voice = source.voice;
      if (source.fingerprint) phrase.fingerprint = source.fingerprint;
    }
    items.push(phrase);
    added += 1;
  }

  await saveCollections(declared);
  await savePhrases(items);
  return { collections: moved.size, added, merged };
}
