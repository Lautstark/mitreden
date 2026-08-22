/**
 * Wiring. Every view draws itself from state and knows nothing of the others;
 * this is the only place that knows they all exist.
 */

// Tokens first: they are the values everything below resolves against, and
// they are generated from the declaration shared with bildhaft and vorlaut.
import '@lautstark/design/tokens/mitreden.css';
import './styles/app.css';

import { ensureCollection } from './db/repo.ts';
import { lang, setLang, type Lang } from './i18n/index.ts';
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

export async function start(): Promise<void> {
  chooseLang();
  applyLang();
  wireRail();
  wireComposer();
  wireList();
  wireSettings();
  el('about').onclick = openAbout;
  el('impressum').onclick = openImpressum;
  el('datenschutz').onclick = openDatenschutz;
  el('infoclose').onclick = () => el<HTMLDialogElement>('info').close();
  subscribe(drawRail);
  subscribe(drawList);
  await ensureCollection(lang() === 'de');
  await loadVoices();
  await load();
}

void start();

export type { Lang };
