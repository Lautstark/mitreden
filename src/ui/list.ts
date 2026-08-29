/**
 * The sentences: what is in the Sammlung you are in, and what you can do to
 * one of them.
 *
 * A sentence or a whole Sammlung, nothing in between. There is no selection
 * model: an act is either on the one you clicked or on all of them.
 */

import { asFormat, asPenMp3 } from '../core/audio.ts';
import { getAudio } from '../db/db.ts';
import { build, deletePhrase, editPhrase } from '../db/repo.ts';
import { cells, penProject, sheetsFor, type PenAudio, type Sheet } from '../core/anybook.ts';
import { askPenExport } from './penExport.ts';
import { sheetNotes } from './penNotes.ts';
import { savePen } from '../db/repo.ts';
import { zip, type ZipEntry } from '../core/zip.ts';
import { t, tn } from '../i18n/index.ts';
import type { Format, PhraseWithState } from '../core/types.ts';
import { chosenVoice } from './composer.ts';
import { openCollectionVoice } from './collectionVoice.ts';
import { deleteCollection, here } from './rail.ts';
import { exportCollection } from './settings.ts';
import {
  ALL, CAP, endWork, load, onLanded, onWork, queueWork, refresh, shown, stateText,
  stepWork, workOn,
} from './state.ts';
import { busy, el, say } from './dom.ts';
import { menuOn } from '@lautstark/design/menu';
import { confirmDialog } from '@lautstark/design/dialog';
import { download } from '@lautstark/werkzeuge/download';
import { downloadSlug } from '@lautstark/werkzeuge/filename';

let showAll = false;

/** Blob URLs are handed to <audio> elements, so they outlive the draw. */
const playing = new Map<string, string>();

/**
 * Which format, asked the way every other question on this page is asked. It
 * was a native select, and the case written for it was that the browser draws
 * the open list, so nothing was left to get wrong per theme. True — and beside
 * the point: what the browser draws belongs to no design language, and this sat
 * next to a ⋯ that opens the shared menu.
 */
function openDownload(button: HTMLElement): void {
  menuOn(button, (add) => {
    add(t('download_mp3'), () => void packAll('mp3'));
    add(t('download_wav'), () => void packAll('wav'));
    add(t('download_pen'), () => void packPen());
  });
}

/**
 * How much is here and how much of it is still open. Its own function because
 * a batch moves that second number one sentence at a time, and saying so is a
 * line of text rather than a reason to redraw the list.
 */
function paintCount(): void {
  const items = shown();
  const pending = items.filter((item) => item.state !== 'ok').length;
  const searching = el<HTMLInputElement>('q').value.trim().length > 0;
  // A fraction made sense when a Sammlung was a filter over one long list. It
  // is a place now, and "0 of 3" in an empty one reads as an error.
  el('count').textContent = searching
    ? t('count_filtered', { n: items.length, all: ALL().length })
    : !items.length ? t('count_none')
      : tn('count', items.length)
        + (pending ? t('count_open', { n: pending }) : t('count_all_recorded'));
}

export function draw(): void {
  const items = [...shown()].reverse();          // newest first
  const searching = el<HTMLInputElement>('q').value.trim().length > 0;
  paintCount();

  const list = el('list');
  for (const url of playing.values()) URL.revokeObjectURL(url);
  playing.clear();
  list.innerHTML = '';

  if (!items.length) {
    const line = document.createElement('p');
    line.className = 'empty';
    // "Nothing matches" is only true when something is narrowing the list. An
    // empty Sammlung is not a failed search.
    if (searching) line.textContent = t('empty_no_match');
    else {
      const [before, after] = t('empty_start').split('{key}');
      const key = document.createElement('kbd');
      key.textContent = 'Enter';
      line.append(before ?? '', key, after ?? '');
    }
    list.appendChild(line);
    return;
  }

  for (const item of showAll ? items : items.slice(0, CAP)) list.appendChild(row(item));

  if (!showAll && items.length > CAP) {
    const more = document.createElement('button');
    more.className = 'btn more';
    more.textContent = t('show_all', { n: items.length });
    more.onclick = () => { showAll = true; draw(); };
    list.appendChild(more);
  }
}

/** Two facts about one sentence: whether it has a recording, and whether one
 *  is being made for it now. */
const classOf = (item: PhraseWithState): string => {
  const work = workOn(item.id);
  return `item ${item.state}${work ? ` busy ${work}` : ''}`;
};

/**
 * The rows a running batch is passing through, repainted where they stand.
 *
 * Not draw(): that rebuilds every row from scratch, which revokes the blob URL
 * under any <audio> currently playing. A batch moves on every sentence or two,
 * so a redraw each time would cut off a preview repeatedly — for a change that
 * amounts to one class and one word per row.
 */
function repaintWork(): void {
  for (const node of document.querySelectorAll<HTMLElement>('#list .item')) {
    const item = ALL().find((one) => one.id === node.dataset.id);
    if (!item) continue;
    node.className = classOf(item);
    const state = node.querySelector('.state');
    if (state) state.textContent = stateText(item);
    node.querySelector('.st')?.setAttribute('aria-busy', String(workOn(item.id) !== null));
  }
}

/**
 * One sentence now has its recording — or has failed to get one.
 *
 * The row is rebuilt where it stands, from data read back out of the store: it
 * gains a player, which is the plainest possible "this one is done", and it
 * says so while the rest of the batch is still going. Rebuilding the whole
 * list to report one sentence would cut off a preview playing in another row
 * every time the batch moved on.
 */
async function landed(id: string): Promise<void> {
  await refresh();
  const item = ALL().find((one) => one.id === id);
  const node = el('list').querySelector<HTMLElement>(`.item[data-id="${CSS.escape(id)}"]`);
  paintCount();
  if (!item || !node) return;
  // This row's own blob URL, which the row about to replace it will mint again.
  const url = playing.get(id);
  if (url) { URL.revokeObjectURL(url); playing.delete(id); }
  node.replaceWith(row(item));
}

function row(item: PhraseWithState): HTMLElement {
  const node = document.createElement('div');
  node.dataset.id = item.id;
  node.className = classOf(item);

  const text = document.createElement('div');
  text.className = 'txt';
  const line = document.createElement('div');
  line.className = 'line';
  line.textContent = item.text;
  line.title = t('menu_edit_text');
  line.onclick = () => editLine(line, item);
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = '<span class="st"><span class="dot"></span><span class="state"></span></span>';
  meta.querySelector('.state')!.textContent = stateText(item);
  /* aria-busy, not an announcement. The visible marker is a coloured dot and
     somebody reading the page needs the same fact — but a batch of forty
     reporting itself one sentence at a time through the live region would
     bury the message that actually matters at the end. */
  meta.querySelector('.st')!.setAttribute('aria-busy', String(workOn(item.id) !== null));
  text.append(line, meta);
  node.appendChild(text);

  if (item.state !== 'missing') {
    const audio = document.createElement('audio');
    audio.controls = true;
    // The player's own ⋮ offers a playback speed that changes only listening,
    // and a download of the preview rather than the file a device gets. Both
    // mislead, so both are off.
    audio.setAttribute('controlsList', 'nodownload noplaybackrate');
    audio.setAttribute('disableRemotePlayback', '');
    audio.preload = 'none';
    void getAudio(item.id).then((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      playing.set(item.id, url);
      audio.src = url;
    });
    node.appendChild(audio);
  }

  const wrap = document.createElement('div');
  wrap.className = 'menu-anchor';
  const dots = document.createElement('button');
  dots.className = 'dots';
  dots.setAttribute('aria-haspopup', 'menu');
  dots.setAttribute('aria-expanded', 'false');
  dots.title = t('more_actions');
  dots.setAttribute('aria-label', t('more_actions'));
  dots.textContent = '⋯';
  dots.onclick = () => openMenu(dots, item);
  wrap.appendChild(dots);
  node.appendChild(wrap);
  return node;
}

function openMenu(button: HTMLElement, item: PhraseWithState): void {
  menuOn(button, (add) => {
    if (item.state !== 'missing') {
      add(t('download_mp3'), () => void grab(item, 'mp3'));
      add(t('download_wav'), () => void grab(item, 'wav'));
    }
    /* Not only when the recording is missing. A stale row has a clip that plays
       and says „geändert seit der Aufnahme", and until now the only way to act
       on that was to retype the sentence — which was a small gap when the voice
       was the sentence's own and is not one now: changing a Sammlung's voice
       makes every row in it stale at once, and a state nothing can leave is a
       state that should not have been reachable. The Sammlung's own ⋯ does all
       of them; this does the one you are looking at. */
    if (item.state !== 'ok') add(t('menu_record'), () => void again(item));
    add(t('menu_delete_one'), () => void remove(item), { danger: true });
  });
}

async function again(item: PhraseWithState): Promise<void> {
  busy('busy_record');
  queueWork([item.id]);
  const { failed } = await build([item.id], chosenVoice(), false, stepWork);
  endWork();
  say(failed.length ? tn('not_recorded', failed.length, { why: failed[0]! })
    : t('done_edit', { text: item.text }));
  await load();
}

async function grab(item: PhraseWithState, format: Format): Promise<void> {
  const stored = await getAudio(item.id);
  if (!stored) {
    say(t('nothing_recorded'));
    return;
  }
  // The id is already a file name — core/ids.ts made it one, and the file it
  // names may be on a talker — so it goes out as it stands.
  download(await asFormat(stored, format), `${item.id}.${format}`);
}

/**
 * Editing happens on the sentence, the same way a Sammlung is renamed by
 * typing in its title. Clicking away commits and records again; Escape puts
 * the old text back. The id never moves — it is a file name, and the file may
 * already be on a device.
 */
function editLine(node: HTMLElement, item: PhraseWithState): void {
  if (node.isContentEditable) return;
  node.contentEditable = 'plaintext-only';
  node.spellcheck = false;
  node.focus();
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  const stop = () => {
    node.contentEditable = 'false';
    node.onblur = null;
    node.onkeydown = null;
  };
  node.onkeydown = (event) => {
    if (event.key === 'Escape') { node.textContent = item.text; stop(); node.blur(); }
    if (event.key === 'Enter') { event.preventDefault(); node.blur(); }
  };
  node.onblur = async () => {
    const text = node.textContent?.trim() ?? '';
    stop();
    if (!text || text === item.text) { node.textContent = item.text; return; }
    busy('busy_record');
    const changed = await editPhrase(item.id, text);
    if (!changed) { node.textContent = item.text; return; }
    queueWork([item.id]);
    // The Sammlung's voice decides, so there is nothing to pass but the last
    // resort. `true` is "record it again even though the fingerprint matches" —
    // which it will not, the text having just changed — and no longer "in this
    // voice regardless".
    const { failed } = await build([item.id], chosenVoice(), true, stepWork);
    endWork();
    say(t('done_edit', { text: changed.text })
      + (failed.length ? ` ${tn('not_recorded', 1, { why: failed[0]! })}` : ''));
    await load();
  };
}

async function remove(item: PhraseWithState): Promise<void> {
  if (!await confirmDialog({
    title: t('menu_delete_one'),
    body: t('ask_delete_this', { text: `„${item.text}“` }),
    confirmLabel: t('delete_one_do'),
    cancelLabel: t('cancel'),
    closeLabel: t('close'),
    danger: true,
  })) return;
  busy('busy_delete');
  await deletePhrase(item.id);
  say(t('done_delete_one', { text: item.text }));
  await load();
}

/** A whole Sammlung as one zip. */
async function packAll(format: Format): Promise<void> {
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
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = downloadSlug(current?.name ?? 'sammlung', 'sammlung');
  download(zip(files), `mitreden-${safe}-${stamp}.zip`);
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
async function packPen(): Promise<void> {
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
  const stamp = new Date().toISOString().slice(0, 10);
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
      notes: (page, pages) => sheetNotes({
        title: name, date: stamp, sentences: audios.length,
        product: sheet.product, per: sheet.cols * sheet.rows, url: sheet.url,
        startCode, start, page, pages,
      }),
    }),
    `mitreden-${safe}-${stamp}.abs`,
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

export function wireList(): void {
  onWork(repaintWork);
  onLanded((id) => void landed(id));
  el('q').addEventListener('input', draw);
  el('dlall').onclick = () => openDownload(el('dlall'));
  /* conventions.md §3.6, in its own order: what acts on this Sammlung, then what
     this Sammlung is set to, then the delete. The voice is here rather than in
     Einstellungen because its answer changes with which Sammlung is open, which
     is §3.10's test — and beside the name there is no question about which one
     the menu means.

     Three items, which is vorlaut's exactly. „Sammlung neu aufnehmen" was the
     first of four until 2026-08-29: an item permanently present whose most
     common outcome was the sentence „Alles hier ist schon … aufgenommen", and
     the settings sheet below it ended by telling you to come back up here and
     press it. It is a button in that sheet now, carrying its own count. */
  el('colmore').onclick = () => menuOn(el('colmore'), (add) => {
    const current = here();
    if (!current) return;
    add(t('collection_export'), () => void exportCollection(current));
    add(t('collection_settings'), () => openCollectionVoice(current.id));
    add(t('collection_delete'), () => {
      void deleteCollection(current.id, current.name, current.count);
    }, { danger: true });
  });
}
