import { describe, expect, it } from 'vitest';
import { CAPACITY, penProject, SHEET, type PenAudio } from '../../src/core/anybook.ts';

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

  it('refuses more sentences than a sheet holds', () => {
    // Silently dropping the tail would produce a sheet that looks finished.
    expect(() => penProject('Test', audio(CAPACITY))).not.toThrow();
    expect(() => penProject('Test', audio(CAPACITY + 1))).toThrow(/holds/);
    expect(() => penProject('Test', [])).toThrow(/at least one/);
  });
});
