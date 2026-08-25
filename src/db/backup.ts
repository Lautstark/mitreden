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

import {
  allCollections, allPhrases, idTaken, loadSettings, putCollections,
  putPhrases, twinsOf, type Settings,
} from './db.ts';
import { free, normText, slug } from '../core/ids.ts';
import { commonest } from '../core/voices.ts';
import type { Collection, Phrase } from '../core/types.ts';

export const BACKUP_FORMAT = 'mitreden-backup';
/**
 * Version 2: a sentence names one Sammlung rather than a list of them, and a
 * Sammlung names the voice it records in.
 *
 * The number moves because the shape did, and TOO_NEW is what the number is
 * for: a mitreden from before this change reading a version 2 file would find
 * no `collections` on any sentence and restore the whole library as one heap of
 * uncollected sentences, which is precisely the lossy round trip the head of
 * this file exists to have ended. It refuses instead. Version 1 files still
 * read here — see importBackup.
 */
export const BACKUP_VERSION = 2;

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
    collections: await allCollections(),
    phrases: await allPhrases(),
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
 * A sentence as some file has it, which is not quite as this version has it: a
 * version 1 backup names every Sammlung the sentence was in.
 */
type Arriving = Partial<Phrase> & { collections?: string[] };

/** Which Sammlungen an arriving sentence named, whichever version wrote it. */
const memberships = (source: Arriving): string[] =>
  source.collections ?? (source.collection ? [source.collection] : []);

/**
 * Restores a full backup, keeping the Sammlungen apart.
 *
 * Adds, never overwrites — the same rule bildhaft's import follows, and for
 * the same reason: restoring a backup must not be able to destroy work that is
 * already here. A Sammlung whose key is taken gets a free one, and a sentence
 * whose text is already here gets a row of its own in the restored Sammlung
 * rather than pulling the existing row out of the one it is in.
 */
export async function importBackup(backup: Backup): Promise<Restored> {
  if (typeof backup.version !== 'number' || backup.version > BACKUP_VERSION) {
    throw new Error(TOO_NEW);
  }

  const arriving = (backup.phrases ?? []) as Arriving[];

  /* Every arriving Sammlung gets a fresh id, whatever the file called it.
     conventions.md §1.10 — a Sammlung arriving from a file joins the ones
     already here — and §1.1: the id is minted, never carried and never derived.
     Minting unconditionally is also what makes a backup written before ids were
     UUIDs restore without a word of compatibility code, since nothing here
     reads the incoming id for anything but the membership map below.

     The name is what can still collide, and a name collision is the only kind
     left: it is marked rather than resolved, because two Sammlungen are allowed
     to share a name and the person should be able to see which one arrived. */
  const held = new Set((await allCollections()).map((c) => c.name));

  /* What each arriving Sammlung's sentences were recorded in, so that a file
     written before Collection.voice existed still lands with the voices it was
     made in. The file's own settings voice is the tie-break and the fallback —
     it is what that mitreden would have recorded a new sentence in. */
  const votes = new Map<string, (string | undefined)[]>();
  for (const source of arriving) {
    for (const was of memberships(source)) {
      votes.set(was, [...votes.get(was) ?? [], source.voice]);
    }
  }
  const fallback = backup.settings?.voice;

  // Old id -> the id it got here, so membership survives the trip.
  const moved = new Map<string, string>();
  const landed: Collection[] = [];
  for (const source of backup.collections ?? []) {
    const was = (source as { id?: string; key?: string })?.id
      ?? (source as { key?: string })?.key;
    if (!was) continue;
    const name = source.name || was;
    const id = crypto.randomUUID();
    moved.set(was, id);
    const voice = source.voice ?? commonest(votes.get(was) ?? [], fallback) ?? fallback;
    const made: Collection = { id, name: held.has(name) ? `${name} (importiert)` : name };
    if (voice) made.voice = voice;
    landed.push(made);
  }

  /* Same as the keys above: a sentence already written by this restore is the
     twin of the next identical line in the file, and it is not in the store
     yet. */
  const writing = new Map<string, Phrase>();
  const twins = async (text: string): Promise<Phrase[]> => {
    const key = normText(text);
    const here = [...writing.values()].filter((one) => normText(one.text) === key);
    return [...here, ...(await twinsOf(text)).filter((one) => !writing.has(one.id))];
  };

  let added = 0;
  let merged = 0;
  for (const source of arriving) {
    const text = String(source?.text ?? '').trim();
    if (!text) continue;
    /* Membership, translated through whatever the Sammlungen became here. A
       sentence naming a Sammlung the file did not carry is not dropped: it
       keeps the tag, and shows up under it once that Sammlung exists again.

       A version 1 sentence that was in two lands as two rows, for the same
       reason addPhrases() makes a second row rather than merging, and the same
       reason the version 4 migration splits one — a sentence is in one Sammlung
       now, and the arrangement the file recorded is worth keeping. `undefined`
       is the uncollected sentence, which is a real state and restores as one. */
    const into: (string | undefined)[] = memberships(source)
      .map((was) => moved.get(was) ?? was);
    if (!into.length) into.push(undefined);

    for (const target of into) {
      const alike = await twins(text);
      if (alike.some((twin) => twin.collection === target)) {
        merged += 1;
        continue;
      }

      const id = await free(slug(text), async (c) => writing.has(c) || idTaken(c));
      const phrase: Phrase = { id, text };
      if (target !== undefined) phrase.collection = target;
      // The voice and the fingerprint travel together or not at all: a
      // fingerprint without the voice it was taken with cannot decide staleness,
      // and would make a missing recording look current. They are a record of a
      // recording that was really made, which is why they cross even though the
      // recording itself does not — they are what says whether the sentence
      // would come back sounding the same.
      if (source.voice) {
        phrase.voice = source.voice;
        if (source.fingerprint) phrase.fingerprint = source.fingerprint;
      }
      writing.set(phrase.id, phrase);
      added += 1;
    }
  }

  await putCollections(landed);
  await putPhrases([...writing.values()]);
  return { collections: moved.size, added, merged };
}
