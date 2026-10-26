import { beforeAll, describe, expect, it } from 'vitest';
import { setLang } from '../../src/i18n/index.ts';
import { sheetNotes, type SheetNotes } from '../../src/ui/penNotes.ts';

/*
 * What the label sheet says about itself.
 *
 * This is printed matter. Nobody reads it until it is on paper with stickers
 * stuck to it, and by then a sentence that is not true has been true-looking
 * for a whole sheet. The one that got through said "der erste Aufkleber ist
 * der Startcode" on a run exported without a start code — correct when it was
 * written, and a lie from the moment the start code became a choice.
 */

const base: SheetNotes = {
  title: 'Wörter', date: '2026-08-29', sentences: 4,
  product: 'Avery Zweckform 6222', per: 88,
  url: 'https://www.avery-zweckform.com/vorlage-6222',
  startCode: true, start: 1, page: 1, pages: 1, stickers: 4,
};
const notes = (over: Partial<SheetNotes> = {}) => sheetNotes({ ...base, ...over });

describe('what a sheet says about itself', () => {
  beforeAll(() => setLang('de'));

  it('claims a start code only when one is printed', () => {
    expect(notes({ startCode: true })[0]).toContain('Startcode');
    expect(notes({ startCode: false })[0]).not.toContain('Startcode');
  });

  it('claims it on the sheet that carries it, and not on the others', () => {
    // One start code per project, on the first sheet. Saying it on sheet two
    // would send somebody hunting for a sticker that is not there.
    expect(notes({ pages: 3, page: 1 })[0]).toContain('Startcode');
    expect(notes({ pages: 3, page: 2 })[0]).not.toContain('Startcode');
  });

  it('says where a part-used sheet was started, and only then', () => {
    expect(notes({ start: 21 })[0]).toContain('ab Position 21');
    expect(notes({ start: 1 })[0]).not.toContain('ab Position');
    // The second sheet begins at its own top, whatever the first one did.
    expect(notes({ start: 21, pages: 2, page: 2 })[0]).not.toContain('ab Position');
  });

  it('counts one sentence as one', () => {
    // "1 Sätze" is the same defect in a smaller coat.
    expect(notes({ sentences: 1 })[0]).toContain('1 Satz');
    expect(notes({ sentences: 1 })[0]).not.toContain('1 Sätze');
  });

  it('names the paper and gives an address that can be typed', () => {
    const paper = notes()[1];
    expect(paper).toContain('Avery Zweckform 6222');
    expect(paper).toContain('avery-zweckform.com/vorlage-6222');
    expect(paper).not.toContain('https://');
  });

  it('names the stickers when they outnumber the sentences', () => {
    /* Thirty cards out of ten words. "10 Sätze" alone on a sheet of thirty
       stickers reads as a sheet printed wrong, and the person at the printer
       has nothing else to check it against. */
    expect(notes({ sentences: 10, stickers: 30 })[0]).toContain('10 Sätze');
    expect(notes({ sentences: 10, stickers: 30 })[0]).toContain('30 Aufkleber');
    // One each is the ordinary case and says nothing worth the room. Matched
    // with the number, because the start code's own line says "Aufkleber" too.
    expect(notes({ sentences: 10, stickers: 10 })[0]).not.toContain('10 Aufkleber');
    expect(notes({ sentences: 1, stickers: 1 })[0]).not.toContain('1 Aufkleber');
  });

  it('says it on the first sheet, where the counts are', () => {
    expect(notes({ sentences: 10, stickers: 30, pages: 2, page: 1 })[0])
      .toContain('30 Aufkleber');
    expect(notes({ sentences: 10, stickers: 30, pages: 2, page: 2 })[0])
      .not.toContain('30 Aufkleber');
  });
});
