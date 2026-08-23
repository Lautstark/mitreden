/**
 * The sentences: what is in the Sammlung you are in, and what you can do to
 * one of them.
 *
 * A sentence or a whole Sammlung, nothing in between. There is no selection
 * model: an act is either on the one you clicked or on all of them.
 */

import { asFormat } from '../core/audio.ts';
import { getAudio } from '../db/db.ts';
import { build, deletePhrase, editPhrase } from '../db/repo.ts';
import { zip, type ZipEntry } from '../core/zip.ts';
import { t, tn } from '../i18n/index.ts';
import type { Format, PhraseWithState } from '../core/types.ts';
import { chosenVoice } from './composer.ts';
import { deleteCollection, here } from './rail.ts';
import { exportCollection } from './settings.ts';
import {
  ALL, CAP, endWork, load, onLanded, onWork, queueWork, refresh, shown, stateText,
  stepWork, workOn,
} from './state.ts';
import { busy, closeMenus, el, menuOn, say } from './dom.ts';

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
    add(t('download_mp3'), () => { closeMenus(); void packAll('mp3'); });
    add(t('download_wav'), () => { closeMenus(); void packAll('wav'); });
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
      add(t('download_mp3'), () => { closeMenus(); void grab(item, 'mp3'); });
      add(t('download_wav'), () => { closeMenus(); void grab(item, 'wav'); });
    } else {
      // A recording that failed was otherwise stuck: the only way back was to
      // retype the sentence.
      add(t('menu_record'), () => { closeMenus(); void again(item); });
    }
    add(t('menu_delete_one'), () => { closeMenus(); void remove(item); }, { danger: true });
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
  save(await asFormat(stored, format), `${item.id}.${format}`);
}

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // A blob URL holds its blob until it is let go of.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
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
    const { failed } = await build([item.id], item.voice ?? chosenVoice(), true, stepWork);
    endWork();
    say(t('done_edit', { text: changed.text })
      + (failed.length ? ` ${tn('not_recorded', 1, { why: failed[0]! })}` : ''));
    await load();
  };
}

async function remove(item: PhraseWithState): Promise<void> {
  if (!confirm(t('ask_delete_this', { text: `„${item.text}“` }))) return;
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
  const safe = (current?.name ?? 'sammlung').replace(/[^\p{L}\p{N}\s-]/gu, '').trim() || 'sammlung';
  save(zip(files), `mitreden-${safe}-${stamp}.zip`);
  say(t('done_pack', { n: files.length, format: format.toUpperCase() }));
}

export function wireList(): void {
  onWork(repaintWork);
  onLanded((id) => void landed(id));
  el('q').addEventListener('input', draw);
  el('dlall').onclick = () => openDownload(el('dlall'));
  el('colmore').onclick = () => menuOn(el('colmore'), (add) => {
    const current = here();
    if (!current) return;
    add(t('collection_export'), () => { closeMenus(); void exportCollection(current); });
    add(t('collection_delete'), () => {
      closeMenus();
      void deleteCollection(current.key, current.name, current.count);
    }, { danger: true });
  });
}
