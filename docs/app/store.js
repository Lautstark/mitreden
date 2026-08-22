/* Everything that is kept, and where.
 *
 * Two stores: the sentences, which are the only irreplaceable thing here,
 * and the audio, which can always be made again.
 *
 * One piece of mitreden's browser backend; app/backend.js assembles them.
 */

import { DEFAULT_VOICE } from './voices.js';
import { normTag } from './ids.js';

// ------------------------------------------------------------------ store
//
// Two stores: the sentences, which are the only irreplaceable thing here,
// and the audio, which can always be made again. Keeping the audio means a
// reload does not re-record everything, and a voice change only re-records
// what actually changed.
const DB_NAME = 'mitreden', DB_VERSION = 1;
let dbp = null;

export function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      if (!d.objectStoreNames.contains('audio')) d.createObjectStore('audio');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

export async function idb(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const loadPhrases = () => idb('meta', 'readonly', s => s.get('phrases')).then(v => v || []);
// The declared Sammlungen, in the order they were made. Kept apart from the
// sentences on purpose: a Sammlung just created is empty, and one derived
// from its members could not exist yet. That is the whole difference between
// a label and a place you work in.
// Stored as {key, name}: the key is what a sentence points at and never
// moves, the name is what you called it and keeps its capitals and umlauts.
// The same split the sentences already use — an id is a file name, a text is
// something to read — and for the same reason: renaming must not orphan
// anything.
export const loadCollections = () => idb('meta', 'readonly', s => s.get('collections'))
  .then(v => (v || []).map(c => typeof c === 'string' ? { key: c, name: c } : c));

// A sentence always belongs to a Sammlung, which means there always has to
// be one — bildhaft's rule, and it removes a whole class of question the
// page would otherwise have to ask. On an empty database one is made, named
// after the day, the same way a new notebook gets a date on the cover.
export const defaultName = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${LANG_DE ? 'Sammlung vom' : 'Collection of'} ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};
export let LANG_DE = true;                   // set from the page, only affects the name
// An imported binding cannot be assigned from the module that imported it, so
// the page's language never arrived and an English page named its first
// Sammlung in German.
export const setLangDe = value => { LANG_DE = value; };

export async function ensureCollection() {
  const declared = await loadCollections();
  if (declared.length) return declared;
  const name = defaultName();
  const made = [{ key: normTag(name) || 'sammlung', name }];
  await saveCollections(made);
  return made;
}
export const saveCollections = v => idb('meta', 'readwrite', s => s.put(v, 'collections'));
export const savePhrases = items => idb('meta', 'readwrite', s => s.put(items, 'phrases'));
export const loadSettings = () => idb('meta', 'readonly', s => s.get('settings')).then(v => v || {});
export const saveSettings = v => idb('meta', 'readwrite', s => s.put(v, 'settings'));
export const getAudio = id => idb('audio', 'readonly', s => s.get(id));
export const putAudio = (id, blob) => idb('audio', 'readwrite', s => s.put(blob, id));
export const dropAudio = id => idb('audio', 'readwrite', s => s.delete(id));

export const activeVoice = async () => (await loadSettings()).voice || DEFAULT_VOICE;
