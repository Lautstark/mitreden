/**
 * A Sammlung as a project the Anybook Pro understands.
 *
 * The pen is not a disk. It enumerates as a serial bridge and takes its audio
 * over a framed protocol that Anybook Studio speaks and this page does not, so
 * the last step of getting a sentence onto it belongs to Studio and will for as
 * long as that protocol is undocumented. What does not belong to Studio is
 * everything before it: which sentence sits under which sticker, where the
 * stickers are on the sheet, and what the audio is encoded as. Placing sixty
 * codes by hand and binding each to its file is the afternoon this module
 * exists to delete.
 *
 * So the output is an `.abs` — a plain zip holding the page, a thumbnail, the
 * mp3s and `_Project_.json` — which Studio opens as its own. It carries the
 * codes already positioned and already bound. Studio numbers them, because the
 * numbers are handed out when it transfers and not before: every code here
 * leaves with `CodeNr: 0` and comes back with an id the pen knows.
 *
 * The shape of that file was read off a project Studio wrote, and every field
 * below survived a round trip through it unchanged.
 */

import { zip, type ZipEntry } from './zip.ts';

/** One kind of label sheet: its grid, and what to call it on the page. */
export interface Sheet {
  /** What the export is asked for, and what a saved choice remembers. */
  id: string;
  /** Named on the printed sheet, so more can be bought without going looking. */
  product: string;
  /** Short enough for a menu: `Ø 20 mm · 6222`. */
  label: string;
  /** Avery's own page for it, so more paper can be bought without hunting. */
  url: string;
  width: number; height: number;     // the page, mm
  cols: number; rows: number;
  diameter: number;
  pitch: number;
  originX: number; originY: number;  // to the first label's left and top edge
  /**
   * Whether a word is printed under each circle.
   *
   * It needs a gutter to sit in. 6222 leaves 4 mm between labels and a caption
   * is legible there; L6019 leaves 2.7 mm, which is not enough for type anyone
   * could read while peeling. So that sheet goes out bare and the order of the
   * stickers is the only thing that says which is which.
   */
  captions: boolean;
}

/**
 * The sheets this can print, both measured out of Avery's own Word template
 * rather than their spec pages, which give the diameter and the count and not
 * the grid.
 *
 * Each origin is checked against the other margin before it is believed. A
 * die-cut sheet is symmetric, so if the numbers put more paper on one side than
 * the other, the numbers are wrong — which is exactly what 6222 did for a while,
 * and the printed sheet came out 6 mm high before anyone noticed the tell.
 *
 * What is left is a printer's own drift, which no template can answer.
 */
export const SHEETS: Record<string, Sheet> = {
  /*
   * 88 round labels, 20 mm across, eight by eleven.
   *
   * originY is not the 12.33 the template appears to say. Each label sits in a
   * floating table whose vertical offset — 699 twips, 12.33 mm — is anchored to
   * the text body and not to the page: `vertAnchor="text"`. The body starts at
   * the top margin, 345 twips, 6.09 mm, and that has to be added back. Corrected
   * it leaves 18.42 mm of paper above the first row and 18.58 below the last.
   */
  '6222': {
    id: '6222',
    product: 'Avery Zweckform 6222',
    label: 'Ø 20 mm · 6222',
    url: 'https://www.avery-zweckform.com/vorlage-6222',
    width: 210, height: 297,
    cols: 8, rows: 11,
    diameter: 20,
    pitch: 24,
    originX: 12.01, originY: 18.42,
    captions: true,
  },
  /*
   * 315 round labels, 10 mm across, fifteen by twenty-one.
   *
   * This one Avery publishes only as binary Word, which no converter here reads
   * — so the numbers come from the OLE `Data` stream itself: 21 table
   * definitions of 29 cells, alternating a 566 twip label with a 153 twip
   * gutter. 566 is 9.984 mm and 566 + 153 is a pitch of 12.682, the same on
   * both axes because round labels tile square.
   *
   * The origin is the page's left margin, 715 twips, plus the table's own
   * -76 twip inset: 11.27 mm. It leaves 11.19 mm on the right, which is the
   * symmetry check passing.
   */
  L6019: {
    id: 'L6019',
    product: 'Avery Zweckform L6019',
    label: 'Ø 10 mm · L6019',
    url: 'https://www.avery-zweckform.com/vorlage-l6019',
    width: 210, height: 297,
    cols: 15, rows: 21,
    diameter: 9.984,
    pitch: 12.682,
    originX: 11.27, originY: 16.42,
    captions: false,
  },
};

/** What an export uses when nobody has said otherwise. */
export const DEFAULT_SHEET = '6222';

/**
 * Studio anchors a code by its top-left corner and draws it about 10 mm wide,
 * so a code written at a label's centre lands low and to the right by half of
 * that. Found by placing two and looking: at the centre they sat visibly off,
 * and at centre-minus-five they sat in the middle.
 */
const CODE = 10;

/** Every circle on one sheet of this kind. */
const cellCount = (sheet: Sheet): number => sheet.cols * sheet.rows;

/**
 * How many sentences fit on one sheet, the activation code having taken the
 * first circle of the first one.
 *
 * One sticker, and it buys the sheet the right to exist on more than one pen.
 * Without an activation code the audio is welded to whichever pen it was
 * transferred to — Studio says as much when it finds none, and it is the kind
 * of thing that costs nothing today and costs a reprint of the whole sheet the
 * day a pen is lost, broken, or wanted at kindergarten as well as at home.
 */
export const perSheet = (sheet: Sheet): number => cellCount(sheet) - 1;

/**
 * How many sheets a Sammlung of this size needs.
 *
 * A Sammlung outgrows one sheet the moment it passes what one holds, and
 * refusing at that line was this module's own limitation and never the
 * format's: a project carries PageNo on every code and PdfPageCount beside
 * them, and Studio has always read multi-page material. Only the first sheet
 * loses a circle to the activation code, so the ones after it are full.
 */
export const sheetsFor = (sheet: Sheet, sentences: number): number =>
  Math.max(1, Math.ceil((sentences + 1) / cellCount(sheet)));

/** One sticker: the audio it plays and the word printed under it. */
export interface PenAudio {
  /** The name inside the archive, and what `Codes[].AudioFileName` points at. */
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  /** Printed under the circle, so a sheet can be read while it is peeled. */
  caption: string;
}

const MM = 72 / 25.4;

/** Every label position, left to right then down, in mm from the top left. */
export function cells(sheet: Sheet): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let row = 0; row < sheet.rows; row++)
    for (let col = 0; col < sheet.cols; col++)
      out.push({
        x: sheet.originX + col * sheet.pitch + sheet.diameter / 2,
        y: sheet.originY + row * sheet.pitch + sheet.diameter / 2,
      });
  return out;
}

/**
 * Where the nth code goes, counting the activation code as the first and
 * running on across sheets. PageNo is 1-based because Studio's is.
 */
function slot(sheet: Sheet, grid: { x: number; y: number }[], n: number):
{ page: number; x: number; y: number } {
  const { x, y } = grid[n % cellCount(sheet)];
  return { page: Math.floor(n / cellCount(sheet)) + 1, x, y };
}

// ------------------------------------------------------------------- pdf
//
// Written by hand for the same reason zip.ts is: one page of circles and
// five-point text is not worth a dependency, and this is the only PDF the
// program makes.

/** A circle as four Béziers. y arrives measured from the top and flips here. */
function circle(sheet: Sheet, cx: number, cy: number, r: number): string {
  const k = 0.5523 * r * MM;
  const x = cx * MM, y = (sheet.height - cy) * MM, rr = r * MM;
  return `${(x + rr).toFixed(3)} ${y.toFixed(3)} m `
    + `${(x + rr).toFixed(3)} ${(y + k).toFixed(3)} ${(x + k).toFixed(3)} ${(y + rr).toFixed(3)} ${x.toFixed(3)} ${(y + rr).toFixed(3)} c `
    + `${(x - k).toFixed(3)} ${(y + rr).toFixed(3)} ${(x - rr).toFixed(3)} ${(y + k).toFixed(3)} ${(x - rr).toFixed(3)} ${y.toFixed(3)} c `
    + `${(x - rr).toFixed(3)} ${(y - k).toFixed(3)} ${(x - k).toFixed(3)} ${(y - rr).toFixed(3)} ${x.toFixed(3)} ${(y - rr).toFixed(3)} c `
    + `${(x + k).toFixed(3)} ${(y - rr).toFixed(3)} ${(x + rr).toFixed(3)} ${(y - k).toFixed(3)} ${(x + rr).toFixed(3)} ${y.toFixed(3)} c S\n`;
}

/**
 * A label's word, in the gutter under its circle.
 *
 * Under rather than inside, and that is the decision: 4 mm of backing paper
 * separate one label from the next, so a caption there is readable while the
 * sheet is being peeled and is not on the sticker once it is stuck. A sticker
 * carrying its own text would be a sticker you cannot put on a photograph.
 */
function caption(sheet: Sheet, cx: number, cy: number, text: string): string {
  const cut = text.length > 16 ? `${text.slice(0, 15)}…` : text;
  const width = cut.length * 1.35;                 // Helvetica at 5pt, near enough
  const x = (cx - width / 2) * MM;
  const y = (sheet.height - (cy + sheet.diameter / 2 + 2.4)) * MM;
  const escaped = cut.replace(/[\\()]/g, (c) => `\\${c}`);
  return `BT /F1 5 Tf ${x.toFixed(3)} ${y.toFixed(3)} Td (${escaped}) Tj ET\n`;
}

/**
 * WinAnsi, which is Latin-1 plus the punctuation German actually writes with.
 *
 * The high range is the whole point. Latin-1 alone loses the ellipsis this file
 * truncates with, and both German quote marks, and the en dash — as a literal
 * `?` on a printed sticker, which is how it was found. Anything still off the
 * map becomes `?` rather than throwing: a caption is a hint for the person
 * peeling the sheet, and one wrong glyph should not cost them the sheet.
 */
const WINANSI = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

function latin1(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i] = c < 256 ? c : WINANSI.get(c) ?? 0x3f;
  }
  return out;
}

/**
 * What the sheet has to say for itself, along its top margin.
 *
 * This is the only part of the export that reaches the person at the printer.
 * mitreden's own screens are long gone by then — the file has been opened in
 * Studio, possibly days later and possibly by somebody else — and the two
 * things that ruin a sheet are both decided at that moment: printing it on the
 * wrong paper, and printing it scaled. A page that says which paper it wants
 * cannot be separated from the answer.
 *
 * At the top because correcting originY moved the room. A full sheet's last row
 * of captions now sits at 280.8 mm, leaving too little beneath it to clear both
 * the captions and the 10-odd millimetres at the foot of the page that printers
 * will not put ink on. Above the first row there are 18.4 mm and nothing else
 * competing for them.
 */
function notesBlock(sheet: Sheet, lines: readonly string[]): string {
  let out = '0.45 0.45 0.45 rg\n';
  lines.forEach((line, i) => {
    const escaped = line.replace(/[\\()]/g, (c) => `\\${c}`);
    // 9.5 mm down for the first line, and the last still clears the top row of
    // circles by about 5 mm.
    const from = 9.5 + i * 3.2;
    const y = (sheet.height - from) * MM;
    out += `BT /F1 7 Tf ${(sheet.originX * MM).toFixed(3)} ${y.toFixed(3)} Td (${escaped}) Tj ET\n`;
  });
  return `${out}0 g\n`;
}

/** One sheet's drawing: every circle outlined, the used ones captioned. */
function sheetBody(
  sheet: Sheet, grid: { x: number; y: number }[],
  captions: readonly (string | null)[], notes: readonly string[],
): Uint8Array<ArrayBuffer> {
  /*
   * A hairline in the palest grey that still develops.
   *
   * The outline is a guide for lining the page up against a sheet of labels,
   * and once it is lined up the guide prints onto the labels themselves: a
   * grey ring around every sticker, on everything the stickers are then stuck
   * to. Light enough to find when looking for it and to disappear when not.
   */
  let body = '0.25 w 0.92 0.92 0.92 RG\n';
  for (const { x, y } of grid) body += circle(sheet, x, y, sheet.diameter / 2);
  body += '0 g\n';
  // A sheet whose gutter is too narrow for type goes out bare — see
  // Sheet.captions. The notes still fit: they live in the top margin.
  // A null is a circle this run does not touch: peeled before it started, or
  // past its end. It gets no word.
  if (sheet.captions) captions.forEach((text, i) => {
    if (text !== null) body += caption(sheet, grid[i].x, grid[i].y, text);
  });
  body += notesBlock(sheet, notes);
  return latin1(body);
}

/**
 * The sheets, as one PDF.
 *
 * Object numbering is worked out rather than written down, because it stops
 * being three fixed numbers the moment there is a second page: the font is
 * shared, each page needs its own dictionary and its own stream, and the page
 * tree has to name them all.
 */
function sheetsPdf(
  sheet: Sheet, grid: { x: number; y: number }[],
  pages: readonly { captions: (string | null)[]; notes: string[] }[],
): Uint8Array<ArrayBuffer> {
  const n = pages.length;
  const FONT = 3;                        // catalog, page tree, font, then the pages
  const page = (i: number) => FONT + 1 + i;
  const content = (i: number) => FONT + 1 + n + i;
  const box = `0 0 ${(sheet.width * MM).toFixed(2)} ${(sheet.height * MM).toFixed(2)}`;

  const objects: (string | Uint8Array<ArrayBuffer>)[] = [
    '<</Type/Catalog/Pages 2 0 R>>',
    `<</Type/Pages/Kids[${pages.map((_, i) => `${page(i)} 0 R`).join(' ')}]/Count ${n}>>`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
    ...pages.map((_, i) =>
      `<</Type/Page/Parent 2 0 R/MediaBox[${box}]`
      + `/Resources<</Font<</F1 ${FONT} 0 R>>>>/Contents ${content(i)} 0 R>>`),
    ...pages.map((page) => sheetBody(sheet, grid, page.captions, page.notes)),
  ];

  const parts: Uint8Array<ArrayBuffer>[] = [latin1('%PDF-1.4\n')];
  const offsets: number[] = [];
  let at = parts[0].length;
  objects.forEach((object, index) => {
    offsets.push(at);
    const chunks = object instanceof Uint8Array
      ? [latin1(`${index + 1} 0 obj\n<</Length ${object.length}>>stream\n`), object,
        latin1('\nendstream\nendobj\n')]
      : [latin1(`${index + 1} 0 obj\n${object}\nendobj\n`)];
    for (const chunk of chunks) { parts.push(chunk); at += chunk.length; }
  });
  let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) tail += `${String(offset).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${at}\n%%EOF\n`;
  parts.push(latin1(tail));

  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let cursor = 0;
  for (const part of parts) { out.set(part, cursor); cursor += part.length; }
  return out;
}

// --------------------------------------------------------------- project

/**
 * `_Project_.json`, shaped the way Studio writes one at Version 1.6.
 *
 * `CodeNr` is 0 throughout and `PenPackage` is empty, which is not an omission:
 * a Studio project looks exactly like this until the moment it is transferred,
 * and the ids arrive from the transfer. Writing anything else here would be
 * inventing numbers that belong to somebody else's book.
 */
function projectJson(
  sheet: Sheet, grid: { x: number; y: number }[],
  title: string, pdfName: string, audios: readonly PenAudio[], hasThumbnail: boolean,
  sheets: number, startCode: boolean, start: number,
): string {
  // The first circle of the first sheet is the activation code and the
  // sentences run on from there, across as many sheets as they need.
  const at = (i: number) => {
    const { page, x, y } = slot(sheet, grid, i);
    return {
      PageNo: page,
      X: Number(((x - CODE / 2) / 10).toFixed(6)),
      Y: Number(((y - CODE / 2) / 10).toFixed(6)),
      CodeNr: 0,
      Empty: false,
      ReadOnly: false,
    };
  };
  return JSON.stringify({
    Version: '1.6',
    Type: 0,
    Status: 2,
    LastModified: new Date().toISOString(),
    Author: 'mitreden',
    Title: title,
    HasThumbNail: hasThumbnail,
    PenPackage: {
      ActivationCode: 0, Audios: [], ReadOnlys: [], AudioNames: {},
      LeerCodes: [], UserName: '', PackageName: '', PackageId: 0, ZipFolder: '',
    },
    LastProjectFileName: '',
    // Studio keys its library on this and never showed any interest in what we
    // chose, but two projects sharing one would be our doing rather than its.
    Id: Math.floor(Math.random() * 900000) + 100000,
    MinFwVersion: '1.0',
    PdfPageCount: sheets,
    LastAppVersion: '',
    LastTechnicalUpdate: null,
    LastTechnicalUpdateReason: '',
    LastTechnicalUpdateByApp: '',
    TransferIntegrityState: 'unknown',
    TransferIntegrityMessage: '',
    TransferMissingAudioCount: 0,
    TransferIntegrityCheckedAt: null,
    Log: '',
    ShouldBeActivated: true,
    HaveTargetCircle: true,
    DirectRecord: false,
    MarkBlankCodes: true,
    CodeSize: 0,
    PDFFileName: pdfName,
    Pages: [],
    Codes: [
      // Type 0 is the activation code and carries no audio of its own. Read off
      // a project after Studio had one placed in it by hand; the assembly names
      // a CodeType enum but not its numbers.
      ...(startCode
        ? [{ Type: 0, ...at(start - 1), AudioFileName: '', HasAudioFileName: false }]
        : []),
      ...audios.map((audio, i) => ({
        // Centimetres from the top left, and the corner rather than the centre —
        // see CODE.
        Type: 1,
        ...at(start - 1 + (startCode ? 1 : 0) + i),
        AudioFileName: audio.name,
        HasAudioFileName: true,
      })),
    ],
    AudioFiles: audios.map((audio) => ({
      FileName: audio.name,
      // True because asPenMp3() already wrote them at the pen's own rate. Left
      // false, Studio transcodes what is already correct.
      IsPipelineCompliant: true,
    })),
  }, null, 1);
}

/**
 * The whole project, ready for Studio's library.
 *
 * A run longer than one sheet holds is cut into as many as it needs —
 * `sheetsFor()` counts them, `perSheet()` is how many sentences the first one
 * has room for once the activation code has taken a circle — so length is not
 * an error and nothing is dropped. The only refusal left is an empty list,
 * which would otherwise write a project with a sheet of nothing in it.
 *
 * That refusal-on-overflow is what this used to do, and the reasoning behind it
 * is why the multi-sheet path exists: a sticker sheet missing its last four
 * sentences looks finished.
 */
export function penProject(
  title: string,
  audios: readonly PenAudio[],
  {
    sheet = SHEETS[DEFAULT_SHEET], startCode = true, start = 1,
    thumbnail, startCaption = 'Start', notes = () => [],
  }: {
    /** Which label sheet this is printed on. */
    sheet?: Sheet;
    /**
     * Whether a circle is spent on the activation code.
     *
     * Optional because a part-used sheet usually has one on it already: the
     * code activates the package, and printing a second would cost a sticker
     * and give the pen two answers to the same question.
     */
    startCode?: boolean;
    /**
     * The first circle this run may use, 1-based.
     *
     * A sheet is not used up in one go. Starting at the top of a sheet whose
     * first three rows are gone prints onto backing paper and wastes what is
     * left, so the run begins where the reader says it does.
     */
    start?: number;
    thumbnail?: Uint8Array<ArrayBuffer>;
    /** What is printed under the activation sticker. */
    startCaption?: string;
    /**
     * Printed along the top margin of each sheet — see notesBlock(). Asked per
     * sheet rather than given once, because a sheet out of several has to be
     * able to say which one it is; the wording stays the caller's, since this
     * module has no language of its own.
     */
    notes?: (sheet: number, sheets: number) => readonly string[];
  } = {},
): Blob {
  if (!audios.length) throw new Error('An Anybook project needs at least one sentence.');

  // The activation code leads, the sentences follow, and the run is cut into
  // sheets. A sheet that ends mid-Sammlung is not a special case: the codes
  // carry their own page number and Studio reads them from it.
  const grid = cells(sheet);
  const per = grid.length;
  if (start < 1 || start > per)
    throw new Error(`A sheet of ${per} has no circle ${start}.`);

  /* Every circle this run touches, in order, with the ones already peeled left
     empty ahead of them. The activation code leads when there is one, which is
     the first circle of *this* run and not of the sheet — on a part-used sheet
     circle one is long gone. */
  const placed: (string | null)[] = Array.from({ length: start - 1 }, () => null);
  if (startCode) placed.push(startCaption);
  for (const audio of audios) placed.push(audio.caption);

  const count = Math.max(1, Math.ceil(placed.length / per));
  const pages = Array.from({ length: count }, (_, i) => ({
    captions: placed.slice(i * per, (i + 1) * per),
    notes: [...notes(i + 1, count)],
  }));

  const pdfName = `${title}.pdf`;
  const files: ZipEntry[] = [{ name: pdfName, bytes: sheetsPdf(sheet, grid, pages) }];
  if (thumbnail) files.push({ name: '_Thumbnail_.jpeg', bytes: thumbnail });
  for (const audio of audios) files.push({ name: audio.name, bytes: audio.bytes });
  // Last, the way Studio writes it.
  files.push({
    name: '_Project_.json',
    bytes: new TextEncoder().encode(
      projectJson(sheet, grid, title, pdfName, audios, Boolean(thumbnail), count,
        startCode, start),
    ),
  });
  return zip(files);
}
