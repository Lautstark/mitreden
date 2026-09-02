import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * „Alles löschen" has to reach the folder, and has to refuse when it cannot.
 *
 * This is the one control in the product that promised something and did not
 * do it. `wipe()` cleared IndexedDB and stopped — while every other mutation in
 * db.ts mirrors afterwards — so where a folder was the store the files stayed,
 * `wipeEverything()` reloaded the page, `pullFromFolder()` read them back, and
 * the recordings came with them because they hang off the sentence id that came
 * back unchanged. The library reappeared in front of whoever had just asked for
 * it to be gone.
 *
 * Two rules, and the second is not a detail. A wipe with the folder out of
 * reach empties the browser and leaves the folder whole, which is the same
 * failure wearing the other face — so the dialog has to know not to start.
 */

/* The folder, faked at the seam db.ts writes through. Real enough to record
   what was removed; nothing here touches a disk. */
const files = { sammlungen: new Map<string, unknown>(), saetze: new Map<string, unknown>() };
let store = true;
let stale = false;

vi.mock('../../src/db/folder.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/db/folder.ts')>();
  return {
    ...real,
    isStore: () => store,
    isStale: () => stale,
    adopted: async () => store && !stale,
    pushKind: async (kind: 'sammlungen' | 'saetze', records: { id: string }[]) => {
      if (!store || stale) return;
      const here = new Set(records.map((r) => r.id));
      for (const id of [...files[kind].keys()]) if (!here.has(id)) files[kind].delete(id);
      for (const record of records) files[kind].set(record.id, record);
    },
  };
});

const { wipe, wipeReaches } = await import('../../src/db/db.ts');

/* Seeded directly rather than through putCollection/putPhrase: those write
   through the per-record `fileCollection`/`filePhrase` seam, and what is under
   test here is the wholesale one — `mirror`, which is the line wipe() was
   missing. Faking both would be faking the thing being measured. */
const seedFolder = () => {
  files.sammlungen.set('c1', { id: 'c1', name: 'Morgens' });
  files.saetze.set('s1', { id: 's1', text: 'ich möchte Wasser' });
};

describe('a wipe reaches the folder', () => {
  beforeEach(async () => {
    store = true; stale = false;
    files.sammlungen.clear(); files.saetze.clear();
    await wipe();
  });

  it('removes the files that are there', async () => {
    seedFolder();
    expect(files.sammlungen.size + files.saetze.size).toBe(2);

    await wipe();

    expect([...files.sammlungen.keys()]).toEqual([]);
    expect([...files.saetze.keys()]).toEqual([]);
  });

  /* The browser emptying while the folder keeps everything is the failure this
     whole file is about, wearing its other face. The wipe must not be offered
     there — but if it is called anyway, it must not silently half-succeed. */
  it('leaves the folder alone when it is not answering', async () => {
    seedFolder();
    stale = true;
    await wipe();
    expect(files.sammlungen.size + files.saetze.size).toBe(2);
    expect(wipeReaches()).toBe('unreachable');
  });
});

describe('how far a wipe would reach', () => {
  it('is this browser when no folder is the store', () => {
    store = false; stale = false;
    expect(wipeReaches()).toBe('browser');
  });

  it('is every device when a folder is reachable', () => {
    store = true; stale = false;
    expect(wipeReaches()).toBe('folder');
  });

  /* The one that must not be offered. The browser would empty, the folder would
     keep everything, and the next start would hand it all back. */
  it('is nothing at all when the folder is not answering', () => {
    store = true; stale = true;
    expect(wipeReaches()).toBe('unreachable');
  });
});
