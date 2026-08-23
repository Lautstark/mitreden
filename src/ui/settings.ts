/**
 * The settings dialog: voices, language, and your data.
 *
 * The Azure key never leaves this browser. The request goes from here straight
 * to Microsoft and the audio comes straight back; nothing passes through a
 * server of ours, because there is not one.
 */

import { loadPhrases, wipe } from '../db/db.ts';
import { collections, createCollection, saveAzure, settings } from '../db/repo.ts';
import { offered, probeAzure } from '../core/voices.ts';
import { LANGUAGES, lang, setLang, t, tn, type Lang } from '../i18n/index.ts';
import type { Line } from '../db/repo.ts';
import type { Collection, Phrase, Voice } from '../core/types.ts';
import { chosenVoice, knownVoices, loadVoices, onVoiceChange, pickVoice } from './composer.ts';
import { load } from './state.ts';
import { applyLang, el, say, sourceOf, speaks, weighs } from './dom.ts';

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

/**
 * Which voice records, chosen where it is decided rather than beside every
 * sentence. A shipped catalogue is forty-odd voices and an Azure key is
 * hundreds, so the list narrows three ways — the same three stimmquelle's own
 * `ListOptions` narrows by, because a picker and a catalogue want the same
 * questions asked of a voice.
 */
let query = '';
let onlyLang: string | null = null;
let onlyPicks = false;

/**
 * stimmquelle publishes three, and a corpus of several speakers is `mixed`
 * rather than a guess. Anything it adds later is shown as it came, which is
 * honest, rather than as the name of a missing translation.
 */
const genderOf = (gender: string): string =>
  gender === 'female' || gender === 'male' || gender === 'mixed'
    ? t(`gender_${gender}`) : gender;

/** stimmquelle's rule: `de_DE`, `de-DE` and `de` all compare equal. */
const language = (code: string): string =>
  code.toLowerCase().replaceAll('_', '-').split('-')[0]!;

const matches = (voice: Voice): boolean => {
  if (onlyLang && language(voice.locale) !== onlyLang) return false;
  if (onlyPicks && !voice.recommended) return false;
  if (!query) return true;
  const hay = `${voice.label} ${voice.locale} ${sourceOf(voice.source)} ${speaks(voice.locale)}`;
  return hay.toLowerCase().includes(query);
};

/**
 * What a voice is, in the facts that decide between two of them: who renders
 * it, what it speaks, whose voice it is, and what it costs to have. The list
 * used to be a native select of bare names, where "Thorsten" and "Katja" were
 * indistinguishable in every way that matters — one is on this machine, the
 * other is a request to Microsoft per sentence.
 */
function voiceRow(voice: Voice, live: boolean): HTMLElement {
  const row = document.createElement('button');
  row.className = 'voice';
  row.type = 'button';
  row.dataset.id = voice.id;
  // A radio, not a pressed button. aria-pressed on a set where exactly one is
  // ever on describes toggles that happen to agree; this is one choice with
  // several answers, and a screen reader should say "3 of 17" rather than
  // leaving the reader to infer the exclusivity from the drawing.
  row.setAttribute('role', 'radio');
  row.setAttribute('aria-checked', String(live));
  // Roving tabindex: the list runs to hundreds with an Azure key, and tabbing
  // through it to reach the settings underneath is not a way out.
  row.tabIndex = live ? 0 : -1;

  const name = document.createElement('span');
  name.className = 'voice__name';
  name.textContent = voice.label;

  const facts = document.createElement('span');
  facts.className = 'voice__facts';
  // The download is the shipped voices' one real cost and the cloud ones'
  // is the key, so each says the one that applies to it and neither says both.
  facts.textContent = [
    sourceOf(voice.source),
    speaks(voice.locale),
    genderOf(voice.gender),
    voice.needsKey ? t('voice_needs_key') : voice.downloadBytes ? weighs(voice.downloadBytes) : '',
  ].filter(Boolean).join(' · ');

  row.append(name, facts);
  if (voice.recommended) {
    const pick = document.createElement('span');
    pick.className = 'voice__pick';
    pick.textContent = t('voice_recommended');
    row.appendChild(pick);
  }
  row.onclick = () => void pickVoice(voice.id);
  return row;
}

/** One pill per language the catalogue actually offers, plus the way back. */
function drawFilters(voices: readonly Voice[]): void {
  const box = el('voicefilters');
  box.innerHTML = '';
  const codes = [...new Set(voices.map((voice) => language(voice.locale)))]
    .sort((a, b) => speaks(a).localeCompare(speaks(b), lang()));

  const pill = (label: string, on: boolean, run: () => void): void => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.textContent = label;
    chip.setAttribute('aria-pressed', String(on));
    chip.onclick = () => { run(); drawVoices(); };
    box.appendChild(chip);
  };

  pill(t('filter_any_language'), onlyLang === null, () => { onlyLang = null; });
  for (const code of codes)
    pill(speaks(code), onlyLang === code, () => { onlyLang = onlyLang === code ? null : code; });
  // Editorial, and stimmquelle says so: one voice per language-and-gender slot,
  // which is the whole list somebody who does not want to audition forty needs.
  if (voices.some((voice) => voice.recommended))
    pill(t('filter_recommended'), onlyPicks, () => { onlyPicks = !onlyPicks; });
}

export function drawVoices(): void {
  const voices = knownVoices();
  const live = chosenVoice();
  drawFilters(voices);

  const badge = el('voicecount');
  const chosen = voices.find((voice) => voice.id === live);
  badge.textContent = chosen?.label ?? '';
  badge.hidden = !chosen;

  const box = el('voices');
  box.innerHTML = '';
  box.setAttribute('role', 'radiogroup');
  box.setAttribute('aria-label', t('voice_pick_title'));
  const hits = voices.filter(matches);
  if (!hits.length) {
    const none = document.createElement('p');
    none.className = 'hint';
    none.textContent = t('voice_no_match');
    box.appendChild(none);
    return;
  }
  for (const voice of hits) box.appendChild(voiceRow(voice, voice.id === live));
  // Filtering can hide the chosen one, and a group where nothing is reachable
  // by Tab is a group the keyboard cannot enter at all.
  if (!box.querySelector('.voice[tabindex="0"]'))
    box.querySelector<HTMLElement>('.voice')?.setAttribute('tabindex', '0');
}

/** Arrow keys move the choice, as they do in any radio group. */
function stepVoices(event: KeyboardEvent): void {
  const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const rows = [...el('voices').querySelectorAll<HTMLElement>('.voice')];
  const at = rows.indexOf(document.activeElement as HTMLElement);
  if (at < 0 || !rows.length) return;
  event.preventDefault();
  const to = event.key === 'Home' ? 0
    : event.key === 'End' ? rows.length - 1
      : event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? (at + 1) % rows.length
        : (at - 1 + rows.length) % rows.length;
  const next = rows[to]!;
  next.focus();
  void pickVoice(next.dataset.id ?? '');
}

export async function drawSetup(): Promise<void> {
  const saved = await settings();
  const box = el('cloud');
  box.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'card';
  // The bare class names here are hooks for the querySelectors below, not
  // components — which is why none of them may be a name components.css owns.
  // This paragraph was `sub body` and sat inside the settings sheet, so the
  // shared `.sheet .body` region rule reached it and quietly took it from 15px
  // to 14px. v1.4.1 made those rules child combinators and handed it back; the
  // rename is so it cannot be caught again by whatever the vocabulary adds.
  card.innerHTML = `
    <div class="card__head"><h3>Azure Speech</h3><span class="badge state"></span></div>
    <p class="hint probe" role="status"></p>
    <p class="sub says"></p><p class="notice bad warn"></p>
    <label for="azurekey"></label>
    <input id="azurekey" class="field" type="password" autocomplete="off">
    <label class="region" for="azureregion"></label>
    <input id="azureregion" class="field region" type="text" list="azureregions" spellcheck="false">
    <datalist id="azureregions">${AZURE_REGIONS.map((r) => `<option value="${r}">`).join('')}</datalist>
    <p class="hint region"></p>
    <div class="row"><button class="btn primary save"></button><button class="btn quiet forget"></button></div>`;

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
  card.querySelector<HTMLElement>('.says')!.textContent = t('azure_body');
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
    await loadVoices();
    drawVoices();
    await drawSetup();
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
  await loadVoices();
  drawVoices();
  await drawSetup();
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
 *
 * Only our own export names a voice per sentence. bildhaft draws pictograms and
 * has no voices at all, and a bare list is bare — so most files arrive without
 * one, and that is not a gap to report.
 */
function readFile(data: unknown): { lines: Line[]; collection: string | null } {
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
  const root = asRecord(data);
  const rows = Array.isArray(data) ? data
    : Array.isArray(root?.items) ? root.items
      : Array.isArray(root?.sentences) ? root.sentences
        : [];
  const lines: Line[] = [];
  for (const row of rows) {
    const record = asRecord(row);
    const text = typeof row === 'string' ? row
      : typeof record?.text === 'string' ? record.text
        : typeof record?.rawInput === 'string' ? record.rawInput
          : null;
    if (!text?.trim()) continue;
    const voice = typeof record?.voice === 'string' ? record.voice : undefined;
    lines.push({ text: text.trim(), voice });
  }
  const name = typeof root?.collection === 'string' ? root.collection : null;
  return { lines, collection: name };
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
  const { lines, collection } = readFile(parsed);
  if (!lines.length) {
    say(t('import_empty'));
    return;
  }
  const into = await createCollection(collection ?? file.name.replace(/\.json$/i, ''), lang() === 'de');
  const { addPhrases } = await import('../db/repo.ts');
  // Which voices this page can speak in, so a sentence arriving in one it
  // cannot — an Azure voice on a browser with no key — loses it here rather
  // than failing at recording time. Azure's catalogue is memoised, and the
  // dialog this import runs from has already asked for it.
  const here = new Set((await offered((await settings()).azure)).map((voice) => voice.id));
  const { added, merged, revoiced } = await addPhrases(lines, [into.key], here);
  // The count, and then what became of the voices that did not survive the
  // journey. Silence there is what made the picker look like it was ignored.
  say(t('done_import', { added, merged })
    + (revoiced ? t('done_import_revoiced', { n: revoiced }) : ''));
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
  for (const tab of document.querySelectorAll<HTMLElement>('#tabs button'))
    tab.setAttribute('aria-pressed', String(tab.dataset.tab === name));
  for (const pane of document.querySelectorAll<HTMLElement>('.pane'))
    pane.hidden = pane.dataset.pane !== name;
}

/** The dialog, on the tab that answers whatever asked for it. */
export function openSetup(tab = 'voices'): void {
  showTab(tab);
  drawVoices();
  void drawSetup();
  el<HTMLDialogElement>('setup').showModal();
}

export function wireSettings(): void {
  el('gear').onclick = () => openSetup();
  // The composer names the voice in force; this is the way from that name to
  // the place it is decided, which is the whole of what moved.
  el('voicepick').onclick = () => openSetup('voices');
  el('setupclose').onclick = () => el<HTMLDialogElement>('setup').close();
  for (const tab of document.querySelectorAll<HTMLElement>('#tabs button'))
    tab.onclick = () => showTab(tab.dataset.tab ?? 'voices');

  const search = el<HTMLInputElement>('voiceq');
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    drawVoices();
  });
  el('voices').addEventListener('keydown', (event) => stepVoices(event as KeyboardEvent));
  // A pick redraws the list it was made in, so the mark moves with the click.
  onVoiceChange(drawVoices);

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
    drawVoices();
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
