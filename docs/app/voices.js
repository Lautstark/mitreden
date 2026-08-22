/* Which voices exist, what they are called, and which may be shipped.
 *
 * The catalogue is stimmquelle's; the filtering and the labels are ours.
 *
 * One piece of mitreden's browser backend; app/backend.js assembles them.
 */
import { CATALOGUE } from './settings.js';

// ---------------------------------------------------------------- voices
//
// Not a list here any more. It comes from Lautstark/stimmquelle, vendored by
// tools/vendor.py and baked into the page by tools/build-site.py the same way
// the interface strings are — this file runs as a plain script so that it is
// ready before the page's own, which leaves it unable to import and unable to
// wait for a fetch. Same problem the strings have, same answer.
//
// vorlaut reads the same file. It used to be an array here and another there,
// arrived at separately rather than copied, and the rule about which voices
// may be handed on was written out in full in three places. All three were
// correct on the day a CC BY-NC-SA voice was sitting in this array, because a
// list of voices with no room for a reason only ever records what passed.
//
// Three conditions, not two. A voice must be free to hand on, it must speak
// in a browser, and any attribution its licence attaches has to be one this
// page renders — which it does not, so anything owing one is left out rather
// than offered on a permission we have not met. That currently costs
// de_DE-mls-medium, and the way to get it is to show the notice.
export const VOICES = CATALOGUE
  .filter(v => v.licence.ship && v.browser === 'ok' && !v.licence.attribution)
  .map(v => ({ id: `piper:${v.id}`, name: v.name, lang: v.lang,
               quality: v.quality, mb: Math.round(v.bytes / 1048576) }));

export const DEFAULT_VOICE = VOICES[0].id;
export const modelOf = id => id.replace(/^piper:/, '');
// Name, where it comes from, which language — the three things that tell two
// entries apart. The quality tier is normally a file-name detail and stays
// out, but when the same voice is offered in two tiers it is the only thing
// that distinguishes them, and two identical rows in a picker is worse than
// a word most people can ignore.
export const labelOf = v => {
  const twin = VOICES.some(o => o !== v && o.name === v.name && o.lang === v.lang);
  return [v.name + (twin && v.quality ? ` (${v.quality})` : ''), 'piper', v.lang]
    .join(' \u00b7 ');
};
export const voiceById = id => VOICES.find(v => v.id === id);
// The catalogue plus whatever Azure is currently offering. Kept async and
// separate because the cloud half needs a network call and most callers do
// not need it.
const anyVoice = async id => {
  const local = voiceById(id);
  if (local || !id.startsWith('azure:')) return local || null;
  return (await listVoices()).find(v => v.id === id) || null;
};

