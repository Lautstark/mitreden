import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A sentence arriving from the folder is carried across the rename too.
 *
 * db/rekey.ts walks the library once on start and marks that it has. A pull
 * replaces every row in the library and happens whenever the folder changes —
 * the watch firing because the other machine in the household wrote, or a
 * folder connected in Einstellungen — so names written before stimmquelle
 * 2.12.2 arrive long after the pass that knew how to carry them, with the mark
 * already set and nothing left to run.
 *
 * It is visible because the pull keeps the audio: the clip is current, the row
 * says „geändert seit der Aufnahme", and reloading the page does not help,
 * since the mark is set there too.
 */

type Kind = 'sammlungen' | 'saetze';
const files: Record<Kind, Map<string, Record<string, unknown>>> = {
  sammlungen: new Map(), saetze: new Map(),
};

vi.mock('../../src/db/folder.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/db/folder.ts')>();
  return {
    ...real,
    isStore: () => true,
    isStale: () => false,
    adopted: async () => true,
    readKind: async (kind: Kind) => [...files[kind].values()],
    pushKind: async () => undefined,
    filePhrase: async () => undefined,
  };
});

const { pullFromFolder } = await import('../../src/db/mirror.ts');
const { allPhrases } = await import('../../src/db/phrases.ts');
const { wipe } = await import('../../src/db/wipe.ts');
const { fingerprint } = await import('../../src/core/ids.ts');
const { OUT } = await import('../../src/core/settings.ts');

const CLOUD = 'azure:de-DE-KatjaNeural';
const VOICE = 'piper:de_DE-thorsten-medium';

/**
 * A cloud name as stimmquelle built it up to and including 2.12.1 — written
 * out rather than asked for, because 2.12.2 appends a term to every `azure:`
 * name and the shorter one cannot be obtained from the live formula again.
 * The same spelling as the one in rekey.test.ts, and deliberately a second
 * copy: a test that asks the code under test what the old name was asserts
 * nothing about it.
 */
async function cloudNameBefore(text: string, voice: string): Promise<string> {
  const payload = JSON.stringify(
    [text.trim(), 'azure', voice.slice(6), null, 3, { rate: OUT.sampleRate }, OUT],
  );
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

/** A sentence in the folder, in the shape folder.ts stores one in. */
function inFolder(item: { id: string; text: string; voice?: string; fingerprint?: string }): void {
  files.saetze.set(item.id, { ...item, slug: item.id, id: `${item.id}.json`, updatedAt: 1 });
}

beforeEach(async () => {
  await wipe();
  files.saetze.clear();
  files.sammlungen.clear();
});

describe('pulling a library in from the folder', () => {
  it('carries a cloud recording across the rename', async () => {
    const text = 'Ich habe Durst.';
    const before = await cloudNameBefore(text, CLOUD);
    // Said out loud: without this the test passes on a library that never
    // needed carrying, because renaming to the name already there looks the
    // same from the outside.
    expect(before).not.toBe(await fingerprint(text, CLOUD));
    inFolder({ id: 'durst', text, voice: CLOUD, fingerprint: before });

    expect(await pullFromFolder()).toBe(true);

    expect((await allPhrases())[0]!.fingerprint).toBe(await fingerprint(text, CLOUD));
  });

  it('leaves a sentence that was already stale exactly as it was', async () => {
    // The load-bearing one, and it has to hold on this path as much as on the
    // other: a text edited after it was recorded carries a name that matches
    // nothing, and that mismatch is a true statement about it.
    inFolder({
      id: 'bett', text: 'Ich will noch nicht ins Bett.', voice: CLOUD,
      fingerprint: await cloudNameBefore('Ich will ins Bett.', CLOUD),
    });

    await pullFromFolder();

    const [item] = await allPhrases();
    expect(item!.fingerprint).toBe(await cloudNameBefore('Ich will ins Bett.', CLOUD));
    expect(item!.fingerprint).not.toBe(await fingerprint(item!.text, CLOUD));
  });

  it('leaves a current recording alone, cloud or piper', async () => {
    const piper = await fingerprint('Ich habe Hunger.', VOICE);
    const cloud = await fingerprint('Ich habe Durst.', CLOUD);
    inFolder({ id: 'hunger', text: 'Ich habe Hunger.', voice: VOICE, fingerprint: piper });
    inFolder({ id: 'durst', text: 'Ich habe Durst.', voice: CLOUD, fingerprint: cloud });

    await pullFromFolder();

    const names = Object.fromEntries((await allPhrases()).map((p) => [p.id, p.fingerprint]));
    expect(names).toEqual({ hunger: piper, durst: cloud });
  });

  it('brings a sentence with no recording through untouched', async () => {
    inFolder({ id: 'neu', text: 'Ganz neu.' });

    await pullFromFolder();

    const [item] = await allPhrases();
    expect(item!.fingerprint).toBeUndefined();
    expect(item!.text).toBe('Ganz neu.');
  });
});
