/**
 * What can be done to a whole Sammlung: pack it, speak it again, throw it away.
 *
 * Its own module rather than the head component's script, because none of it is
 * markup and two of the three are reached from somewhere else — the re-record
 * from the Sammlung's own sheet, the delete from the ⋯ beside the name. What
 * draws the button is WorkHead.svelte; what the press does is here.
 */

import { asFormat, asPenMp3 } from '../core/audio.ts';
import { getAudio } from '../db/audio.ts';
import { build, deleteCollection as removeCollection, savePen } from '../db/repo.ts';
import { cells, penProject, sheetsFor, type PenAudio, type Sheet } from '../core/anybook.ts';
import { zip, type ZipEntry } from '../core/zip.ts';
import { download } from '@lautstark/werkzeuge/download';
import { downloadSlug } from '@lautstark/werkzeuge/filename';
import type { Format } from '../core/types.ts';
import { askPenExport } from './penExport.svelte.ts';
import { chosenVoice } from './voices.svelte.ts';
import { sheetNotes } from './penNotes.ts';
import { confirmDialog } from './dialog.ts';
import { t, tn } from './words.svelte.ts';
import { busy, say } from './dom.ts';
import {
  ALL, closeCollection, endWork, here, load, queueWork, shown, stepWork,
} from './store.svelte.ts';

const stamp = (): string => new Date().toISOString().slice(0, 10);

/** A whole Sammlung as one zip. */
export async function packAll(format: Format): Promise<void> {
  const ids = shown().filter((item) => item.state !== 'missing').map((item) => item.id);
  if (!ids.length) {
    say(t('nothing_recorded'));
    return;
  }
  busy('busy_pack', { n: ids.length });
  const files: ZipEntry[] = [];
  for (const id of ids) {
    const stored = await getAudio(id);
    if (!stored) continue;
    const blob = await asFormat(stored, format);
    files.push({ name: `${id}.${format}`, bytes: new Uint8Array(await blob.arrayBuffer()) });
  }
  const current = here();
  const safe = downloadSlug(current?.name ?? 'sammlung', 'sammlung');
  download(zip(files), `mitreden-${safe}-${stamp()}.zip`);
  say(t('done_pack', { n: files.length, format: format.toUpperCase() }));
}

/**
 * The library tile Studio draws beside the project's name.
 *
 * Cosmetic, and made here rather than in core/anybook.ts because it wants a
 * canvas and that module is meant to stay checkable without a browser.
 */
async function sheetThumbnail(sheet: Sheet): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const width = 600;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round(width * sheet.height / sheet.width);
  const pen = canvas.getContext('2d');
  if (!pen) return undefined;
  const scale = width / sheet.width;
  pen.fillStyle = '#fff';
  pen.fillRect(0, 0, canvas.width, canvas.height);
  pen.strokeStyle = '#c8c8c8';
  for (const { x, y } of cells(sheet)) {
    pen.beginPath();
    pen.arc(x * scale, y * scale, sheet.diameter / 2 * scale, 0, Math.PI * 2);
    pen.stroke();
  }
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.85));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
}

/**
 * A whole Sammlung as an Anybook project, for Studio to number and transfer.
 *
 * The sentences go on in the order the list shows them, which is the order the
 * stickers come off the sheet — so the sheet reads the way the Sammlung does.
 */
export async function packPen(): Promise<void> {
  const items = shown().filter((item) => item.state !== 'missing');
  if (!items.length) {
    say(t('nothing_recorded'));
    return;
  }
  // Asked before anything is encoded: the answers decide the geometry, and
  // sixty re-encodings behind a dialog nobody confirmed would be sixty wasted.
  const choice = await askPenExport(items.length);
  if (!choice) return;
  const { sheet, startCode, start } = choice;
  busy('busy_pen', { n: items.length });
  const audios: PenAudio[] = [];
  for (const item of items) {
    const stored = await getAudio(item.id);
    if (!stored) continue;
    audios.push({
      name: `${item.id}.mp3`,
      bytes: new Uint8Array(await (await asPenMp3(stored)).arrayBuffer()),
      caption: item.text,
    });
  }
  const current = here();
  const dated = stamp();
  const name = current?.name ?? 'sammlung';
  const safe = downloadSlug(name, 'sammlung');
  download(
    penProject(safe, audios, {
      sheet,
      startCode,
      start,
      thumbnail: await sheetThumbnail(sheet),
      startCaption: t('pen_start'),
      // Two lines, which is what the top margin has room for — see notesBlock().
      // The first says which sheet this is, because a Sammlung past 87
      // sentences comes out as several and they are otherwise identical.
      // The Sammlung's own name here rather than the swept one: this is a line
      // printed on a sheet of paper, and nothing reads it back. `safe` above is
      // a file name — the project's, and its PDF's inside the .abs.
      notes: (page: number, pages: number) => sheetNotes({
        title: name, date: dated, sentences: audios.length,
        product: sheet.product, per: sheet.cols * sheet.rows, url: sheet.url,
        startCode, start, page, pages,
      }),
    }),
    `mitreden-${safe}-${dated}.abs`,
  );
  // The plural count is the sheets, because that is the word that changes.
  // Where this run ended, offered as where the next one starts. A guess about
  // a sheet of paper, which is why the dialog shows it rather than assuming it.
  const per = sheet.cols * sheet.rows;
  const ended = start - 1 + (startCode ? 1 : 0) + audios.length;
  await savePen({ sheet: sheet.id, next: (ended % per) + 1 });
  say(tn(startCode ? 'done_pen' : 'done_pen_bare', sheetsFor(sheet, audios.length),
    { sentences: tn('count', audios.length) }));
}

/**
 * Everything in this Sammlung that is not what it should sound like, spoken
 * again.
 *
 * The half a per-Sammlung voice needs and did not have. Changing the voice
 * marks every sentence in the Sammlung stale — that is the fingerprint doing
 * exactly what it was built to do — and without a way to act on all of them the
 * change would leave a Sammlung of rows complaining with nothing to press.
 * conventions.md §3.10 already assumed this button existed: "only an explicit
 * *record again* moves what has been made".
 *
 * Only the ones that need it. `force` stays false, so this is not a way to
 * spend a minute re-recording forty sentences that are already right — build()
 * skips anything whose fingerprint still matches, and the filter here is so the
 * queue on screen says the true number rather than counting them all.
 */
export async function recordAgain(id: string): Promise<void> {
  const ids = ALL().filter((item) => item.collection === id && item.state !== 'ok')
    .map((item) => item.id);
  if (!ids.length) {
    say(t('nothing_to_record'));
    return;
  }
  busy('busy_record');
  queueWork(ids);
  // The voice is the Sammlung's and build() reads it; this is the last resort
  // it falls back to when nothing anywhere has decided one.
  const { recorded, failed } = await build(ids, chosenVoice(), false, stepWork);
  endWork();
  say(tn('done_record_again', recorded)
    + (failed.length ? ` ${tn('not_recorded', failed.length, { why: failed[0]! })}` : ''));
  await load();
}

export async function deleteCollection(key: string, name: string, n: number): Promise<void> {
  if (!await confirmDialog({
    title: t('collection_delete'),
    body: t('ask_collection_delete', { name, n }),
    // What happens, which here is the half that is easy to get wrong: the
    // Sammlung goes and the sentences do not.
    confirmLabel: t('collection_delete_do'),
    danger: true,
  })) return;
  if (!(await removeCollection(key))) return;
  closeCollection(key);
  say(t('done_collection_delete', { name }));
  await load();
}
