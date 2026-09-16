/* The recordings, by the sentence's id.
 *
 * None of these announces a change — deliberately, and db.ts has the rule:
 * recordings are not in the backup, because they are reproducible and three
 * orders of magnitude the size, so a build of two hundred sentences would
 * otherwise rewrite the Sicherung two hundred times to say nothing new. */
import { db } from './db.ts';

export const getAudio = async (id: string): Promise<Blob | undefined> =>
  (await db()).get('audio', id);
export const putAudio = async (id: string, blob: Blob): Promise<void> => {
  await (await db()).put('audio', blob, id);
};
export const dropAudio = async (id: string): Promise<void> => {
  await (await db()).delete('audio', id);
};
