/**
 * Wiring. Every view draws itself from state and knows nothing of the others;
 * this is the only place that knows they all exist.
 */

// Tokens first: they are the values everything below resolves against, and
// they are generated from the declaration shared with bildhaft and vorlaut.
import '@lautstark/design/tokens/mitreden.css';
import '@lautstark/design/components.css';
import './styles/app.css';

import { ensureCollection } from './db/repo.ts';
import { exportEverything } from './db/backup.ts';
import { discardEverything, isRefusal, onChanged, pullFromFolder } from './db/db.ts';
import { Sicherung } from '@lautstark/sicherung';
import { ablage, adopted, watchFolder } from './db/folder.ts';
import { confirmDialog } from './ui/dialog.ts';
import { lang, setLang, t, type Lang } from './i18n/index.ts';
import { initTheme } from '@lautstark/design/theme';
import { loadVoices, wireComposer } from './ui/composer.ts';
import { wireCollectionVoice } from './ui/collectionVoice.ts';
import { draw as drawList, recordAgain, wireList } from './ui/list.ts';
import { rekeyIfNeeded } from './db/rekey.ts';
import { drawRail, wireRail } from './ui/rail.ts';
import { openAbout, openDatenschutz, openImpressum } from './ui/info.ts';
import { openNamed } from './ui/shelf.ts';
import { wireSettings } from './ui/settings.ts';
import { applyLang, byId } from './ui/dom.ts';
import { load, restoreOpen, subscribe } from './ui/state.ts';

function chooseLang(): void {
  const asked = new URL(location.href).searchParams.get('lang');
  const saved = localStorage.getItem('mitreden.lang');
  const wanted = asked ?? saved ?? navigator.language.slice(0, 2);
  setLang(wanted === 'en' ? 'en' : 'de');
  document.documentElement.lang = lang();
}

/*
 * The standing backup. `exportEverything` is what it is handed and the only
 * thing it is ever handed — the audited artefact, which carries the sentences
 * and the Sammlungen and drops the Azure key on the way out. A chosen folder
 * is very likely inside Dropbox, so what goes in it leaves the machine, and a
 * credential in that file would be posted to somebody's cloud and then to
 * every device sharing the folder. tests/unit/backup-payload.test.ts holds
 * this wiring in place; a failure there is a leak, not a bug.
 */
const backup = new Sicherung({
  app: 'mitreden',
  // The notice is written in the language the page is in — it travels inside
  // the file, and this app ships in two.
  produce: () => exportEverything(t('backup_notice')),
  // Nothing in this browser. @lautstark/sicherung v1.3.0 holds a write that
  // would put that over a folder holding the real thing, but only because this
  // line says what mitreden's emptiness looks like — the package deliberately
  // knows nothing about phrases or collections.
  //
  // Both, not either: a collection with no phrases in it is a name somebody
  // typed and nothing more, and a phrase belongs to a collection, so neither
  // alone means there is something here worth protecting.
  looksEmpty: (produced) => {
    const it = produced as { collections?: unknown[]; phrases?: unknown[] };
    return it.collections?.length === 0 && it.phrases?.length === 0;
  },
});

// Every write that changes what a Sicherung would contain, through the one
// notifier in db.ts. Debounced inside Sicherung, so a burst is one file.
onChanged(() => backup.schedule());

export async function start(): Promise<void> {
  chooseLang();
  // The attribute is already set by the inline script in index.html; this is
  // the address bar, which needs the tokens imported above to read a --bg from,
  // and the listener that keeps it right when the OS turns over under a page
  // that is following it.
  initTheme('mitreden.theme');
  applyLang();
  wireRail();
  wireComposer();
  wireList();
  wireCollectionVoice(recordAgain);
  wireSettings(backup);
  byId('about').onclick = openAbout;
  byId('impressum').onclick = openImpressum;
  byId('datenschutz').onclick = openDatenschutz;
  byId('infoclose').onclick = () => byId<HTMLDialogElement>('info').close();
  subscribe(drawRail);
  subscribe(drawList);
  await ensureCollection(lang() === 'de');
  // Before load(), which is what computes every sentence's state: a library
  // still carrying the old names would otherwise paint itself entirely
  // „geändert seit der Aufnahme" for one frame and settle a moment later.
  // Silent, because nothing a person asked for happened — the recordings are
  // the ones they already had, under the name CONTRACT.md §3 gives them.
  /* Before anything is read. Where a folder is the store it is the truth, and a
     first paint from the browser's copy would be a library that changes under
     somebody a moment later. */
  await ablage.restore().catch(() => null);
  await pullFromFolder().catch(() => false);

  await rekeyIfNeeded();
  await loadVoices();
  // Which Sammlungen were open, before anything is drawn — otherwise the first
  // paint is whatever load() would have fallen back to, and it is replaced a
  // frame later by where the person actually was (§1.2).
  await restoreOpen();
  await load();
  // Never prompts — there is no gesture here. A folder needing its permission
  // re-confirmed lands in needs-permission and says so in Einstellungen →
  // Daten, which is where the click can happen.
  /* Where the work already lives in a folder, the dated copies go beside it: the
     store fills `<folder>/mitreden/` and these are flat files above it, so nobody
     is asked to pick a second folder that reads like the first. */
  const held = ablage.handle();
  if (held) await backup.useFolder(held).catch(() => undefined);
  else await backup.restore().catch(() => undefined);

  if (await adopted()) {
    watchFolder(() => void pullFromFolder().then(() => void load()));
  }
  /* Last, and after load(): this may add a Sammlung and needs the list it lands
     in to be drawn. It never rejects — see ui/shelf.ts — so start()'s own catch
     goes on meaning „the page failed to open". */
  await openNamed();
}

/**
 * The one failure that has to be spoken to rather than logged.
 *
 * A library this version has no step for leaves the database untouched and the
 * page with nothing on it, which on its own reads as a broken app — and the
 * one thing somebody must not do in that state is assume it is empty and go
 * looking for their backup. So it says what happened, and offers the discard
 * that used to happen silently on this exact path. Declining leaves everything
 * where it is: a step can be written later, and the records will still be
 * there for it.
 */
async function refused(): Promise<void> {
  chooseLang();
  if (!await confirmDialog({
    title: t('db_refused_title'),
    body: t('db_refused_body'),
    confirmLabel: t('db_refused_do'),
    danger: true,
  })) return;

  await discardEverything();
  location.reload();
}

void start().catch((error: unknown) => {
  if (isRefusal(error)) return refused();
  throw error;
});

export type { Lang };
