import { beforeEach, describe, expect, it } from 'vitest';
import { allCollections, wipe } from '../../src/db/db.ts';
import { createCollection, renameCollection } from '../../src/db/repo.ts';

/**
 * That a Sammlung's identity is its own, and not its name.
 *
 * conventions.md §1.1. The rule reads like housekeeping until you look at what
 * the derived version actually did: the id was `normTag(name)` — the name
 * slugged and cut to 24 characters — and `createCollection`, given a name,
 * looked that key up and handed back whatever it found. So two names agreeing
 * for 24 characters were one Sammlung.
 *
 * That is reachable from the interface, and by the one path where the names are
 * not the person's own: importing a file names the Sammlung after the file
 * (ui/settings.ts). Import two exports of the same evening and the second one's
 * sentences went into the first one's Sammlung, with no error, no warning, and
 * nothing on screen except a count that had grown. The file was read correctly
 * and the sentences were all saved — they were merely saved somewhere nobody
 * asked for, and the only way back was to know which ones had arrived.
 *
 * The first test here is that collision, at the exact width it happened at.
 */

beforeEach(() => wipe());

const NAMES_COLLIDING_AT_24 = [
  'Sammlung vom Kindergarten Montag',
  'Sammlung vom Kindergarten Dienstag',
];

describe('a Sammlung is identified by a minted id', () => {
  it('makes two, not one, when two names slug alike for 24 characters', async () => {
    // Both reduce to "sammlung-vom-kindergarten" before the cut, so the old
    // normTag gave them one key and the second create returned the first.
    const [a, b] = await Promise.all(
      NAMES_COLLIDING_AT_24.map((name) => createCollection(name, true)),
    );

    expect(a!.id).not.toBe(b!.id);
    expect((await allCollections()).length).toBe(2);
    expect((await allCollections()).map((c) => c.name).sort())
      .toEqual([...NAMES_COLLIDING_AT_24].sort());
  });

  it('never hands back a Sammlung that already exists', async () => {
    // The old code did exactly this for a named call, which is what made the
    // collision silent rather than merely wrong.
    const first = await createCollection('Küche', true);
    const second = await createCollection('Küche', true);

    expect(second.id).not.toBe(first.id);
    expect((await allCollections()).length).toBe(2);
  });

  it('mints an id that is not made out of the name', async () => {
    const made = await createCollection('Küche', true);
    expect(made.id).not.toContain('kueche');
    expect(made.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('keeps its id through a rename, because renaming is not making', async () => {
    // The property the derived key could not have: the name is a live input
    // (§1.6), so an id made out of it either goes stale on every keystroke or
    // has to be frozen on purpose.
    const made = await createCollection('Küche', true);
    await renameCollection(made.id, 'Bei Oma');

    const held = await allCollections();
    expect(held.length).toBe(1);
    expect(held[0]!.id).toBe(made.id);
    expect(held[0]!.name).toBe('Bei Oma');
  });

  it('numbers only the name it offers, and only when nobody supplied one', async () => {
    // §1.5 is about the suggestion, not about uniqueness: two Sammlungen may
    // genuinely share a name, and the identity is never the name.
    const first = await createCollection(null, true);
    const second = await createCollection(null, true);

    expect(first.name).not.toBe(second.name);
    expect(second.name).toMatch(/\(2\)$/);
  });
});
