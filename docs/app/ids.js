/* Names, twins and fingerprints.
 *
 * Ported from mitreden.py and deliberately unchanged: an id is a file name,
 * and the file it names may long since be sitting on a talker.
 *
 * One piece of mitreden's browser backend; app/backend.js assembles them.
 */

import { OUT, ENGINE_VERSION } from './settings.js';
import { modelOf } from './voices.js';

// ---------------------------------------------------------- ids and twins
//
// Ported from mitreden.py, unchanged in behaviour on purpose: an id is a
// file name, and a file name may long since be sitting on a talker.
export const SLUG_WORDS = 6, SLUG_CHARS = 40;

export function slug(text, fallback = 'phrase') {
  const keep = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const sub = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss', 'é': 'e', 'è': 'e' };
  let out = '';
  for (const ch of text.toLowerCase().trim())
    for (const c of (sub[ch] || ch)) out += keep.includes(c) ? c : '-';
  const words = out.split('-').filter(Boolean);
  const short = [];
  for (const w of words.slice(0, SLUG_WORDS)) {
    if (short.length && short.concat(w).join('-').length > SLUG_CHARS) break;
    short.push(w);
  }
  return short.join('-').slice(0, SLUG_CHARS).replace(/^-+|-+$/g, '') || fallback;
}

// Cutting at 24 characters can land mid-word and leave the separator dangling.
// Trimming it keeps normTag(normTag(x)) === normTag(x), which every caller
// that stores a key and later looks it up quietly depends on.
export const normTag = text => slug(text, '').slice(0, 24).replace(/-+$/, '');
// Punctuation stays in: "Nochmal!" and "Nochmal." are spoken differently.
export const normText = text => text.split(/\s+/).filter(Boolean).join(' ').toLowerCase();
export const findTwin = (items, text) => {
  const key = normText(text);
  return items.find(i => normText(i.text) === key) || null;
};

export function freeId(items, text) {
  const base = slug(text);
  const taken = new Set(items.map(i => i.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}


export async function fingerprint(text, voiceId) {
  // Azure renders on somebody else's machine, so which engine is vendored
  // here says nothing about how those recordings came out. Naming it would
  // re-record every cloud-spoken sentence on an upgrade that cannot have
  // changed them. Same rule the container followed.
  const cloud = voiceId.startsWith('azure:');
  const payload = JSON.stringify(cloud
    ? [text, 'azure', voiceId.slice(6), OUT]
    : [text, 'piper', modelOf(voiceId), ENGINE_VERSION, OUT]);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}
