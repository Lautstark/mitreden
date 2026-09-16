/**
 * What the Einstellungen sheet *does*: files out, files in, and the one act
 * that destroys something.
 *
 * The sheet itself is SetupSheet.svelte and its panels are components beside
 * it. What stayed here is the half that is not drawing — and it stayed under
 * this name rather than moving to a better one because tests/unit/shelf.test.ts
 * mocks `src/ui/settings.ts` for `importFile`. A module path a unit test names
 * is part of the contract, and the rename would be a change to a unit test made
 * to suit a refactor of the layer above it.
 *
 * The Azure key never leaves this browser. The request goes from the panel
 * straight to Microsoft and the audio comes straight back; nothing passes
 * through a server of ours, because there is not one.
 */

import { countPhrases, phrasesIn } from '../db/phrases.ts';
import { wipe, wipeReaches } from '../db/wipe.ts';
import { exportEverything, importBackup, isBackup, TOO_NEW } from '../db/backup.ts';
import { ablage } from '../db/folder.ts';
import { createCollection, settings } from '../db/repo.ts';
import { offered } from '../core/voices.ts';
import { lang, t } from './words.svelte.ts';
import type { Line } from '../db/repo.ts';
import type { Collection } from '../core/types.ts';
import { load } from './store.svelte.ts';
import { busy, say } from './dom.ts';
import { confirmDialog, openDialog } from './dialog.ts';
import { downloadJson } from '@lautstark/werkzeuge/download';
import { downloadSlug } from '@lautstark/werkzeuge/filename';

/* The date every export here carries. vorlaut deliberately stamps none of its
 * package exports, so this is the product's and not the package's — see
 * @lautstark/werkzeuge/download, which takes a filename whole. */
const stamp = (): string => new Date().toISOString().slice(0, 10);

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
export async function exportAll(): Promise<void> {
  // The notice travels inside the file, so it is written in the language the
  // page is in rather than in whichever one the db layer happened to hold.
  downloadJson(await exportEverything(t('backup_notice')), `mitreden-sicherung-${stamp()}.json`);
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
export async function wipeEverything(): Promise<void> {
  const reach = wipeReaches();
  const folder = 'folder' in ablage.status ? ablage.status.folder : '';

  if (reach === 'unreachable') {
    /* Built by hand, into @lautstark/design/dialog's own footer. One button in
       a frame the package draws is not markup this product owns, and a
       component for it would be a file holding a single <button>. */
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
