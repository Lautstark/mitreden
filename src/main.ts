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
import { onChanged } from './db/db.ts';
import { Sicherung } from '@lautstark/sicherung';
import { lang, setLang, type Lang } from './i18n/index.ts';
import { initTheme } from '@lautstark/design/theme';
import { loadVoices, wireComposer } from './ui/composer.ts';
import { draw as drawList, wireList } from './ui/list.ts';
import { drawRail, wireRail } from './ui/rail.ts';
import { openAbout, openDatenschutz, openImpressum } from './ui/info.ts';
import { wireSettings } from './ui/settings.ts';
import { applyLang, el } from './ui/dom.ts';
import { load, subscribe } from './ui/state.ts';

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
const backup = new Sicherung({ app: 'mitreden', produce: exportEverything });

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
  wireSettings(backup);
  el('about').onclick = openAbout;
  el('impressum').onclick = openImpressum;
  el('datenschutz').onclick = openDatenschutz;
  el('infoclose').onclick = () => el<HTMLDialogElement>('info').close();
  subscribe(drawRail);
  subscribe(drawList);
  await ensureCollection(lang() === 'de');
  await loadVoices();
  await load();
  // Never prompts — there is no gesture here. A folder needing its permission
  // re-confirmed lands in needs-permission and says so in Einstellungen →
  // Daten, which is where the click can happen.
  await backup.restore().catch(() => undefined);
}

void start();

export type { Lang };
