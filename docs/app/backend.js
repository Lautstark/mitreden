/* The browser backend: everything ui.html asks for, answered here.
 *
 * It answers the routes mitreden.py used to answer, and hands back a Response,
 * so the interface cannot tell that there is no server. The pieces it is made
 * of are the other files in this folder, one concern each.
 */

import { OUT } from './settings.js';
import { VOICES, DEFAULT_VOICE, modelOf, labelOf, voiceById } from './voices.js';
import {
  db, idb, loadPhrases, savePhrases, loadCollections, saveCollections,
  ensureCollection, defaultName, loadSettings, saveSettings,
  getAudio, putAudio, dropAudio, activeVoice,
} from './store.js';
import { normTag, normText, findTwin, freeId, fingerprint, slug } from './ids.js';
import { speak, azureVoices, setProgress } from './speak.js';
import { process as makeAudio, asFormat } from './media.js';
import { zip } from './zip.js';

// ------------------------------------------------------------- recording
async function render(item, force = false, voiceId = null) {
  const vid = voiceId || item.voice_id || await activeVoice();
  const fp = await fingerprint(item.text, vid);
  if (!force && item.fingerprint === fp && await getAudio(item.id)) return false;
  const wav = await speak(item.text, vid);
  await putAudio(item.id, await makeAudio(wav));
  item.fingerprint = fp;
  item.backend = 'piper';
  item.voice_id = vid;
  return true;
}

async function state(item) {
  if (!(await getAudio(item.id))) return 'missing';
  const vid = item.voice_id || await activeVoice();
  return item.fingerprint === await fingerprint(item.text, vid) ? 'ok' : 'stale';
}

// ---------------------------------------------------------------- routes
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (msg, status = 400) => new Response(msg, { status });

async function listVoices() {
  const active = await activeVoice();
  const out = VOICES.map(v => ({ id: v.id, label: labelOf(v), backend: 'piper' }));
  const { azure } = await loadSettings();
  if (azure && azure.key) {
    try {
      for (const v of await azureVoices(azure.key, azure.region))
        out.push({ id: v.id, label: [v.name, 'azure', v.lang].join(' \u00b7 '), backend: 'azure' });
    } catch (e) {
      // A key that has stopped working must not empty the picker: the piper
      // voices still speak, and a sentence already recorded with Azure keeps
      // its name.
      console.warn('Azure voices unavailable:', e.message);
    }
  }
  return out.map(v => ({ ...v, active: v.id === active }));
}

async function phrasesWithState() {
  const items = await loadPhrases();
  const active = await activeVoice();
  const out = [];
  for (const i of items) {
    const v = voiceById(i.voice_id || active);
    out.push({ ...i, collections: i.collections || [], state: await state(i),
               voice: v ? labelOf(v) : (i.voice_id || '') });
  }
  await refreshUrls(out);        // the player asks for these while drawing
  // Declared order first, then anything a sentence carries that was never
  // declared — an imported file, say. Neither is dropped.
  const declared = await ensureCollection();
  const used = new Set(out.flatMap(i => i.collections || []));
  const all = declared.concat([...used]
    .filter(k => !declared.some(c => c.key === k))
    .map(k => ({ key: k, name: k })));      // arrived on a sentence, never declared

  const av = voiceById(active);
  return { items: out, voice: av ? labelOf(av) : active, format: OUT.format,
           collections: all.map(c => ({ ...c,
             count: out.filter(i => (i.collections || []).includes(c.key)).length })) };
}

async function get(route) {
  if (route === '/api/strings') return json(window.MITREDEN_STRINGS || {});
  if (route.startsWith('/api/lang/')) { LANG_DE = route.endsWith('/de'); return json({ ok: true }); }
  // No cloud services here. A key typed into a public page would be a
  // different promise than the one the container makes, so the panel stays
  // empty rather than half-true.
  if (route === '/api/setup') {
    const { azure } = await loadSettings();
    return json({
      cloud: [{ id: 'azure', label: 'Azure Speech', needs_region: true,
                set: !!(azure && azure.key), region: (azure && azure.region) || 'westeurope' }],
      voices: (await listVoices()).length, backup: true });
  }

  // The same file the container keeps: a plain list, so a copy made here
  // can be dropped next to mitreden.py and the other way round. Only the
  // sentences — the audio can always be made again, and would turn a
  // backup you can read into a download you cannot.
  if (route === '/api/voices') return json(await listVoices());
  if (route === '/api/phrases') return json(await phrasesWithState());
  return fail('Unknown route.', 404);
}

async function post(route, body) {
  body = body || {};
  const items = await loadPhrases();

  if (route === '/api/phrases') {
    const collections = (body.collections || []).map(normTag).filter(Boolean);
    // Whatever is open in the sidebar is declared too, so a sentence typed
    // into a Sammlung lands there without anyone naming it twice.
    if (collections.length) {
      const declared = await loadCollections();
      const missing = collections.filter(k => !declared.some(c => c.key === k));
      if (missing.length)
        await saveCollections(declared.concat(missing.map(k => ({ key: k, name: k }))));
    }
    const fresh = [], twins = [];
    for (const line of body.lines || []) {
      const text = line.trim();
      if (!text) continue;
      const twin = findTwin(items, text);
      if (twin) {
        for (const t of collections) if (!(twin.collections || []).includes(t)) (twin.collections ||= []).push(t);
        twins.push(twin);
        continue;
      }
      const item = { id: freeId(items, text), text, collections: [...collections] };
      items.push(item); fresh.push(item);
    }
    // A sentence that cannot be recorded is still a sentence: it is in the
    // list and asks to be recorded again. One failure does not lose the rest.
    let rendered = 0; const failed = [];
    for (const item of fresh) {
      try { rendered += await render(item) ? 1 : 0; }
      catch (e) { failed.push(`${item.id}: ${e.message || e}`); }
    }
    await savePhrases(items);
    return json({ added: fresh.length, rendered, merged: twins.length, failed });
  }

  if (route === '/api/build') {
    const only = new Set(body.ids || []);
    const vid = (body.voice || '').trim() || null;
    if (vid && !await anyVoice(vid)) return fail('That voice is not available here.', 404);
    let rendered = 0;
    for (const item of items) {
      if (only.size && !only.has(item.id)) continue;
      try { rendered += await render(item, !!body.force, vid) ? 1 : 0; }
      catch (e) { await savePhrases(items); return fail(String(e.message || e), 500); }
    }
    await savePhrases(items);
    return json({ rendered });
  }

  if (route === '/api/edit') {
    const item = items.find(i => i.id === (body.id || '').trim());
    if (!item) return fail('No phrase with that id.', 404);
    const text = (body.text || '').trim();
    if (!text) return fail('A sentence cannot be empty.', 400);
    item.text = text;                       // the id stays: it is a file name
    let rendered = false; const failed = [];
    try { rendered = await render(item, true); }
    catch (e) { failed.push(`${item.id}: ${e.message || e}`); }
    await savePhrases(items);
    return json({ ok: true, id: item.id, text: item.text, rendered, failed });
  }

  if (route === '/api/collections') {
    const ids = (body.ids || [body.id || '']).map(i => String(i).trim()).filter(Boolean);
    const mode = body.mode || 'set';
    if (!['set', 'add', 'remove'].includes(mode)) return fail('Unknown mode.', 400);
    const collections = (body.collections || []).map(normTag).filter(Boolean);
    const hit = [];
    for (const item of items) {
      if (!ids.includes(item.id)) continue;
      const cur = item.collections || [];
      item.collections = mode === 'set' ? [...collections]
                : mode === 'add' ? cur.concat(collections.filter(t => !cur.includes(t)))
                                 : cur.filter(t => !collections.includes(t));
      hit.push(item.id);
    }
    if (!hit.length) return fail('No phrase with that id.', 404);
    await savePhrases(items);
    return json({ ok: true, ids: hit, mode });
  }

  if (route === '/api/voice') {
    const v = await anyVoice((body.id || '').trim());
    if (!v) return fail('That voice is not available here.', 404);
    // Nothing is recorded and nothing turns stale: this only says what the
    // next recording should sound like.
    await saveSettings({ ...await loadSettings(), voice: v.id });
    return json({ ok: true, label: labelOf(v) });
  }

  if (route === '/api/delete') {
    const ids = (body.ids || [body.id || '']).map(i => String(i).trim()).filter(Boolean);
    if (!ids.length) return fail('No id provided.', 400);
    const gone = items.filter(i => ids.includes(i.id)).map(i => i.id);
    if (!gone.length) return fail('No phrase with that id.', 404);
    const left = items.filter(i => !gone.includes(i.id));
    await savePhrases(left);
    for (const id of gone) await dropAudio(id);
    return json({ ok: true, ids: gone });
  }

  if (route === '/api/download') {
    const fmt = (body.format || OUT.format).toLowerCase().replace(/^\./, '');
    const known = new Set(items.map(i => i.id));
    const files = [];
    for (const id of body.ids || []) {
      if (!known.has(id)) continue;         // never build a name from raw input
      const blob = await getAudio(id);
      if (!blob) continue;
      const out = await asFormat(blob, fmt);
      files.push({ name: `${id}.${fmt}`, bytes: new Uint8Array(await out.arrayBuffer()) });
    }
    if (!files.length) return fail('Nothing recorded to download.', 404);
    return new Response(zip(files), { status: 200, headers: { 'Content-Type': 'application/zip' } });
  }

  if (route === '/api/import') {
    // A bare list is what the container writes. An object with items in it
    // is what someone might reasonably hand over instead. A bildhaft export
    // is a different product's file, flattened to the same shape first.
    const incoming = fromBildhaft(body.items)
                   || (Array.isArray(body.items) ? body.items
                   : Array.isArray(body.items && body.items.items) ? body.items.items
                   : null);
    if (!incoming) return fail('That is neither a list of sentences nor a bildhaft export.', 400);

    // The file lands in a Sammlung of its own. bildhaft's rule, and for the
    // same reason: importing must never be able to destroy work already
    // here. Sentences still merge by text, because one text is one audio
    // file — but the Sammlung is always new.
    const label = String(body.name || '').trim() || defaultName();
    let into = normTag(label) || 'import';
    {
      const declared = await loadCollections();
      let key = into, n = 2;
      while (declared.some(c => c.key === key)) key = `${into}-${n++}`;
      into = key;
      declared.push({ key, name: label });
      await saveCollections(declared);
    }
    let added = 0, merged = 0, revoiced = 0;
    for (const raw of incoming) {
      const text = typeof raw === 'string' ? raw.trim()
                 : (raw && typeof raw.text === 'string') ? raw.text.trim() : '';
      if (!text) continue;
      const collections = (Array.isArray(raw && raw.collections) ? raw.collections : []).map(normTag).filter(Boolean);

      const twin = findTwin(items, text);
      if (twin) {
        for (const t of collections.concat(into))
          if (!(twin.collections || []).includes(t)) (twin.collections ||= []).push(t);
        merged++;
        continue;
      }
      // Keep the incoming id wherever it is free. It is a file name, and
      // the file it names may long since be sitting on a talker — that is
      // the whole reason for carrying sentences between the two.
      const wanted = typeof (raw && raw.id) === 'string' ? raw.id.trim() : '';
      const id = wanted && !items.some(i => i.id === wanted) ? wanted : freeId(items, text);
      const item = { id, text, collections: collections.includes(into) ? collections : collections.concat(into) };

      // A voice this page cannot speak with would fail at the first
      // recording. The container has voices we do not — Kerstin, Azure —
      // so those sentences fall back to whatever is selected here.
      if (raw && raw.voice_id && voiceById(raw.voice_id)) {
        item.voice_id = raw.voice_id;
        if (raw.fingerprint) item.fingerprint = raw.fingerprint;
      } else if (raw && raw.voice_id) {
        revoiced++;
      }
      items.push(item);
      added++;
    }
    await savePhrases(items);
    return json({ ok: true, added, merged, revoiced });
  }

  // /api/collections changes which Sammlungen a sentence is in.
  // /api/collection changes the Sammlungen themselves.
  // Everything, or one Sammlung. The file is the same shape either way — the
  // plain list phrases.json always was — so a copy of one book and a copy of
  // the lot are read by the same importer.
  if (route === '/api/export') {
    const key = normTag(body.collection || '');
    const declared = await loadCollections();
    const out = key ? items.filter(i => (i.collections || []).includes(key)) : items;
    const name = key ? ((declared.find(c => c.key === key) || {}).name || key) : '';
    const text = JSON.stringify(out, null, 2) + '\n';
    return new Response(new Blob([text], { type: 'application/json' }),
      { status: 200, headers: { 'X-Collection-Name': encodeURIComponent(name) } });
  }

  if (route === '/api/collection') {
    const mode = body.mode || 'create';
    const name = normTag(body.name || '');
    let declared = await loadCollections();

    if (mode === 'create') {
      const shown = String(body.name || '').trim();
      if (!name || !shown) return fail('A collection needs a name.', 400);
      if (!declared.some(c => c.key === name)) {
        declared.push({ key: name, name: shown });
        await saveCollections(declared);
      }
      return json({ ok: true, key: name, name: shown });
    }

    if (mode === 'rename') {
      const shown = String(body.to || '').trim();
      if (!name || !shown) return fail('A collection needs a name.', 400);
      // Only what you read changes. The key stays, so nothing a sentence
      // points at has to be rewritten and no import can be orphaned by
      // somebody fixing a capital letter.
      const hit = declared.find(c => c.key === name);
      if (!hit) return fail('No collection with that name.', 404);
      hit.name = shown;
      await saveCollections(declared);
      return json({ ok: true, key: hit.key, name: shown });
    }

    if (mode === 'delete') {
      // The Sammlung goes, the sentences stay. They are the irreplaceable
      // half, and a container being removed is no reason to lose them.
      const left = declared.filter(c => c.key !== name);
      await saveCollections(left);
      for (const item of items)
        item.collections = (item.collections || []).filter(n => n !== name);
      await savePhrases(items);
      // Never leave the page with nowhere to be.
      const now = await ensureCollection();
      return json({ ok: true, name, next: (left[0] || now[0]).key });
    }
    return fail('Unknown mode.', 400);
  }

  // Emptying the whole thing. A program with no folder to delete has to
  // offer this itself, or the only way out is the browser's own settings.
  if (route === '/api/wipe') {
    await savePhrases([]);
    await saveCollections([]);
    const d = await db();
    await new Promise((res, rej) => {
      const tx = d.transaction('audio', 'readwrite');
      tx.objectStore('audio').clear();
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    urls.forEach(u => URL.revokeObjectURL(u));
    urls = new Map();
    return json({ ok: true });
  }

  if (route === '/api/setup') {
    if ((body.backend || '') !== 'azure') return fail('Unknown service.', 400);
    const key = String(body.key || '').trim();
    const region = String(body.region || '').trim() || 'westeurope';
    const now = await loadSettings();
    if (!key) {                       // an empty field means: forget it
      const next = { ...now }; delete next.azure; await saveSettings(next);
      return json({ set: false, voices: VOICES.length });
    }
    // Checked before it is stored, so a typo is a sentence now rather than a
    // failed recording later. A key is bound to one region and the wrong
    // pairing answers 401, which is indistinguishable from a bad key.
    let found;
    try { found = await azureVoices(key, region); }
    catch (e) {
      return fail(e.message === 'key-or-region'
        ? 'That key and region do not go together.'
        : `Azure did not answer: ${e.message}`, 400);
    }
    await saveSettings({ ...now, azure: { key, region } });
    return json({ set: true, voices: VOICES.length + found.length });
  }

  return fail('Unknown route.', 404);
}

// Audio comes out of IndexedDB, so the page needs an object URL rather than
// a path. The player asks while a row is being drawn and cannot wait, so the
// URLs are made when the list is fetched and handed out from here. The ones
// from the previous draw are let go at the same time — a blob URL keeps its
// blob in memory until it is revoked.
let urls = new Map();

async function refreshUrls(items) {
  const old = urls;
  urls = new Map();
  for (const i of items) {
    const blob = await getAudio(i.id);
    if (blob) urls.set(i.id, URL.createObjectURL(blob));
  }
  for (const url of old.values()) URL.revokeObjectURL(url);
}

const audio = id => urls.get(id) || '';

// The download menu may wait, so this one converts if it has to.
async function fileURL(id, fmt) {
  const blob = await getAudio(id);
  if (!blob) return '';
  return URL.createObjectURL(await asFormat(blob, (fmt || OUT.format).toLowerCase()));
}

/* What the interface talks to. Exported rather than hung on window, so the
 * dependency is visible in the import that needs it. */
export const backend = { get, post, audio, fileURL, VOICES,
                         onProgress: fn => { setProgress(fn); } };
