/* Turning a sentence into sound: piper here, or Azure elsewhere.
 *
 * One piece of mitreden's browser backend; app/backend.js assembles them.
 */
import { loadSettings } from './store.js';
import { modelOf } from './voices.js';

// ------------------------------------------------------------------ piper
// Both come out of vendor/, fetched once by tools/vendor.py and served from
// here. Loaded on demand rather than up front: opening the page should not
// cost a megabyte of decoder nobody has asked to use yet.
let ttsp = null;
export const tts = () => (ttsp ||= import('../vendor/vits-web.js'));

let onProgress = null;
export const setProgress = fn => { onProgress = fn; };   // set while a batch is running, so the page can say so

export async function speak(text, voiceId) {
  if (voiceId.startsWith('azure:')) return speakAzure(text, voiceId.slice(6));
  const t = await tts();
  return t.predict({ text, voiceId: modelOf(voiceId) }, p => {
    if (onProgress && p && p.total)
      onProgress(Math.round(p.loaded * 100 / p.total));
  });
}

// ------------------------------------------------------------------ Azure
//
// The key stays here. The request goes from this browser straight to
// Microsoft and the audio comes straight back; nothing passes through a
// server of ours, because there is not one. That is a stronger promise than
// the old container could make — it wrote the key into a file on a machine
// with no login and told you to put it on your home network.
//
// Kept as a second choice rather than the default on purpose: the piper
// voices work offline, cost nothing and cannot be switched off by anybody.
// A sentence recorded with Azure stops being reproducible the day the
// subscription lapses.
const AZURE_REGIONS = 'westeurope';   // only used to build the two URLs below
const azureHost = r => `https://${r}.tts.speech.microsoft.com/cognitiveservices/v1`;
const azureList = r => `https://${r}.tts.speech.microsoft.com/cognitiveservices/voices/list`;

// Which languages are worth offering. Azure publishes hundreds; a picker
// that long is not a choice, it is a search problem.
const AZURE_LANGS = ['de-', 'en-'];

export async function azureVoices(key, region) {
  const r = await fetch(azureList(region), { headers: { 'Ocp-Apim-Subscription-Key': key } });
  if (!r.ok) throw new Error(r.status === 401 ? 'key-or-region' : `azure-${r.status}`);
  return (await r.json())
    .filter(v => AZURE_LANGS.some(l => v.Locale.startsWith(l)))
    .map(v => ({ id: `azure:${v.ShortName}`, name: v.LocalName || v.DisplayName,
                 lang: v.Locale.slice(0, 2), gender: v.Gender }));
}

export async function speakAzure(text, shortName) {
  const { azure } = await loadSettings();
  if (!azure || !azure.key) throw new Error('No Azure key is set.');
  const locale = shortName.split('-').slice(0, 2).join('-');
  // Escaped rather than interpolated: a sentence is user text and may
  // contain the characters SSML is made of.
  const esc = t => t.replace(/[<>&'"]/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  const ssml = `<speak version="1.0" xml:lang="${locale}">` +
               `<voice name="${shortName}"><prosody rate="-5%">${esc(text)}` +
               `</prosody></voice></speak>`;
  const r = await fetch(azureHost(azure.region || AZURE_REGIONS), {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': azure.key,
               'Content-Type': 'application/ssml+xml',
               // 48 kHz because the levelling measures there anyway
               'X-Microsoft-OutputFormat': 'riff-48khz-16bit-mono-pcm' },
    body: ssml,
  });
  if (!r.ok) throw new Error(`Azure said ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.blob();
}
