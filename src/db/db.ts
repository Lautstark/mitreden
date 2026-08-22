/**
 * Everything that is kept, and where.
 *
 * Two stores: the sentences, which are the only irreplaceable thing here, and
 * the audio, which can always be made again. Keeping the audio means a reload
 * does not re-record everything, and a voice change only re-records what
 * actually changed.
 *
 * The database name and layout are unchanged from the hand-built version, so
 * a browser that already has sentences in it keeps them.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Collection, Phrase } from '../core/types.ts';

export interface Settings {
  voice?: string;
  azure?: { key: string; region: string };
}

interface MitredenDB extends DBSchema {
  meta: {
    key: 'phrases' | 'collections' | 'settings';
    value: Phrase[] | Collection[] | Settings;
  };
  audio: { key: string; value: Blob };
}

let handle: Promise<IDBPDatabase<MitredenDB>> | null = null;

export function db(): Promise<IDBPDatabase<MitredenDB>> {
  handle ??= openDB<MitredenDB>('mitreden', 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta');
      if (!database.objectStoreNames.contains('audio')) database.createObjectStore('audio');
    },
  });
  return handle;
}

export async function loadPhrases(): Promise<Phrase[]> {
  return ((await (await db()).get('meta', 'phrases')) as Phrase[] | undefined) ?? [];
}

export async function savePhrases(items: Phrase[]): Promise<void> {
  await (await db()).put('meta', items, 'phrases');
}

/**
 * The declared Sammlungen, in the order they were made. Kept apart from the
 * sentences on purpose: one just created is empty, and one derived from its
 * members could not exist yet. That is the whole difference between a label
 * and a place you work in.
 */
export async function loadCollections(): Promise<Collection[]> {
  return ((await (await db()).get('meta', 'collections')) as Collection[] | undefined) ?? [];
}

export async function saveCollections(items: Collection[]): Promise<void> {
  await (await db()).put('meta', items, 'collections');
}

export async function loadSettings(): Promise<Settings> {
  return ((await (await db()).get('meta', 'settings')) as Settings | undefined) ?? {};
}

export async function saveSettings(value: Settings): Promise<void> {
  await (await db()).put('meta', value, 'settings');
}

export const getAudio = async (id: string): Promise<Blob | undefined> =>
  (await db()).get('audio', id);
export const putAudio = async (id: string, blob: Blob): Promise<void> => {
  await (await db()).put('audio', blob, id);
};
export const dropAudio = async (id: string): Promise<void> => {
  await (await db()).delete('audio', id);
};

/** Everything, gone: both stores, for the settings dialog's last button. */
export async function wipe(): Promise<void> {
  const database = await db();
  await database.clear('meta');
  await database.clear('audio');
}
