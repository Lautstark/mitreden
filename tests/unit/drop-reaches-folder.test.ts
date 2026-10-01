import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A deleted Sammlung stays deleted where a folder is the store.
 *
 * §4.3: the Sammlung goes and its sentences stay, losing the membership. That
 * is a change to every one of them, and dropCollection wrote it into IndexedDB
 * without a new `updatedAt` — and the folder decides what to rewrite by
 * comparing exactly that. So the mirror skipped every member, the files kept
 * naming the Sammlung, and the next pull (a reload, or the second device)
 * read the membership back in. The Sammlung itself stayed gone; its sentences
 * stood under a tag nothing showed.
 */

/* The folder, faked at the seam db/ writes through. Its pushKind keeps the
   real one's rule — a record is rewritten only when its `updatedAt` differs —
   because that rule is the whole of the bug. */
type Kind = 'sammlungen' | 'saetze';
const files: Record<Kind, Map<string, { id: string; updatedAt?: number }>> = {
  sammlungen: new Map(), saetze: new Map(),
};

vi.mock('../../src/db/folder.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/db/folder.ts')>();
  return {
    ...real,
    isStore: () => true,
    isStale: () => false,
    adopted: async () => true,
    filePhrase: async (item: Parameters<typeof real.asStored>[0]) => {
      const stored = await real.asStored(item);
      files.saetze.set(stored.id, stored);
    },
    fileCollection: async (item: { id: string }) => { files.sammlungen.set(item.id, { ...item }); },
    unfileCollection: async (id: string) => { files.sammlungen.delete(id); },
    unfilePhrase: async (id: string) => { files.saetze.delete(id); },
    pushKind: async (kind: Kind, records: { id: string; updatedAt: number }[]) => {
      const here = new Set(records.map((record) => record.id));
      for (const id of [...files[kind].keys()]) if (!here.has(id)) files[kind].delete(id);
      for (const record of records) {
        if (files[kind].get(record.id)?.updatedAt !== record.updatedAt) files[kind].set(record.id, record);
      }
    },
    readKind: async (kind: Kind) => [...files[kind].values()],
  };
});

const { addPhrases, createCollection, deleteCollection } = await import('../../src/db/repo.ts');
const { pullFromFolder } = await import('../../src/db/mirror.ts');
const { allPhrases } = await import('../../src/db/phrases.ts');
const { wipe } = await import('../../src/db/wipe.ts');

describe('deleting a Sammlung, with a folder as the store', () => {
  beforeEach(async () => {
    await wipe();
    files.sammlungen.clear();
    files.saetze.clear();
  });

  it('takes the membership off the sentences’ files as well', async () => {
    const { id } = await createCollection('Morgens', true);
    await addPhrases(['Ich habe Hunger.'], id);

    await deleteCollection(id);

    expect([...files.saetze.values()].map((file) => 'collection' in file)).toEqual([false]);
  });

  it('does not bring it back on the next pull', async () => {
    const { id } = await createCollection('Morgens', true);
    await addPhrases(['Ich habe Hunger.'], id);
    await deleteCollection(id);

    await pullFromFolder();

    const [back] = await allPhrases();
    expect(back!.text).toBe('Ich habe Hunger.');
    expect(back!.collection).toBeUndefined();
  });
});
