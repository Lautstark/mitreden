/* mitreden without a server.
 *
 * The same interface as the container serves, answering out of the browser
 * itself: piper compiled to WASM does the speaking, the trimming and levelling
 * happen in JavaScript, and the sentences live in IndexedDB. Nothing is
 * uploaded and there is nothing to install.
 *
 * It answers the routes mitreden.py answers, and hands back a Response, so
 * ui.html cannot tell the difference. Where behaviour is copied from the
 * container the function keeps its name, so the two can be read side by side.
 *
 * What is deliberately not here: cloud voices (a key on a public page is a
 * different conversation), and `out/` (there is no folder to write to — the
 * download button is the folder).
 */
(() => {
  'use strict';

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
  const CATALOGUE = (window.STIMMQUELLE || { voices: [] }).voices;
  const VOICES = CATALOGUE
    .filter(v => v.licence.ship && v.browser === 'ok' && !v.licence.attribution)
    .map(v => ({ id: `piper:${v.id}`, name: v.name, lang: v.lang,
                 mb: Math.round(v.bytes / 1048576) }));

  const DEFAULT_VOICE = VOICES[0].id;
  const modelOf = id => id.replace(/^piper:/, '');
  const labelOf = v => [v.name, 'piper', v.lang].join(' · ');
  const voiceById = id => VOICES.find(v => v.id === id);

  // Output settings. The container keeps these in config.json; here they are
  // fixed, because there is no file to edit and mp3 at 44.1 kHz mono is what
  // talkers, reading pens and phone apps expect.
  const OUT = { format: 'mp3', sample_rate: 44100, channels: 1, bitrate: 192 };


  // ------------------------------------------------------------------ store
  //
  // Two stores: the sentences, which are the only irreplaceable thing here,
  // and the audio, which can always be made again. Keeping the audio means a
  // reload does not re-record everything, and a voice change only re-records
  // what actually changed.
  const DB_NAME = 'mitreden', DB_VERSION = 1;
  let dbp = null;

  function db() {
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

  async function idb(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  const loadPhrases = () => idb('meta', 'readonly', s => s.get('phrases')).then(v => v || []);
  // The declared Sammlungen, in the order they were made. Kept apart from the
  // sentences on purpose: a Sammlung just created is empty, and one derived
  // from its members could not exist yet. That is the whole difference between
  // a label and a place you work in.
  const loadCollections = () => idb('meta', 'readonly', s => s.get('collections')).then(v => v || []);
  const saveCollections = v => idb('meta', 'readwrite', s => s.put(v, 'collections'));
  const savePhrases = items => idb('meta', 'readwrite', s => s.put(items, 'phrases'));
  const loadSettings = () => idb('meta', 'readonly', s => s.get('settings')).then(v => v || {});
  const saveSettings = v => idb('meta', 'readwrite', s => s.put(v, 'settings'));
  const getAudio = id => idb('audio', 'readonly', s => s.get(id));
  const putAudio = (id, blob) => idb('audio', 'readwrite', s => s.put(blob, id));
  const dropAudio = id => idb('audio', 'readwrite', s => s.delete(id));

  const activeVoice = async () => (await loadSettings()).voice || DEFAULT_VOICE;

  // ---------------------------------------------------------- ids and twins
  //
  // Ported from mitreden.py, unchanged in behaviour on purpose: an id is a
  // file name, and a file name may long since be sitting on a talker.
  const SLUG_WORDS = 6, SLUG_CHARS = 40;

  function slug(text, fallback = 'phrase') {
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

  const normTag = text => slug(text, '').slice(0, 24);
  // Punctuation stays in: "Nochmal!" and "Nochmal." are spoken differently.
  const normText = text => text.split(/\s+/).filter(Boolean).join(' ').toLowerCase();
  const findTwin = (items, text) => {
    const key = normText(text);
    return items.find(i => normText(i.text) === key) || null;
  };

  function freeId(items, text) {
    const base = slug(text);
    const taken = new Set(items.map(i => i.id));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }

  // Changes when the text, the voice or the output format changes — the same
  // three things the container hashes, so "what still has to be recorded"
  // means the same here.
  // Which engine made a recording, for the same reason mitreden.py carries
  // PIPER_VERSION: piper is what turns the text into sound, so a build that
  // changes how a voice speaks must not leave old recordings sitting under
  // names claiming to match new ones. Here that is the vits-web bundle and
  // the phonemizer wasm behind it, both pinned in tools/vendor.lock.json —
  // and kept in step with this constant by `tools/vendor.py --check`.
  //
  // The model's name is used, never a URL. Where a voice is fetched from says
  // nothing about how it sounds, and a fingerprint has to mean the same thing
  // on every machine.
  // Both halves of what makes the sound: vits-web turns the text into speech,
  // stimmquelle trims and levels it. Either changing means old recordings must
  // not keep names claiming to match new ones, and both are vendored, so both
  // are named here and `tools/vendor.py --check` fails if this disagrees with
  // what is actually in vendor/. One constant and one guard rather than two.
  const ENGINE_VERSION = 'vits-web@1.0.3 stimmquelle@0ff9af2';

  async function fingerprint(text, voiceId) {
    const payload = JSON.stringify([text, 'piper', modelOf(voiceId),
                                    ENGINE_VERSION, OUT]);
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  }

  // -------------------------------------------------------------- bildhaft
  //
  // bildhaft (github.com/SteffiPeTaffy/bildhaft) turns a typed German sentence
  // into a row of AAC pictograms. It is the same sentence mitreden speaks, so
  // a picture book translated there should not have to be typed again here.
  //
  // Its files hold symbol *references* rather than pictures, the way ours hold
  // sentences rather than audio — which is why either file still works on a
  // device that owns different symbols or different voices.
  //
  // Three shapes to read: one collection, a whole-library backup, and the v1
  // name for a collection, which called the same thing a session and pointed
  // its sentences at a `sessionId`. Nothing is rejected on version: we only
  // ever look at one field, and a file we cannot read simply brings no
  // sentences, which reads as an empty import rather than as an error.
  const BILDHAFT_FORMATS = ['bildhaft.collection', 'bildhaft.session', 'bildhaft.backup'];

  function fromBildhaft(doc) {
    if (!doc || typeof doc !== 'object' || !BILDHAFT_FORMATS.includes(doc.format)) return null;

    // A collection file names its one group up front; a backup carries the
    // names in a list and lets each sentence point at its own.
    const named = new Map();
    for (const c of Array.isArray(doc.collections) ? doc.collections : [])
      if (c && c.id) named.set(c.id, c.name || '');
    const single = doc.collection || doc.session || null;

    const out = [];
    for (const s of Array.isArray(doc.sentences) ? doc.sentences : []) {
      // What the user typed, not the normalised lookup key — the sentence is
      // going to be spoken, so its capitals and punctuation matter.
      const text = typeof (s && s.rawInput) === 'string' ? s.rawInput : '';
      if (!text.trim()) continue;
      // A backup row whose collection is missing keeps the sentence and loses
      // only its group. bildhaft drops such rows because a sentence without a
      // collection has nowhere to live there; here a sentence stands alone.
      const name = single ? (single.name || '') : (named.get(s.collectionId || s.sessionId) || '');
      // No id: bildhaft's are internal, ours are file names. And no voice —
      // bildhaft has none, so these take whatever is selected here.
      out.push({ text, collections: name ? [name] : [] });
    }
    return out;
  }

  // ------------------------------------------------------------------ piper
  // Both come out of vendor/, fetched once by tools/vendor.py and served from
  // here. Loaded on demand rather than up front: opening the page should not
  // cost a megabyte of decoder nobody has asked to use yet.
  let ttsp = null;
  const tts = () => (ttsp ||= import('./vendor/vits-web.js'));

  let onProgress = null;   // set while a batch is running, so the page can say so

  async function speak(text, voiceId) {
    const t = await tts();
    return t.predict({ text, voiceId: modelOf(voiceId) }, p => {
      if (onProgress && p && p.total)
        onProgress(Math.round(p.loaded * 100 / p.total));
    });
  }

  // ------------------------------------------------- trim, level and encode
  //
  // All of it from stimmquelle, vendored like everything else in vendor/.
  // docs/audio.js is gone and the two AudioContexts around it with it.
  //
  // The package reaches further than audio.js did. audio.js held the arithmetic
  // and left decoding and resampling behind an AudioContext because they seemed
  // to need one; stimmquelle carries its own RIFF decoder and a windowed-sinc
  // resampler, so the whole chain runs under node. That is not tidiness. A
  // second implementation of a filter chain is only defensible because it can
  // be measured against the real ffmpeg, and the AudioContext version could
  // never have had its first and last steps inside that measurement.
  //
  // vorlaut runs the same file. Two products that both put a sentence on a
  // child's talker cannot afford to disagree about how loud it comes out, and
  // until now the only thing keeping them in step was that one person wrote
  // both.
  let dspp = null;
  const dsp = () => (dspp ||= import('./vendor/stimmquelle.js'));

  // One recording, start to finish: piper's raw wav in, the finished file out.
  // The mp3 encoder is lamejs, and it is behind its own import inside the
  // package — a quarter of a megabyte that only arrives when something actually
  // asks for an mp3.
  async function process(wavBlob) {
    const { postprocess, encodeMp3 } = await dsp();
    const { samples, rate } = postprocess(new Uint8Array(await wavBlob.arrayBuffer()),
                                          { rate: OUT.sample_rate });
    return new Blob([await encodeMp3(samples, rate, OUT.bitrate)],
                    { type: 'audio/mpeg' });
  }

  // Decoding a finished file back to samples, for a download in another format.
  // Same rule as before: the audio is not touched again beyond the format
  // change — it was trimmed and levelled when it was made.
  //
  // The AudioContext that survives, and the only one left. What it decodes is
  // an mp3; the package reads RIFF because that is what synthesisers emit.
  // Decoding what this program itself chose to write is this program's problem,
  // and it genuinely needs the browser for it.
  async function asFormat(blob, fmt) {
    if (fmt === OUT.format || !fmt) return blob;
    if (fmt !== 'wav') throw new Error(`This page can only write mp3 and wav, not ${fmt}.`);
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    await ctx.close();
    const { resample, encodeWav } = await dsp();
    const at = decoded.sampleRate === OUT.sample_rate
      ? decoded.getChannelData(0)
      : resample(decoded.getChannelData(0), decoded.sampleRate, OUT.sample_rate);
    return new Blob([encodeWav(at, OUT.sample_rate)], { type: 'audio/wav' });
  }

  // ------------------------------------------------------------- recording
  async function render(item, force = false, voiceId = null) {
    const vid = voiceId || item.voice_id || await activeVoice();
    const fp = await fingerprint(item.text, vid);
    if (!force && item.fingerprint === fp && await getAudio(item.id)) return false;
    const wav = await speak(item.text, vid);
    await putAudio(item.id, await process(wav));
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

  // ------------------------------------------------------------------- zip
  //
  // Stored, not deflated: mp3 and wav-from-mp3 do not compress, so the only
  // thing deflate would buy is a dependency.
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function zip(files) {
    const enc = new TextEncoder(), chunks = [], central = [];
    // A zip carries an MS-DOS timestamp. Left at zero it reads as day 0 of
    // month 0, which some extractors show and others refuse.
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let offset = 0;
    for (const { name, bytes } of files) {
      const nb = enc.encode(name), crc = crc32(bytes);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);        // the name is UTF-8
      local.setUint16(8, 0, true);             // stored
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, bytes.length, true);
      local.setUint32(22, bytes.length, true);
      local.setUint16(26, nb.length, true);
      chunks.push(new Uint8Array(local.buffer), nb, bytes);

      const dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true);
      dir.setUint16(4, 20, true); dir.setUint16(6, 20, true);
      dir.setUint16(8, 0x0800, true);
      dir.setUint16(12, time, true);
      dir.setUint16(14, date, true);
      dir.setUint32(16, crc, true);
      dir.setUint32(20, bytes.length, true);
      dir.setUint32(24, bytes.length, true);
      dir.setUint16(28, nb.length, true);
      dir.setUint32(42, offset, true);
      central.push(new Uint8Array(dir.buffer), nb);
      offset += 30 + nb.length + bytes.length;
    }
    const dirBytes = central.reduce((n, c) => n + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, dirBytes, true);
    end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)],
                    { type: 'application/zip' });
  }

  // ---------------------------------------------------------------- routes
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  const fail = (msg, status = 400) => new Response(msg, { status });

  async function listVoices() {
    const active = await activeVoice();
    return VOICES.map(v => ({ id: v.id, label: labelOf(v), backend: 'piper',
                              active: v.id === active }));
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
    const declared = await loadCollections();
    const used = new Set(out.flatMap(i => i.collections || []));
    const names = declared.concat([...used].filter(n => !declared.includes(n)));

    const av = voiceById(active);
    return { items: out, voice: av ? labelOf(av) : active, format: OUT.format,
             collections: names.map(name => ({
               name, count: out.filter(i => (i.collections || []).includes(name)).length })) };
  }

  async function get(route) {
    if (route === '/api/strings') return json(window.MITREDEN_STRINGS || {});
    // No cloud services here. A key typed into a public page would be a
    // different promise than the one the container makes, so the panel stays
    // empty rather than half-true.
    if (route === '/api/setup') return json({ cloud: [], voices: VOICES.length,
                                              backup: true });

    // The same file the container keeps: a plain list, so a copy made here
    // can be dropped next to mitreden.py and the other way round. Only the
    // sentences — the audio can always be made again, and would turn a
    // backup you can read into a download you cannot.
    if (route === '/api/export') {
      const items = await loadPhrases();
      const text = JSON.stringify(items, null, 2) + '\n';
      return new Response(new Blob([text], { type: 'application/json' }), { status: 200 });
    }
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
        const missing = collections.filter(c => !declared.includes(c));
        if (missing.length) await saveCollections(declared.concat(missing));
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
      if (vid && !voiceById(vid)) return fail('That voice is not available here.', 404);
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
      const v = voiceById((body.id || '').trim());
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

      let added = 0, merged = 0, revoiced = 0;
      for (const raw of incoming) {
        const text = typeof raw === 'string' ? raw.trim()
                   : (raw && typeof raw.text === 'string') ? raw.text.trim() : '';
        if (!text) continue;
        const collections = (Array.isArray(raw && raw.collections) ? raw.collections : []).map(normTag).filter(Boolean);

        const twin = findTwin(items, text);
        if (twin) {
          for (const t of collections) if (!(twin.collections || []).includes(t)) (twin.collections ||= []).push(t);
          merged++;
          continue;
        }
        // Keep the incoming id wherever it is free. It is a file name, and
        // the file it names may long since be sitting on a talker — that is
        // the whole reason for carrying sentences between the two.
        const wanted = typeof (raw && raw.id) === 'string' ? raw.id.trim() : '';
        const id = wanted && !items.some(i => i.id === wanted) ? wanted : freeId(items, text);
        const item = { id, text, collections };

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
    if (route === '/api/collection') {
      const mode = body.mode || 'create';
      const name = normTag(body.name || '');
      let declared = await loadCollections();

      if (mode === 'create') {
        if (!name) return fail('A collection needs a name.', 400);
        if (!declared.includes(name)) { declared.push(name); await saveCollections(declared); }
        return json({ ok: true, name });
      }

      if (mode === 'rename') {
        const to = normTag(body.to || '');
        if (!name || !to) return fail('A collection needs a name.', 400);
        await saveCollections(declared.map(n => (n === name ? to : n))
                                      .filter((n, i, a) => a.indexOf(n) === i));
        // the sentences follow, or they are left pointing at a name nothing
        // answers to any more
        for (const item of items) {
          const cur = item.collections || [];
          if (cur.includes(name))
            item.collections = cur.map(n => (n === name ? to : n))
                                  .filter((n, i, a) => a.indexOf(n) === i);
        }
        await savePhrases(items);
        return json({ ok: true, name: to });
      }

      if (mode === 'delete') {
        // The Sammlung goes, the sentences stay. They are the irreplaceable
        // half, and a container being removed is no reason to lose them.
        await saveCollections(declared.filter(n => n !== name));
        for (const item of items)
          item.collections = (item.collections || []).filter(n => n !== name);
        await savePhrases(items);
        return json({ ok: true, name });
      }
      return fail('Unknown mode.', 400);
    }

    if (route === '/api/setup')
      return fail('This page has no cloud services.', 400);

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

  window.MITREDEN_BACKEND = { get, post, audio, fileURL, VOICES,
                              onProgress: fn => { onProgress = fn; } };
})();
