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
import { ALL, CAP, CHIP_CAP, NO_VOICE, VOICE_FILTER, found, load, shown, stateText, voiceOf } from './state.ts';
import { closeMenus, el, menuOn, say } from './dom.ts';

let showAll = false;
let allVoices = false;

/** Blob URLs are handed to <audio> elements, so they outlive the draw. */
const playing = new Map<string, string>();

function drawVoiceChips(hits: readonly PhraseWithState[]): void {
  const counts = new Map<string, number>();
  for (const item of hits) {
    const voice = voiceOf(item);
    counts.set(voice, (counts.get(voice) ?? 0) + 1);
  }
  const row = el('vrow');
  const box = el('vchips');
  box.innerHTML = '';
  // One voice is not a filter, it is a fact about the list.
  row.hidden = counts.size < 2;
  if (row.hidden) return;
  const names = [...counts.keys()].sort((a, b) =>
    a === NO_VOICE ? 1 : b === NO_VOICE ? -1 : a.localeCompare(b, 'de'));
  const visible = allVoices ? names : names.slice(0, CHIP_CAP);
  for (const name of visible) {
    const chip = document.createElement('button');
    chip.className = `chip${VOICE_FILTER.has(name) ? ' on' : ''}`;
    chip.textContent = `${name === NO_VOICE ? t('chip_not_recorded') : name} ${counts.get(name)}`;
    chip.onclick = () => {
      if (VOICE_FILTER.has(name)) VOICE_FILTER.delete(name);
      else VOICE_FILTER.add(name);
      draw();
    };
    box.appendChild(chip);
  }
  if (!allVoices && names.length > CHIP_CAP) {
    const more = document.createElement('button');
    more.className = 'chip more';
    more.textContent = t('show_all', { n: names.length });
    more.onclick = () => { allVoices = true; draw(); };
    box.appendChild(more);
  }
}

/** Its labels are words, so they follow the language. */
function drawDownload(): void {
  const select = el<HTMLSelectElement>('dlall');
  select.innerHTML = '';
  select.appendChild(new Option(t('download_all'), ''));
  select.appendChild(new Option(t('download_mp3'), 'mp3'));
  select.appendChild(new Option(t('download_wav'), 'wav'));
  select.value = '';
}

export function draw(): void {
  drawDownload();
  const hits = found();
  const items = [...shown()].reverse();          // newest first
  drawVoiceChips(hits);

  const pending = items.filter((item) => item.state !== 'ok').length;
  const searching = el<HTMLInputElement>('q').value.trim().length > 0;
  // A fraction made sense when a Sammlung was a filter over one long list. It
  // is a place now, and "0 of 3" in an empty one reads as an error.
  el('count').textContent = searching
    ? t('count_filtered', { n: items.length, all: ALL().length })
    : !items.length ? t('count_none')
      : tn('count', items.length)
        + (pending ? t('count_open', { n: pending }) : t('count_all_recorded'));

  const list = el('list');
  for (const url of playing.values()) URL.revokeObjectURL(url);
  playing.clear();
  list.innerHTML = '';

  if (!items.length) {
    const line = document.createElement('p');
    line.className = 'empty';
    // "Nothing matches" is only true when something is narrowing the list. An
    // empty Sammlung is not a failed search.
    if (searching || VOICE_FILTER.size) line.textContent = t('empty_no_match');
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
    more.className = 'more';
    more.textContent = t('show_all', { n: items.length });
    more.onclick = () => { showAll = true; draw(); };
    list.appendChild(more);
  }
}

function row(item: PhraseWithState): HTMLElement {
  const node = document.createElement('div');
  node.className = `item ${item.state}`;

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
  wrap.className = 'menuwrap';
  const dots = document.createElement('button');
  dots.className = 'dots';
  dots.setAttribute('aria-haspopup', 'true');
  dots.setAttribute('aria-expanded', 'false');
  dots.title = t('more_actions');
  dots.setAttribute('aria-label', t('more_actions'));
  dots.textContent = '⋮';
  dots.onclick = () => openMenu(dots, item);
  wrap.appendChild(dots);
  node.appendChild(wrap);
  return node;
}

function openMenu(button: HTMLElement, item: PhraseWithState): void {
  menuOn(button, (add) => {
    if (item.state !== 'missing') {
      add(t('download_mp3'), false, () => { closeMenus(); void grab(item, 'mp3'); });
      add(t('download_wav'), false, () => { closeMenus(); void grab(item, 'wav'); });
    } else {
      // A recording that failed was otherwise stuck: the only way back was to
      // retype the sentence.
      add(t('menu_record'), false, () => { closeMenus(); void again(item); });
    }
    add(t('menu_delete_one'), true, () => { closeMenus(); void remove(item); });
  });
}

async function again(item: PhraseWithState): Promise<void> {
  say(t('busy_record'));
  const { failed } = await build([item.id], chosenVoice());
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
    say(t('busy_record'));
    const changed = await editPhrase(item.id, text);
    if (!changed) { node.textContent = item.text; return; }
    const { failed } = await build([item.id], item.voice ?? chosenVoice(), true);
    say(t('done_edit', { text: changed.text })
      + (failed.length ? ` ${tn('not_recorded', 1, { why: failed[0]! })}` : ''));
    await load();
  };
}

async function remove(item: PhraseWithState): Promise<void> {
  if (!confirm(t('ask_delete_this', { text: `„${item.text}“` }))) return;
  say(t('busy_delete'));
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
  say(t('busy_pack', { n: ids.length }));
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
  el('q').addEventListener('input', draw);
  el('dlall').addEventListener('change', (event) => {
    const select = event.target as HTMLSelectElement;
    const format = select.value as Format | '';
    select.value = '';
    if (format) void packAll(format);
  });
  el('colmore').onclick = () => menuOn(el('colmore'), (add) => {
    const current = here();
    if (!current) return;
    add(t('collection_export'), false, () => { closeMenus(); void exportCollection(current); });
    add(t('collection_delete'), true, () => {
      closeMenus();
      void deleteCollection(current.key, current.name, current.count);
    });
  });
}
