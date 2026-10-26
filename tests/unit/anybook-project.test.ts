import { describe, expect, it } from 'vitest';
import {
  cells, circlesUsed, penProject, perSheet, SHEETS, sheetsFor, sheetsUsed,
  type PenAudio,
} from '../../src/core/anybook.ts';

const SHEET = SHEETS['6222'];

/*
 * What an Anybook project has to get right that nothing else would notice.
 *
 * Studio opens a malformed project as readily as a good one and simply shows
 * fewer codes, or codes bound to nothing, or codes a few millimetres off the
 * labels. None of that raises an error and all of it is only visible on paper,
 * after the stickers are printed and stuck — which is the worst place to find
 * out that sentence forty is under sentence thirty-nine's circle.
 *
 * So the checks here are the ones the eye cannot make: that every sentence
 * reached the archive, that each code names its own file, and that the grid is
 * the grid measured off Avery's template rather than one that has drifted a
 * refactor at a time.
 */

/** Stored entries only, which is what core/zip.ts writes. */
async function entries(blob: Blob): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const found = new Map<string, Uint8Array>();
  let at = 0;
  while (at + 4 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const start = at + 30 + nameLength + extraLength;
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    found.set(name, bytes.subarray(start, start + size));
    at = start + size;
  }
  return found;
}

const audio = (n: number): PenAudio[] => Array.from({ length: n }, (_, i) => ({
  name: `satz-${i}.mp3`,
  bytes: new Uint8Array([0xff, 0xfb, i & 0xff]),
  caption: `Satz ${i}`,
}));

const projectOf = async (blob: Blob) =>
  JSON.parse(new TextDecoder().decode((await entries(blob)).get('_Project_.json')!));

describe('an Anybook project', () => {
  it('carries every sentence, each code naming its own file', async () => {
    const blob = penProject('Test', audio(12));
    const inside = await entries(blob);
    for (let i = 0; i < 12; i++) expect(inside.has(`satz-${i}.mp3`)).toBe(true);

    const project = await projectOf(blob);
    // Twelve sentences and the activation code that leads them.
    expect(project.Codes).toHaveLength(13);
    expect(project.AudioFiles).toHaveLength(12);
    expect(project.Codes.slice(1).map((c: { AudioFileName: string }) => c.AudioFileName))
      .toEqual(audio(12).map((a) => a.name));
  });

  it('reserves the first sticker for an activation code', async () => {
    /*
     * Type 0, no audio of its own. Without it the sheet only ever works on the
     * one pen it was transferred to — which is invisible until the day there is
     * a second pen, and by then the stickers are stuck down.
     */
    const project = await projectOf(penProject('Test', audio(2)));
    expect(project.Codes[0]).toMatchObject({
      Type: 0, AudioFileName: '', HasAudioFileName: false, CodeNr: 0,
    });
    expect(project.Codes.slice(1).every((c: { Type: number }) => c.Type === 1)).toBe(true);
    // And it sits on the first circle, so the sentences begin on the second.
    const first = SHEET.originX + SHEET.diameter / 2 - 5;
    expect(project.Codes[0].X).toBeCloseTo(first / 10, 3);
    expect(project.Codes[1].X).toBeCloseTo((first + SHEET.pitch) / 10, 3);
  });

  it('leaves the numbering to Studio', async () => {
    // The ids are handed out at transfer. Inventing them here would be
    // claiming code numbers that belong to somebody else's book.
    const project = await projectOf(penProject('Test', audio(3)));
    expect(project.Codes.every((c: { CodeNr: number }) => c.CodeNr === 0)).toBe(true);
    expect(project.PenPackage.ActivationCode).toBe(0);
    expect(project.PenPackage.Audios).toEqual([]);
  });

  it('puts the first code on the first label, corner-anchored', async () => {
    const project = await projectOf(penProject('Test', audio(2)));
    // Centimetres, and the code's top-left rather than its centre: Studio
    // draws it down and right from the point it is given.
    const centre = { x: SHEET.originX + SHEET.diameter / 2, y: SHEET.originY + SHEET.diameter / 2 };
    expect(project.Codes[1].X).toBeCloseTo((centre.x + SHEET.pitch - 5) / 10, 3);
    expect(project.Codes[1].Y).toBeCloseTo((centre.y - 5) / 10, 3);
    // The next sits one pitch further right and on the same line.
    expect(project.Codes[2].X).toBeCloseTo((centre.x + 2 * SHEET.pitch - 5) / 10, 3);
    expect(project.Codes[2].Y).toBeCloseTo(project.Codes[1].Y, 6);
  });

  it('claims the pen rate rather than letting Studio convert again', async () => {
    const project = await projectOf(penProject('Test', audio(1)));
    expect(project.AudioFiles[0].IsPipelineCompliant).toBe(true);
  });

  it('prints the punctuation German is written with', async () => {
    // Found on paper: the ellipsis this truncates with came out as `?`, and so
    // would have every „quoted“ sentence and every en–dash.
    const long = 'Du glaubst an mich und das ist schön';
    const blob = penProject('Test', [{ ...audio(1)[0], caption: `${long} „ja“ – wirklich` }]);
    // Bytes, not a decoded string: every decoder that claims 'latin1' is really
    // windows-1252 and maps 0x85 back to the ellipsis, which would pass whether
    // or not the encoder did its job.
    const pdf = (await entries(blob)).get('Test.pdf')!;
    expect(pdf.includes(0x85)).toBe(true);      // the ellipsis, as WinAnsi writes it
    expect(pdf.includes(0x3f)).toBe(false);     // and nothing fell off the map
  });

  it('runs a Sammlung past one sheet onto the next', async () => {
    /*
     * 96 sentences is where this was found, by somebody who had them. Refusing
     * at 87 was this module's limit and never the format's: PageNo sits on
     * every code and Studio has always read it.
     *
     * The seam is what the test is for. Only the first sheet spends a circle on
     * the activation code, so sentence 88 is the last on sheet one and 89 is
     * the first on sheet two, back at the top-left corner.
     */
    const project = await projectOf(penProject('Test', audio(96)));
    expect(sheetsFor(SHEET, 96)).toBe(2);
    expect(project.PdfPageCount).toBe(2);
    expect(project.Codes).toHaveLength(97);

    const pages = project.Codes.map((c: { PageNo: number }) => c.PageNo);
    expect(pages.filter((p: number) => p === 1)).toHaveLength(88);
    expect(pages.filter((p: number) => p === 2)).toHaveLength(9);

    // The first code of sheet two sits where the activation code sits on sheet
    // one: the top-left circle, not carried on from where sheet one stopped.
    const corner = (SHEET.originX + SHEET.diameter / 2 - 5) / 10;
    expect(project.Codes[88].PageNo).toBe(2);
    expect(project.Codes[88].X).toBeCloseTo(corner, 3);
    expect(project.Codes[88].Y).toBeCloseTo(project.Codes[0].Y, 6);
    // And it is a sentence, not a second activation code.
    expect(project.Codes[88].Type).toBe(1);
    expect(project.Codes.filter((c: { Type: number }) => c.Type === 0)).toHaveLength(1);
  });

  it('fills exactly one sheet at the boundary and two just past it', () => {
    expect(sheetsFor(SHEET, perSheet(SHEET))).toBe(1);
    expect(sheetsFor(SHEET, perSheet(SHEET) + 1)).toBe(2);
    expect(() => penProject('Test', [])).toThrow(/at least one/);
  });

  it('lays the small sheet out on its own grid, and bare', async () => {
    /*
     * L6019 is 315 labels of 10 mm, so a Sammlung that needed two sheets of
     * 6222 fits on one of these — and 2.7 mm of gutter is not enough type for
     * anyone to read while peeling, so it goes out without captions. Both facts
     * come from the sheet rather than from this module knowing about products.
     */
    const small = SHEETS.L6019;
    expect(perSheet(small)).toBe(314);
    expect(sheetsFor(small, 96)).toBe(1);

    const blob = penProject('Test', audio(96), { sheet: small });
    const project = await projectOf(blob);
    expect(project.PdfPageCount).toBe(1);
    expect(project.Codes).toHaveLength(97);
    expect(project.Codes.every((c: { PageNo: number }) => c.PageNo === 1)).toBe(true);

    // Its own grid: the first circle's centre, less the code's half-width.
    expect(project.Codes[0].X).toBeCloseTo((small.originX + small.diameter / 2 - 5) / 10, 3);
    expect(project.Codes[1].X)
      .toBeCloseTo((small.originX + small.pitch + small.diameter / 2 - 5) / 10, 3);

    // Bare: no caption text reaches the page.
    const pdf = (await entries(blob)).get('Test.pdf')!;
    expect(new TextDecoder('latin1').decode(pdf)).not.toContain('Satz 1');
  });

  it('starts where a part-used sheet has room left', async () => {
    /*
     * The case this exists for: twenty stickers came off for something else and
     * sixty-eight are still good. Starting at circle one would print onto
     * backing paper and waste every one of them.
     */
    const project = await projectOf(penProject('Test', audio(3), { start: 21 }));
    const grid = cells(SHEET);
    const corner = (p: { x: number; y: number }) => (p.x - 5) / 10;
    // The activation code takes the first circle of the run, not of the sheet.
    expect(project.Codes[0].Type).toBe(0);
    expect(project.Codes[0].X).toBeCloseTo(corner(grid[20]), 3);
    expect(project.Codes[1].X).toBeCloseTo(corner(grid[21]), 3);
    // And nothing is written onto the twenty already gone: four captions are
    // drawn, one per circle this run touches, not twenty-four.
    const pdf = (await entries(penProject('Test', audio(3), { start: 21 }))).get('Test.pdf')!;
    const drawn = new TextDecoder('latin1').decode(pdf).match(/BT \/F1 5 Tf/g) ?? [];
    expect(drawn).toHaveLength(4);
  });

  it('can leave the start code off, for a sheet that already carries one', async () => {
    const project = await projectOf(penProject('Test', audio(4), { startCode: false, start: 5 }));
    expect(project.Codes).toHaveLength(4);
    expect(project.Codes.every((c: { Type: number }) => c.Type === 1)).toBe(true);
    // The first sentence takes the first free circle itself.
    expect(project.Codes[0].X).toBeCloseTo((cells(SHEET)[4].x - 5) / 10, 3);
  });

  it('prints one sticker per copy, and carries the audio once', async () => {
    /*
     * The Klettspiel case: thirty cards, ten words. Every card wants a sticker
     * of its own and all the cards of one word have to say the same thing — so
     * the number multiplies the circles and not the recordings. A second zip
     * entry under the same name would be a second copy of the same mp3 in the
     * archive, and a second AudioFiles row would have Studio transcode it
     * twice.
     */
    const blob = penProject('Test', [
      { ...audio(1)[0], name: 'fuchs.mp3', caption: 'Fuchs', copies: 4 },
      { ...audio(1)[0], name: 'eule.mp3', caption: 'Eule', copies: 3 },
    ]);
    const inside = await entries(blob);
    expect([...inside.keys()].filter((name) => name.endsWith('.mp3')))
      .toEqual(['fuchs.mp3', 'eule.mp3']);

    const project = await projectOf(blob);
    expect(project.AudioFiles.map((f: { FileName: string }) => f.FileName))
      .toEqual(['fuchs.mp3', 'eule.mp3']);
    // Seven stickers and the activation code, the copies of one word together.
    expect(project.Codes.map((c: { AudioFileName: string }) => c.AudioFileName)).toEqual([
      '', 'fuchs.mp3', 'fuchs.mp3', 'fuchs.mp3', 'fuchs.mp3',
      'eule.mp3', 'eule.mp3', 'eule.mp3',
    ]);
    // Each one on its own circle, left to right.
    const grid = cells(SHEET);
    project.Codes.forEach((code: { X: number }, i: number) => {
      expect(code.X).toBeCloseTo((grid[i].x - 5) / 10, 3);
    });
  });

  it('writes the word under every copy of it', async () => {
    // The sheet is read while it is peeled, so a circle with no word under it
    // is a sticker nobody can place. Four copies, four captions.
    const blob = penProject('Test', [{ ...audio(1)[0], caption: 'Fuchs', copies: 4 }]);
    const pdf = (await entries(blob)).get('Test.pdf')!;
    const page = new TextDecoder('latin1').decode(pdf);
    expect(page.match(/\(Fuchs\)/g) ?? []).toHaveLength(4);
    // Plus the activation code's own word: five circles are written on.
    expect(page.match(/BT \/F1 5 Tf/g) ?? []).toHaveLength(5);
  });

  it('counts the copies when it runs out of paper, not the sentences', async () => {
    // Ten sentences of nine copies is ninety stickers, which is past what one
    // sheet of 88 holds however few sentences it came from.
    const many = audio(10).map((one) => ({ ...one, copies: 9 }));
    const project = await projectOf(penProject('Test', many));
    expect(project.Codes).toHaveLength(91);
    expect(project.PdfPageCount).toBe(2);
    expect(project.Codes.filter((c: { PageNo: number }) => c.PageNo === 1)).toHaveLength(88);
  });

  it('treats an absent or spoilt count as one sticker', async () => {
    // Absent is the ordinary case and must stay cheap to write. The rest are
    // what a file from somewhere else can hold: a count is a number of
    // stickers, so nothing below one is printable.
    const odd = [
      { ...audio(1)[0], name: 'a.mp3', caption: 'a' },
      { ...audio(1)[0], name: 'b.mp3', caption: 'b', copies: 0 },
      { ...audio(1)[0], name: 'c.mp3', caption: 'c', copies: -2 },
      { ...audio(1)[0], name: 'd.mp3', caption: 'd', copies: 2.6 },
    ];
    const project = await projectOf(penProject('Test', odd));
    expect(project.Codes.map((c: { AudioFileName: string }) => c.AudioFileName))
      .toEqual(['', 'a.mp3', 'b.mp3', 'c.mp3', 'd.mp3', 'd.mp3']);
  });

  it('says how much paper a run takes from where it starts', () => {
    /*
     * What the dialog has to be able to say before anything is encoded, and
     * what the message after it says. The old arithmetic counted sentences on
     * a fresh sheet: it ignored `start`, so a run beginning at circle 80 of 88
     * claimed one sheet and printed two.
     */
    expect(circlesUsed(30, true, 1)).toBe(31);
    expect(circlesUsed(30, false, 1)).toBe(30);
    expect(circlesUsed(30, true, 12)).toBe(42);

    expect(sheetsUsed(SHEET, 88)).toBe(1);
    expect(sheetsUsed(SHEET, 89)).toBe(2);
    // One sentence on the last circle of a sheet is one sheet, not two.
    expect(sheetsUsed(SHEET, circlesUsed(1, false, 88))).toBe(1);
    // And the run that used to lie: ten stickers from circle 80.
    expect(sheetsUsed(SHEET, circlesUsed(10, false, 80))).toBe(2);
    // Nothing printed is still a sheet, because the dialog has to say a number.
    expect(sheetsUsed(SHEET, 0)).toBe(1);
  });

  it('refuses a circle the sheet does not have', () => {
    expect(() => penProject('Test', audio(1), { start: 89 })).toThrow(/no circle/);
    expect(() => penProject('Test', audio(1), { start: 0 })).toThrow(/no circle/);
  });
});
