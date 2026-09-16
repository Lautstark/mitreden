/* The one settings record. What is in it is schema.ts's Settings. */
import { db, touched } from './db.ts';
import { SETTINGS, type Settings } from './schema.ts';

export type { Settings } from './schema.ts';

export async function loadSettings(): Promise<Settings> {
  return (await (await db()).get(SETTINGS, SETTINGS)) ?? {};
}

export async function saveSettings(value: Settings): Promise<void> {
  await (await db()).put(SETTINGS, value, SETTINGS);
  touched();
}
