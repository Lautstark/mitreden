/* What mitreden does with what the address asked for.
 *
 * The id check is not here. It is `@lautstark/werkzeuge/sammlung`'s, with its
 * own tests, because vorlaut reads the same links and a regex nobody tests is a
 * regex somebody relaxes. What is left is mitreden's half: four answers, and
 * only one of them touching the library.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const wanted = vi.hoisted(() => vi.fn());
const importFile = vi.hoisted(() => vi.fn());
const say = vi.hoisted(() => vi.fn());
const busy = vi.hoisted(() => vi.fn());

vi.mock('@lautstark/werkzeuge/sammlung', () => ({ wanted }));
vi.mock('../../src/ui/settings.ts', () => ({ importFile }));
vi.mock('../../src/ui/dom.ts', () => ({ say, busy }));
vi.mock('../../src/i18n/index.ts', () => ({ t: (key: string) => key }));

const { openNamed } = await import('../../src/ui/shelf.ts');

const HERE = 'https://lautstark.github.io/mitreden/?sammlung=spiegel-und-ei';

describe('a Sammlung the address named', () => {
  beforeEach(() => {
    wanted.mockReset();
    importFile.mockReset();
    say.mockReset();
    busy.mockReset();
  });

  it('says nothing at all when the address named none', async () => {
    wanted.mockResolvedValue({ kind: 'none' });
    await openNamed(HERE);
    expect(say).not.toHaveBeenCalled();
    expect(importFile).not.toHaveBeenCalled();
  });

  it('says an entry is not there, and touches nothing', async () => {
    wanted.mockResolvedValue({ kind: 'unknown', id: 'weg-damit' });
    await openNamed(HERE);
    expect(say).toHaveBeenLastCalledWith('shelf_unknown');
    expect(importFile).not.toHaveBeenCalled();
  });

  it('tells a shelf it could not reach apart from an entry that is gone', async () => {
    wanted.mockResolvedValue({ kind: 'offline', id: 'x', error: new Error('nope') });
    await openNamed(HERE);
    expect(say).toHaveBeenLastCalledWith('shelf_offline');
    expect(importFile).not.toHaveBeenCalled();
  });

  /* One import, two doors. The file goes to the same function „Sammlung
     einlesen" uses, which is what keeps the two saying the same things. */
  it('hands the file to the one importer there is', async () => {
    const file = new File(['{"sentences":[]}'], 'spiegel-und-ei.json');
    wanted.mockResolvedValue({ kind: 'file', id: 'spiegel-und-ei', file });

    await openNamed(HERE);

    expect(busy).toHaveBeenCalledWith('shelf_fetching');
    expect(importFile).toHaveBeenCalledWith(file);
  });
});
