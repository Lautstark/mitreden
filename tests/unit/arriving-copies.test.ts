import { describe, expect, it } from 'vitest';
import { readFile } from '../../src/ui/settings.ts';

/**
 * How many stickers a sentence arrives wanting.
 *
 * bildhaft does not write a number. It writes the game: a Spiel's cards are
 * rows of its Sammlung, held once however often they are laid out — the same
 * rule a Lied follows for its lines — and the repetition lives in the
 * Spielblatt, `collection.game`, as a cell per card. So a game of thirty cards
 * made of ten words exports as ten sentences and thirty cells, and the count
 * this product needs is a tally of that board.
 *
 * Which is why this is read here rather than asked for over there. The number
 * was already in the file; nothing in bildhaft has to be changed for a Spiel to
 * arrive with the right stickers, and a file somebody exported last month
 * carries it too.
 */

const game = (rows: string[][]) => ({
  format: 'bildhaft.collection',
  version: 1,
  collection: {
    id: 'c1',
    name: 'Tiere im Wald',
    game: { rows: rows.map((cards, i) => ({
      id: `r${i}`,
      zellen: cards.map((karte) => ({ karte, platz: true })),
    })) },
  },
  sentences: [
    { id: 's1', rawInput: 'Fuchs', slots: [], collectionId: 'c1' },
    { id: 's2', rawInput: 'Eule', slots: [], collectionId: 'c1' },
  ],
  notice: '',
});

/** Text and count, which is all this is about. */
const counted = (data: unknown) => readFile(data).lines.map((line) =>
  [typeof line === 'string' ? line : line.text,
    typeof line === 'string' ? undefined : line.copies] as const);

describe('a Spiel arriving from bildhaft', () => {
  it('counts the cards on the board, not the sentences in the file', () => {
    expect(counted(game([['s1', 's2', 's1'], ['s1', 's2']])))
      .toEqual([['Fuchs', 3], ['Eule', 2]]);
  });

  it('leaves a card laid once without a number at all', () => {
    // Absent is the ordinary case and the one that writes no field — see
    // Phrase.copies. A 1 here would put a number on every sentence of every
    // file that ever arrives.
    expect(counted(game([['s1', 's2']]))).toEqual([['Fuchs', undefined], ['Eule', undefined]]);
  });

  it('reads the older row, which named its cards without cells', () => {
    /* `zellen` replaced `fest`/`karten`, and bildhaft still reads those on a
       record written before the change — so a file exported from one does too.
       One row's cards are in one shape or the other, never counted twice. */
    const old = game([['s1']]);
    old.collection.game.rows = [{ id: 'r0', fest: ['s1'], karten: ['s1', 's2'] }] as never;
    expect(counted(old)).toEqual([['Fuchs', 2], ['Eule', undefined]]);
  });

  it('takes a count the file states outright over the board', () => {
    // Nothing writes this yet. It is two lines and it is the door bildhaft
    // walks through the day a card wants a number of its own.
    const stated = game([['s1', 's1']]);
    stated.sentences[0] = { ...stated.sentences[0], copies: 9 } as never;
    expect(counted(stated)).toEqual([['Fuchs', 9], ['Eule', undefined]]);
  });

  it('ignores a board that names nothing this file holds', () => {
    // A file whose game points at cards that are not in it is not an error:
    // the sentences are what arrive, and they arrive once each.
    expect(counted(game([['weg', 'weg']]))).toEqual([['Fuchs', undefined], ['Eule', undefined]]);
  });

  it('reads a plain list as it always did', () => {
    expect(counted(['Fuchs', 'Eule'])).toEqual([['Fuchs', undefined], ['Eule', undefined]]);
  });
});
