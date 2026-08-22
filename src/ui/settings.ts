/**
 * The settings dialog: voices, language, and your data.
 *
 * The Azure key never leaves this browser. The request goes from here straight
 * to Microsoft and the audio comes straight back; nothing passes through a
 * server of ours, because there is not one.
 */

import { loadPhrases, wipe } from '../db/db.ts';
import { collections, createCollection, saveAzure, settings } from '../db/repo.ts';
import { probeAzure } from '../core/voices.ts';
import { LANGUAGES, lang, setLang, t, tn, type Lang } from '../i18n/index.ts';
import type { Collection, Phrase } from '../core/types.ts';
import { loadVoices } from './composer.ts';
import { load } from './state.ts';
import { applyLang, el, say } from './dom.ts';

/**
 * Azure's own region names. A datalist suggests rather than restricts, so a
 * region newer than this file still works by typing it — and the region is
 * what a rejected key usually turns out to be.
 */
const AZURE_REGIONS = [
  'westeurope', 'northeurope', 'germanywestcentral', 'switzerlandnorth',
  'francecentral', 'uksouth', 'swedencentral', 'norwayeast', 'eastus', 'eastus2',
  'westus', 'westus2', 'westus3', 'centralus', 'southcentralus', 'canadacentral',
  'brazilsouth', 'australiaeast', 'southeastasia', 'eastasia', 'japaneast',
  'japanwest', 'koreacentral', 'centralindia', 'southafricanorth', 'uaenorth',
];

export async function drawSetup(): Promise<void> {
  const saved = await settings();
  const box = el('cloud');
  box.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card__head"><h3>Azure Speech</h3><span class="badge state"></span></div>
    <p class="hint probe" role="status"></p>
    <p class="sub body"></p><p class="warn"></p>
    <label for="azurekey"></label>
    <input id="azurekey" type="password" autocomplete="off">
    <label class="region" for="azureregion"></label>
    <input id="azureregion" class="region" type="text" list="azureregions" spellcheck="false">
    <datalist id="azureregions">${AZURE_REGIONS.map((r) => `<option value="${r}">`).join('')}</datalist>
    <p class="hint region"></p>
    <div class="row"><button class="primary save"></button><button class="quiet forget"></button></div>`;

  const azure = saved.azure;
  const state = card.querySelector<HTMLElement>('.state')!;
  // Which key, not merely that there is one: the last four characters tell
  // two keys apart without giving either away.
  state.textContent = azure ? t('key_hint', { hint: azure.key.slice(-4) }) : '';
  state.hidden = !azure;

  const probe = card.querySelector<HTMLElement>('.probe')!;
  probe.hidden = !azure;
  if (azure) {
    // The person who stored a key has one question — does Azure answer? —
    // and the badge's "stored" was never it. Memoised per key and region, so
    // this line and the picker's own ask share a single request.
    probe.textContent = t('azure_asking');
    void probeAzure(azure).then((answer) => {
      probe.textContent = answer.ok
        ? tn('azure_answers', answer.count)
        : t(answer.code === 'unreachable' ? 'azure_unreachable'
          : answer.code === 'refused' ? 'azure_refused' : 'azure_failed');
    });
  }
  card.querySelector<HTMLElement>('.body')!.textContent = t('azure_body');
  card.querySelector<HTMLElement>('.warn')!.textContent = t('azure_warn');
  card.querySelector<HTMLElement>('label[for=azurekey]')!.textContent = t('key_field');
  card.querySelector<HTMLElement>('label.region')!.textContent = t('region_field');
  card.querySelector<HTMLElement>('p.region')!.textContent = t('region_hint');

  const key = card.querySelector<HTMLInputElement>('#azurekey')!;
  // The held key sits in the placeholder, never in the value: a value can be
  // revealed or resubmitted, a placeholder cannot. It is also what makes the
  // save rule visible — this field left untouched keeps the key it shows.
  key.placeholder = azure ? `••••${azure.key.slice(-4)}` : '';
  const region = card.querySelector<HTMLInputElement>('#azureregion')!;
  region.value = saved.azure?.region ?? 'westeurope';

  const save = card.querySelector<HTMLButtonElement>('.save')!;
  const forget = card.querySelector<HTMLButtonElement>('.forget')!;
  save.textContent = t('key_save');
  forget.textContent = t('key_forget');
  forget.hidden = !azure;
  save.onclick = () => void saveKey(key.value, region.value, save);
  forget.onclick = () => void forgetKey();

  box.appendChild(card);
}

/**
 * Checked before it is stored, so a typo is a sentence now rather than a failed
 * recording later. The button says what it is doing meanwhile: the check is a
 * network round trip, and a button that does nothing visible for two seconds is
 * a button you press again.
 */
async function saveKey(typed: string, region: string, button: HTMLButtonElement): Promise<void> {
  // The field is empty every time the card draws, so an untouched field must
  // not mean "no key": a save that only moves the region keeps the key it
  // already has. Removing the key is its own button, not a way to save.
  const key = typed.trim() || (await settings()).azure?.key;
  if (!key) {
    say(t('type_first'));
    return;
  }
  const where = region.trim() || 'westeurope';
  const was = button.textContent;
  button.disabled = true;
  button.textContent = t('key_checking');
  say(t('key_checking'));
  try {
    const answer = await probeAzure({ key, region: where });
    if (!answer.ok) {
      // A key is bound to one region, and the wrong pairing answers exactly
      // the same 401 as a wrong key — saying which is more use than repeating
      // Azure. A region name that is not one never answers at all, and that
      // difference is worth its own sentence too.
      say(t('key_failed', { error:
        answer.code === 'refused' ? t('azure_bad_pair')
          : answer.code === 'unreachable' ? t('azure_unreachable')
            : t('azure_no_answer', { error: answer.words }) }));
      return;
    }
    await saveAzure({ key, region: where });
    say(t('key_saved', { label: 'Azure Speech', n: answer.count }));
    // The card and the picker are what this save feeds. The dialog stays
    // open, so the state line and the new voices land on the screen the key
    // was typed into; the probe is already answered, so neither asks again.
    await Promise.all([drawSetup(), loadVoices()]);
  } catch (error) {
    say(t('key_failed', { error: error instanceof Error ? error.message : String(error) }));
  } finally {
    button.disabled = false;
    button.textContent = was;
  }
}

async function forgetKey(): Promise<void> {
  await saveAzure(undefined);
  say(t('key_removed', { label: 'Azure Speech' }));
  await Promise.all([drawSetup(), loadVoices()]);
}

// ------------------------------------------------------------------- data

/** One Sammlung as a file, named after it and dated. */
export async function exportCollection(collection: Collection): Promise<void> {
  const items = (await loadPhrases()).filter((item) => item.collections.includes(collection.key));
  download({ collection: collection.name, items }, `mitreden-${safeName(collection.name)}`);
}

async function exportAll(): Promise<void> {
  download(await loadPhrases(), 'mitreden-alle-saetze');
}

const safeName = (name: string): string =>
  name.replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replaceAll(' ', '-').toLowerCase() || 'sammlung';

function download(data: unknown, stem: string): void {
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${stem}-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * What a file may contain: our own export, a bare list, or a bildhaft archive,
 * which carries sentences under a different name. Reading one is worth doing —
 * the two products are used on the same sentences.
 */
function readFile(data: unknown): { texts: string[]; collection: string | null } {
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
  const root = asRecord(data);
  const rows = Array.isArray(data) ? data
    : Array.isArray(root?.items) ? root.items
      : Array.isArray(root?.sentences) ? root.sentences
        : [];
  const texts: string[] = [];
  for (const row of rows) {
    const record = asRecord(row);
    const text = typeof row === 'string' ? row
      : typeof record?.text === 'string' ? record.text
        : typeof record?.rawInput === 'string' ? record.rawInput
          : null;
    if (text?.trim()) texts.push(text.trim());
  }
  const name = typeof root?.collection === 'string' ? root.collection : null;
  return { texts, collection: name };
}

async function importFile(file: File): Promise<void> {
  say(t('busy_import'));
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    say(t('import_failed', { error: file.name }));
    return;
  }
  const { texts, collection } = readFile(parsed);
  if (!texts.length) {
    say(t('import_empty'));
    return;
  }
  const into = await createCollection(collection ?? file.name.replace(/\.json$/i, ''), lang() === 'de');
  const { addPhrases } = await import('../db/repo.ts');
  const { added, merged } = await addPhrases(texts, [into.key]);
  say(t('done_import', { added, merged }));
  await load();
}

async function wipeEverything(): Promise<void> {
  if (!confirm(t('danger_ask', { n: (await loadPhrases()).length }))) return;
  await wipe();
  say(t('danger_done'));
  location.reload();
}

// ------------------------------------------------------------------ wiring

function showTab(name: string): void {
  for (const tab of document.querySelectorAll<HTMLElement>('#tabs .tab'))
    tab.classList.toggle('on', tab.dataset.tab === name);
  for (const pane of document.querySelectorAll<HTMLElement>('.pane'))
    pane.hidden = pane.dataset.pane !== name;
}

export function wireSettings(): void {
  el('gear').onclick = () => {
    void drawSetup();
    el<HTMLDialogElement>('setup').showModal();
  };
  el('setupclose').onclick = () => el<HTMLDialogElement>('setup').close();
  for (const tab of document.querySelectorAll<HTMLElement>('#tabs .tab'))
    tab.onclick = () => showTab(tab.dataset.tab ?? 'voices');

  const picker = el<HTMLSelectElement>('lang');
  picker.innerHTML = '';
  for (const [code, name] of Object.entries(LANGUAGES)) {
    const option = new Option(name, code);
    if (code === lang()) option.selected = true;
    picker.appendChild(option);
  }
  picker.onchange = () => {
    setLang(picker.value as Lang);
    localStorage.setItem('mitreden.lang', picker.value);
    document.documentElement.lang = picker.value;
    applyLang();
    void drawSetup();
    void load();
  };

  el('export').onclick = () => void exportAll();
  el('import2').onclick = () => el('importfile').click();
  el<HTMLInputElement>('importfile').onchange = (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void importFile(file);
  };
  el('wipe').onclick = () => void wipeEverything();
}

export type { Phrase };
export { collections };
