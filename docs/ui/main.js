/* Wiring.
 *
 * The views do not know about each other. They subscribe to the data and draw
 * themselves when it changes, which is what lets each of them be read on its
 * own — the thing the old single file made impossible.
 */

import { $, loadStrings, applyLang, onLanguageChange } from './core.js';
import { subscribe, load, notify } from './state.js';
import { drawRail } from './rail.js';
import { draw as drawList } from './list.js';
import { loadVoices } from './composer.js';
import { drawSetup } from './settings.js';

subscribe(drawRail);
subscribe(drawList);
subscribe(loadVoices);

await loadStrings();
applyLang();
// Changing the language changes the words; everything showing data redraws,
// and the settings dialog too if it happens to be open.
onLanguageChange(() => { notify(); if ($('setup').open) drawSetup(); });
await load();
