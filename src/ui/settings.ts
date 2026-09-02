/**
 * The settings dialog: voices, language, and your data.
 *
 * The Azure key never leaves this browser. The request goes from here straight
 * to Microsoft and the audio comes straight back; nothing passes through a
 * server of ours, because there is not one.
 */

import { countPhrases, phrasesIn, wipe, wipeReaches } from '../db/db.ts';
import { exportEverything, importBackup, isBackup, TOO_NEW } from '../db/backup.ts';
import type { Sicherung } from '@lautstark/sicherung';
import { backupPanel, type BackupPanel } from '@lautstark/sicherung/backup-panel';
import { wherePanel } from '@lautstark/sicherung/ablage-panel';
import { ablage, isStore } from '../db/folder.ts';
import { adoptFolder } from '../db/db.ts';
import { collections, createCollection, saveAzure, settings } from '../db/repo.ts';
import { offered, probeAzure } from '../core/voices.ts';
import { LANGUAGES, lang, setLang, t, tn, type Key, type Lang } from '../i18n/index.ts';
import type { Line } from '../db/repo.ts';
import type { Collection, Phrase } from '../core/types.ts';
import { chosenVoice, knownVoices, loadVoices, onVoiceChange, pickVoice, relangVoice } from './composer.ts';
import { voicePicker } from './voicepicker.ts';
import { ALL, load } from './state.ts';
import { applyLang, busy, el, say, sourceOf, speaks } from './dom.ts';
import { confirmDialog, openDialog } from './dialog.ts';
import { applyTheme, readTheme, saveTheme, THEMES, type Theme } from '@lautstark/design/theme';
import { downloadJson } from '@lautstark/werkzeuge/download';
import { downloadSlug } from '@lautstark/werkzeuge/filename';

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
 * The default a *new* Sammlung starts with — which is what this list is now,
 * and not what the next sentence gets.
 *
 * It is still a setting of the app under §3.10's test, and for a reason
 * stronger than "it is a default": its answer does not change when a different
 * Sammlung is selected, because it is not read off one. It also does real work
 * today rather than only later — a sentence in no Sammlung records in it, which
 * is a state composer.ts creates deliberately when two Sammlungen are open.
 *
 * The list itself is voicepicker.ts, shared with the Sammlung's own sheet.
 */
const defaults = voicePicker({
  search: 'voiceq', chips: 'voicefilters', list: 'voices',
  current: chosenVoice,
  pick: (id) => void pickVoice(id),
});

export const drawVoices = (): void => defaults.draw();

export async function drawSetup(): Promise<void> {
  const saved = await settings();
  const box = el('cloud');
  box.innerHTML = '';

  const card = document.createElement('div');
  // The bare class names here are hooks for the querySelectors below, not
  // components — which is why none of them may be a name components.css owns.
  // This paragraph was `sub body` and sat inside the settings sheet, so the
  // shared `.sheet .body` region rule reached it and quietly took it from 15px
  // to 14px. v1.4.1 made those rules child combinators and handed it back; the
  // rename is so it cannot be caught again by whatever the vocabulary adds.
  //
  // No head and no card: the panel's summary names this and says whether Azure
  // holds a key, which is the whole point of a heading that carries its state.
  card.innerHTML = `
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
  // Which key, not merely that there is one: the last four characters tell
  // two keys apart without giving either away. It sits in the panel's heading,
  // so the answer is there before the panel is opened.
  el('azurestate').textContent = azure
    ? t('key_hint', { hint: azure.key.slice(-4) })
    : t('key_none');

  /*
   * The probe line is a live region, and it is never hidden — §3.8. It used to
   * be toggled with `[hidden]` when no key was stored, which is one of the two
   * ways that section names for getting silence: the element leaves the
   * accessibility tree and comes back carrying its next message.
   *
   * What saved it in practice was luck of timing. The answer arrives from a
   * promise, so by then the region was on screen and empty and the change was
   * noticed; only the synchronous "asking…" was lost. Removing the need to
   * reason about that is the whole point of the rule, so what is emptied now is
   * the text. Empty, a <p> with no content takes no room, which is why it can
   * stay.
   *
   * It is a second region in this page, and a legitimate one: it reports inside
   * a modal, and the page's own status line is inert behind that modal while it
   * is open. §3.8 allows exactly this.
   */
  const probe = card.querySelector<HTMLElement>('.probe')!;
  if (!azure) {
    probe.textContent = '';
  } else {
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
  busy('key_checking');
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
  // Off the membership index rather than by filtering the whole library.
  const items = await phrasesIn(collection.id);
  downloadJson({ collection: collection.name, items },
               `mitreden-${downloadSlug(collection.name, 'sammlung')}-${stamp()}.json`);
}

/**
 * The Sicherung: everything, in the one format that survives coming back.
 *
 * This used to write a bare array of sentences, which importFile then read
 * into a single new Sammlung — so a library went out whole and came back as
 * one heap. db/backup.ts carries the shape that keeps the Sammlungen apart,
 * and the file it writes is the same one the standing backup puts in the
 * chosen folder.
 */
async function exportAll(): Promise<void> {
  // The notice travels inside the file, so it is written in the language the
  // page is in rather than in whichever one the db layer happened to hold.
  downloadJson(await exportEverything(t('backup_notice')), `mitreden-sicherung-${stamp()}.json`);
}

/* The date every export here carries. vorlaut deliberately stamps none of its
 * package exports, so this is the product's and not the package's — see
 * @lautstark/werkzeuge/download, which takes a filename whole. */
const stamp = (): string => new Date().toISOString().slice(0, 10);

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

/**
 * A file in, sentences in the list.
 *
 * Exported because ui/shelf.ts takes the same path: a link naming a published
 * Sammlung and a file somebody picked are one act with two doors, and a second
 * copy of this is how the second door ends up not saying what the first says.
 */
export async function importFile(file: File): Promise<string | null> {
  busy('busy_import');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    say(t('import_failed', { error: file.name }));
    return null;
  }

  // A full Sicherung takes the path that keeps its Sammlungen; everything else
  // — an older mitreden file, a bildhaft archive, a bare list — goes on
  // reading exactly as it did, because a file somebody already has must keep
  // working.
  if (isBackup(parsed)) {
    try {
      const done = await importBackup(parsed);
      say(t('done_restore', { ...done }));
      await load();
    } catch (error) {
      // The db layer has no language and answers with a code; this is where
      // the code becomes a sentence.
      say(error instanceof Error && error.message === TOO_NEW
        ? t('backup_too_new')
        : t('import_failed', { error: file.name }));
    }
    /* A whole-library Sicherung restores every Sammlung it holds, so there is
       no one of them to hand back and nothing for a caller to open. */
    return null;
  }

  const { lines, collection } = readFile(parsed);
  if (!lines.length) {
    say(t('import_empty'));
    return null;
  }
  const { addPhrases, votedVoice } = await import('../db/repo.ts');
  // Which voices this page can speak in, so a voice arriving with a sentence it
  // cannot honour — an Azure voice on a browser with no key — is discounted
  // here rather than failing at recording time. Azure's catalogue is memoised,
  // and the dialog this import runs from has already asked for it.
  const here = new Set((await offered((await settings()).azure)).map((voice) => voice.id));
  /* The Sammlung takes the voice the file was made in, rather than the sentences
     each keeping their own: the voice belongs to the Sammlung now, so that is
     where a file's voice has to land for the same file to record the same way on
     a second device. A file whose sentences disagree gives the Sammlung the one
     most of them used — see votedVoice. */
  const into = await createCollection(
    collection ?? file.name.replace(/\.json$/i, ''), lang() === 'de', votedVoice(lines, here),
  );
  const { added, merged, revoiced } = await addPhrases(lines, into.id, here);
  // The count, and then what became of the voices that did not survive the
  // journey. Silence there is what made the picker look like it was ignored.
  say(t('done_import', { added, merged })
    + (revoiced ? t('done_import_revoiced', { n: revoiced }) : ''));
  await load();
  return into.id;
}

/**
 * „Alles löschen", and how far it actually goes.
 *
 * The sentence differs by where the work lives, and the difference is not a
 * nicety: with a folder as the store this deletes the files, so it deletes on
 * every device in the household. „Das lässt sich nicht rückgängig machen" was
 * true and said nothing about the phone in the next room.
 *
 * And with the folder out of reach it is refused rather than asked. Running it
 * there would empty this browser, leave the folder whole, and hand everything
 * back on the next start — a delete that reports success and undoes itself,
 * which is the exact failure db.ts's `wipe` was fixed for. Refusing is the
 * honest answer; a half-delete is not.
 */
async function wipeEverything(): Promise<void> {
  const reach = wipeReaches();
  const folder = 'folder' in ablage.status ? ablage.status.folder : '';

  if (reach === 'unreachable') {
    /* Built by hand: `el` here reads an element by id, it does not make one —
       the family's other two products mean the opposite by that name. See the
       family review of 2026-09-02. */
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn primary';
    ok.textContent = t('understood');
    const sheet = openDialog({
      title: t('danger_blocked_title'),
      body: [t('danger_blocked', { folder })],
      footer: [ok],
    });
    ok.addEventListener('click', () => sheet.close());
    return;
  }

  if (!await confirmDialog({
    title: t('danger_title'),
    body: reach === 'folder'
      ? t('danger_ask_folder', { n: await countPhrases(), folder })
      : t('danger_ask_browser', { n: await countPhrases() }),
    confirmLabel: t('danger_do'),
    danger: true,
    /* The one act in this product that asks for a word. It empties the library
       on every device the household has; design.md §4.3 says this is what the
       friction is for, and that spending it anywhere else is what breaks it. */
    requireTyping: t('danger_word'),
    typingLabel: t('danger_type'),
  })) return;
  await wipe();
  say(t('danger_done'));
  location.reload();
}

// ------------------------------------------------------------------ wiring

/*
 * The scheme, and where it is kept.
 *
 * localStorage like the language above it, and for a sharper reason: the scheme
 * has to be readable before the first paint or the page flashes the OS's answer
 * and then corrects itself. That rules out the database the sentences live in,
 * which is asynchronous. @lautstark/design/theme carries the reasoning; the
 * inline script in index.html is the half that runs before this module exists.
 */
const THEME_KEY = 'mitreden.theme';

const themeLabel = (theme: Theme): string => t(`theme_${theme}` as Key);

/** Both languages, with the one in force pressed.
 *
 * Each names itself whatever the page is set to. The control is what somebody
 * reaches for when they cannot read the interface around it, so it must not
 * depend on being able to read the interface around it. */
function drawLang(): void {
  const current = lang();
  const box = el('lang');
  box.innerHTML = '';
  for (const [code, name] of Object.entries(LANGUAGES)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.setAttribute('aria-pressed', String(code === current));
    button.onclick = () => chooseLang(code as Lang);
    box.appendChild(button);
  }
}

/** The three answers, with the one in force pressed. */
function drawTheme(): void {
  const current = readTheme(THEME_KEY);
  const box = el('theme');
  box.innerHTML = '';
  for (const theme of THEMES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = themeLabel(theme);
    button.setAttribute('aria-pressed', String(theme === current));
    button.onclick = () => {
      saveTheme(THEME_KEY, theme);
      applyTheme(theme);
      // Redraw this control and its heading only. Nothing else on the page
      // depends on the scheme — the tokens do that work, which is the point of
      // there being tokens.
      drawTheme();
      drawStates();
    };
    box.appendChild(button);
  }
}

/**
 * What each panel holds, said in its own heading.
 *
 * This is the whole reason the tabs went: a tab is a promise that something is
 * behind it, and you have to open it to find out what. A heading that already
 * says "Kristin · Mitgeliefert · Englisch", "Kein Schlüssel" or "42 Sätze" is
 * usually the entire question, and opening becomes a decision rather than the
 * only way to look.
 */
function drawStates(): void {
  const voice = knownVoices().find((one) => one.id === chosenVoice());
  el('voicestate').textContent = voice
    ? `${voice.label} · ${sourceOf(voice.source)} · ${speaks(voice.lang)}`
    : t('voice_none');
  el('langstate').textContent = LANGUAGES[lang()];
  drawLang();
  // ALL(), not loadPhrases(): the sentences are already in memory, and a
  // heading that carries state has to carry it from the first frame. Reading
  // the database here left this line blank at the moment somebody was reading
  // it — which is the one thing this shape promises not to do.
  const n = ALL().length;
  el('datastate').textContent = n ? tn('count', n) : t('count_none');
  el('themestate').textContent = themeLabel(readTheme(THEME_KEY));
}

/**
 * The words this page is in. The button says which; the menu offers the rest,
 * so there is no state to mark twice.
 */
function chooseLang(code: Lang): void {
  setLang(code);
  localStorage.setItem('mitreden.lang', code);
  document.documentElement.lang = code;
  applyLang();
  /* The backup panel holds no data-i18n — it paints its own words — so
     applyLang() above cannot reach it. It reads lang() on every paint, so one
     repaint is the whole of what it needs. */
  keeping?.refresh();
  // Before the picker redraws, so it marks the voice this page now starts in.
  relangVoice();
  drawVoices();
  // The three scheme labels are words like any other, and they are drawn from
  // TS rather than carried by data-i18n, so applyLang() above cannot reach them.
  drawTheme();
  drawStates();
  void drawSetup();
  void load();
}


/* Held so that a language change can repaint it, and null where the browser has
   no picker or a store folder makes the offer redundant. */
let keeping: BackupPanel | null = null;

/** The dialog, with the panel that answers whatever asked for it unfolded. */
/* No panel argument, and none is wanted.
 *
 * It used to take one and deep-link into that panel, which is how the
 * composer's „Ändern" button reached the voice section. That button went on
 * 2026-08-29 - the line under the box states and does not route - and with it
 * the only caller that ever passed an argument. What was left was a parameter
 * nothing supplied and an openPanel() nothing reached, which is worse than
 * nothing: it reads as a seam somebody may still be using.
 *
 * Also no longer exported. The gear below is the one caller and it is in this
 * file, so the entrance is where the sheet is. */
function openSetup(): void {
  drawVoices();
  drawTheme();
  drawStates();
  // The key lives in the database, so this one heading cannot be answered
  // synchronously on a first open. It says it is fetching rather than saying
  // nothing: a state is what this summary is for, and empty is not one. Later
  // opens find the previous answer still written.
  const azure = el('azurestate');
  if (!azure.textContent) azure.textContent = t('loading');
  void drawSetup();
  el<HTMLDialogElement>('setup').showModal();
}

export function wireSettings(backup: Sicherung): void {
  /* The store panel comes from the package, so every Lautstark programme shows
     the same one. What stays here is what mitreden alone offers besides it. */
  const store = wherePanel({
    store: ablage,
    adopt: adoptFolder,
    changed: () => void load(),
    say,
    lang: lang() === 'en' ? 'en' : 'de',
  });
  el('wherebox').append(store.node);
  /* Only where there is no store folder: with one, the copies already go beside
     the work, and a second picker would be the same offer under a name that
     reads almost the same. */
  /* Only where there is no store folder: with one, the copies already go beside
     the work, and a second picker would be the same offer under a name that
     reads almost the same. */
  if (isStore()) el('folderbox').hidden = true;
  else {
    /* The 161 lines this replaces are @lautstark/sicherung/backup-panel's now —
       words, markup, the age rule — beside the wherePanel above that already
       came from there. What mitreden kept is `lang`, and it is a function
       rather than a value on purpose: this page changes language without
       reloading, and a locale captured once answers in the language the reader
       has just left while staying perfectly well-formed. That was mitreden's
       own rule and it is the module's now. */
    keeping = backupPanel({ backup, say, lang: () => (lang() === 'en' ? 'en' : 'de') });
    if (keeping) el('folderbox').append(keeping.node);
    else el('folderbox').hidden = true;
  }
  el('gear').onclick = () => openSetup();
  el('setupclose').onclick = () => el<HTMLDialogElement>('setup').close();
  // A pick redraws the list it was made in, so the mark moves with the click —
  // and the heading, which names the voice in force.
  onVoiceChange(() => { drawVoices(); drawStates(); });

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
