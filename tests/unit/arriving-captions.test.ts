import { describe, expect, it } from 'vitest';
import { readFile } from '../../src/ui/settings.ts';

/**
 * Where a Spiel card's word is, when nobody typed one.
 *
 * bildhaft's Spiel cards are made in the symbol picker: their rawInput is an
 * empty string, and the word stands in the one slot's caption — or, where the
 * caption was never touched, in the token that found the symbol. A file of
 * such cards used to arrive empty, every sentence skipped as blank, which is
 * the quietest way for an import to fail: no error, just nothing.
 *
 * So reading one falls back, rawInput → caption → sourceToken, taking the
 * first that says anything. A sentence somebody typed still carries its
 * rawInput and wins as before.
 */

const spiel = (sentences: object[]) => ({
  format: 'bildhaft.collection',
  version: 1,
  collection: { id: 'c1', name: 'Memory Tiere' },
  sentences: sentences.map((fields, i) => ({ id: `s${i}`, collectionId: 'c1', ...fields })),
  notice: '',
});

const words = (data: unknown) => readFile(data).lines.map((line) =>
  typeof line === 'string' ? line : line.text);

describe('a picked card arriving from bildhaft', () => {
  it('reads the word from the slot caption when rawInput is empty', () => {
    expect(words(spiel([
      { rawInput: '', slots: [{ caption: 'Fuchs', sourceToken: 'fuchs' }] },
      { rawInput: '', slots: [{ caption: 'Eule', sourceToken: 'eule' }] },
    ]))).toEqual(['Fuchs', 'Eule']);
  });

  it('falls back to the token that found the symbol when the caption is blank', () => {
    expect(words(spiel([
      { rawInput: '', slots: [{ caption: '  ', sourceToken: 'Igel' }] },
    ]))).toEqual(['Igel']);
  });

  it('keeps a typed sentence on its rawInput, caption or no caption', () => {
    expect(words(spiel([
      { rawInput: 'der rote Fuchs', slots: [{ caption: 'Fuchs' }] },
    ]))).toEqual(['der rote Fuchs']);
  });

  it('still skips a card that says nothing anywhere', () => {
    // Blank all the way down is what "skip the empty ones" always meant;
    // the fallback widens where a word may be, not what counts as one.
    expect(words(spiel([
      { rawInput: '', slots: [{ caption: ' ', sourceToken: '' }] },
      { rawInput: '', slots: [] },
      { rawInput: '' },
      { rawInput: '', slots: [{ caption: 'Hase' }] },
    ]))).toEqual(['Hase']);
  });

  it('counts a picked card on the board like any other', () => {
    // The two readings meet in one file: the word from the slot, the sticker
    // count from the Spielblatt — a Klettspiel is both at once.
    const data = {
      ...spiel([{ rawInput: '', slots: [{ caption: 'Fuchs' }] }]),
      collection: {
        id: 'c1',
        name: 'Memory Tiere',
        game: { rows: [{ id: 'r0', zellen: [{ karte: 's0' }, { karte: 's0' }] }] },
      },
    };
    expect(readFile(data).lines).toEqual([{ text: 'Fuchs', voice: undefined, copies: 2 }]);
  });
});
