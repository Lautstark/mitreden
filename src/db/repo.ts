/**
 * Everything the interface can ask of the data, as functions.
 *
 * This replaces a route table. The page used to call `post('/api/phrases', …)`
 * and a switch on the string answered it — a seam kept for a container that no
 * longer exists. Inside one bundle it bought nothing and cost the compiler its
 * view: a call to a route that was never handled, or a handler reaching for a
 * name nothing declared, both looked exactly like working code.
 */

import {
  allCollections, allPhrases, countIn, dropAudio, dropCollection, dropPhrase,
  getAudio, getCollection, getPhrase, idTaken, loadSettings, putAudio,
  putCollection, putPhrase, putPhrases, saveSettings, twinsOf, type Settings,
} from './db.ts';
import { record } from '../core/audio.ts';
import { fingerprint, free, normText, slug } from '../core/ids.ts';
import { commonest } from '../core/voices.ts';
import type { Collection, CollectionWithCount, Phrase, PhraseWithState, State } from '../core/types.ts';

/** A Sammlung named after the day, the way a new notebook gets a date. */
export function defaultName(german: boolean): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
  return `${german ? 'Sammlung vom' : 'Collection of'} ${date}`;
}

/**
 * A sentence always belongs to a Sammlung, which means there always has to be
 * one. bildhaft's rule, and it removes a whole class of question the page would
 * otherwise have to ask.
 */
export async function ensureCollection(german: boolean): Promise<Collection[]> {
  const declared = await allCollections();
  if (declared.length) return declared;
  const name = defaultName(german);
  const made: Collection = { id: crypto.randomUUID(), name };
  // The settings voice, if there is one yet. On a genuinely first run there is
  // not, and the Sammlung goes without: voiceFor() falls through to whatever the
  // page is offering by then.
  const { voice } = await loadSettings();
  if (voice) made.voice = voice;
  await putCollection(made);
  return [made];
}

/**
 * Which voice a sentence is supposed to be recorded in: its Sammlung's, or the
 * settings one when the Sammlung has none or there is no Sammlung.
 *
 * One rule covering both of the loose ends. A Sammlung without a voice and a
 * sentence without a Sammlung are different shapes with the same question, and
 * the settings voice is the answer to both — it is the default for the next
 * Sammlung, so it is also the standing answer for anything that never got one.
 *
 * `fallback` is the last resort: on a first run nobody has saved a voice yet
 * and the page is nevertheless offering one. Only build() has that to give.
 *
 * The whole of what changed is *where the voice comes from*. fingerprint() is
 * untouched, and so is what it decides: the mark is taken over the text and the
 * voice, so handing it the Sammlung's voice makes a Sammlung whose voice was
 * changed report every one of its sentences stale, and nothing else had to move
 * for that to be true.
 */
const voiceFor = (
  item: Phrase, voices: ReadonlyMap<string, string | undefined>, fallback?: string,
): string | undefined =>
  (item.collection ? voices.get(item.collection) : undefined) ?? fallback;

async function stateOf(item: Phrase, wanted: string | undefined): Promise<State> {
  if (!(await getAudio(item.id))) return 'missing';
  if (!item.voice || !item.fingerprint) return 'stale';
  // No voice decided anywhere is not the same as a voice that changed: compare
  // against what it was recorded in, so a library nobody has picked a voice for
  // does not read as entirely stale.
  const against = wanted ?? item.voice;
  return (await fingerprint(item.text, against)) === item.fingerprint ? 'ok' : 'stale';
}

/** Which voice each Sammlung records in, with the settings voice standing in
 *  for the ones that have none. Read once per pass rather than once per
 *  sentence: every caller here is about the whole library. */
async function voiceMap(): Promise<Map<string, string | undefined>> {
  const [declared, saved] = await Promise.all([allCollections(), loadSettings()]);
  return new Map(declared.map((c) => [c.id, c.voice ?? saved.voice]));
}

export async function phrases(): Promise<PhraseWithState[]> {
  const [items, voices, saved] = await Promise.all([allPhrases(), voiceMap(), loadSettings()]);
  return Promise.all(items.map(async (item) => ({
    ...item,
    state: await stateOf(item, voiceFor(item, voices, saved.voice)),
  })));
}

/** Every Sammlung with how much is in it. The count comes off the membership
 *  index and touches no sentence at all; it used to mean loading the whole
 *  library and tallying it. §1.8 wants this number in every row. */
export async function collections(): Promise<CollectionWithCount[]> {
  const declared = await allCollections();
  return Promise.all(declared.map(async (c) => ({ ...c, count: await countIn(c.id) })));
}

/**
 * A sentence on its way in: the text alone, or the text with the voice it was
 * recorded in. Only a file carries the second — somebody typing cannot know a
 * voice yet, and picks one afterwards.
 */
export type Line = string | { text: string; voice?: string };

export interface Added {
  added: number;
  merged: number;
  /** Of the lines that named a voice, how many named one this browser cannot
   *  reach — so it counted for nothing when the Sammlung's voice was decided. */
  revoiced: number;
  ids: string[];
}

/**
 * The voice a set of arriving lines votes for, which is what a file's voices are
 * *for* now: the Sammlung records, so a voice on a line is evidence about the
 * Sammlung rather than an instruction about the line. `reachable` throws out the
 * votes this browser could not honour — an Azure voice with no key would fail
 * every recording in the Sammlung it won.
 */
export const votedVoice = (
  lines: readonly Line[], reachable?: ReadonlySet<string>,
): string | undefined => commonest(lines.map((line) => {
  const named = typeof line === 'string' ? undefined : line.voice;
  return named && (!reachable || reachable.has(named)) ? named : undefined;
}));

/**
 * Adding is not recording. The sentences are saved and handed back at once so
 * the list can show them while the voice is still being made — on a first run
 * that is a 60 MB model download, and a list that stays empty for a minute
 * looks like the typing was thrown away.
 *
 * `into` is one Sammlung or none, because a sentence is in one Sammlung or none.
 *
 * ## What a twin does now
 *
 * A sentence whose text is already here used to be *merged*: the existing row
 * gained the new Sammlung and there was one row with two memberships. One-to-one
 * leaves three possibilities and this takes the third.
 *
 * - **A move** — hand the existing row to the new Sammlung — is the wrong one.
 *   Adding "Ich habe Hunger." to the nursery Sammlung would empty it out of the
 *   morning one, silently, and the person asked for neither half of that.
 * - **A refusal** is worse. This program exists to hand a Sammlung to a device
 *   as a set of files; a Sammlung that cannot hold a sentence because some other
 *   Sammlung has it is a Sammlung that cannot do its job.
 * - **A second row of its own** is what happens. Same text, its own numbered id,
 *   its own membership, its own recording.
 *
 * That third one costs a row and, unlike the arrangement it replaces, a second
 * clip: `audio` is keyed by the *sentence id* (putAudio in db.ts), so two rows
 * are two keys even when they would hold identical bytes. Which is why the bytes
 * are copied rather than made again — if the twin was recorded in the very voice
 * this Sammlung records in, the new row is a copy of it in every respect that
 * decides staleness, so it arrives already recorded and build() has nothing to
 * do. A twin from a Sammlung with a different voice is a genuine second
 * recording, and that is correct rather than wasteful: it is a different sound.
 *
 * A twin in the Sammlung being added to is still a merge, and now a true no-op:
 * there is nothing to add.
 *
 * `reachable` is the voices this page can actually speak in, and only an import
 * has one. A line's own voice is not written onto the sentence any more — see
 * votedVoice above, and Phrase.voice, which build() alone writes.
 */
export async function addPhrases(
  lines: readonly Line[], into?: string, reachable?: ReadonlySet<string>,
): Promise<Added> {
  /* What this call will write, collected and put in one transaction at the end
     rather than saved per line. Twins are looked up in the store *and* here:
     two identical lines in one paste have no twin in the database yet, and the
     array version got that for free by mutating the array it was scanning. */
  const writing = new Map<string, Phrase>();
  const twins = async (text: string): Promise<Phrase[]> => {
    const key = normText(text);
    const here = [...writing.values()].filter((held) => normText(held.text) === key);
    return [...here, ...(await twinsOf(text)).filter((held) => !writing.has(held.id))];
  };

  const saved = await loadSettings();
  const wanted = (into ? (await getCollection(into))?.voice : undefined) ?? saved.voice;

  const fresh: Phrase[] = [];
  const copying: [string, string][] = [];
  let merged = 0;
  let revoiced = 0;
  for (const line of lines) {
    const named = typeof line === 'string' ? undefined : line.voice;
    const text = (typeof line === 'string' ? line : line.text).trim();
    if (!text) continue;
    if (named && reachable && !reachable.has(named)) revoiced += 1;

    const alike = await twins(text);
    if (alike.some((twin) => twin.collection === into)) {
      merged += 1;
      continue;
    }

    const id = await free(slug(text), async (c) => writing.has(c) || idTaken(c));
    const item: Phrase = { id, text };
    if (into !== undefined) item.collection = into;
    /* Already recorded, in the voice this Sammlung records in: the clip is the
       same sound, so it is copied rather than made a second time. The
       fingerprint comes with it — the two travel together (db/backup.ts) — and
       it is the twin's own, not a fresh one, because taking a new mark over the
       same text and the same voice would produce that exact string anyway. */
    const same = alike.find((twin) => twin.voice && twin.voice === wanted && twin.fingerprint);
    if (same) {
      item.voice = same.voice;
      item.fingerprint = same.fingerprint;
      copying.push([same.id, id]);
    }
    writing.set(item.id, item);
    fresh.push(item);
  }
  await putPhrases([...writing.values()]);
  // After the sentences, and outside their transaction: a clip is not in the
  // Sicherung and putAudio deliberately announces nothing, so this is not part
  // of the write that has to be all or nothing.
  for (const [from, to] of copying) {
    const clip = await getAudio(from);
    if (clip) await putAudio(to, clip);
  }
  return { added: fresh.length, merged, revoiced, ids: fresh.map((i) => i.id) };
}

export interface Built {
  recorded: number;
  failed: string[];
}

/**
 * A sentence that cannot be recorded is still a sentence: it stays in the list
 * and asks to be recorded again. One failure does not lose the rest.
 *
 * `onStep` is told which sentence is starting and which has finished, because
 * only this loop knows: recording is one await per sentence and the first of
 * them may spend a minute fetching the voice, so a page that hears nothing
 * until the batch ends can only say "not recorded yet" about work already
 * under way — and about work already done.
 */
export async function build(
  ids: string[], voiceId: string, force = false,
  onStep?: (id: string, done: boolean) => void,
): Promise<Built> {
  const items = await allPhrases();
  const [settings, voices] = await Promise.all([loadSettings(), voiceMap()]);
  const wanted = new Set(ids);
  let recorded = 0;
  const failed: string[] = [];
  for (const item of items) {
    if (wanted.size && !wanted.has(item.id)) continue;
    /* The Sammlung's voice, not the sentence's. `voiceId` is only the last
       resort — a first run where nothing has been saved and nothing has been
       set — and `force` no longer means "in this voice regardless": there is
       one right voice for this sentence and force is about recording it again
       rather than about which one. */
    const voice = voiceFor(item, voices, settings.voice ?? voiceId);
    if (!voice) continue;
    try {
      const mark = await fingerprint(item.text, voice);
      if (!force && item.fingerprint === mark && (await getAudio(item.id))) continue;
      onStep?.(item.id, false);
      const { blob } = await record(item.text, voice, settings.azure);
      await putAudio(item.id, blob);
      item.voice = voice;
      item.fingerprint = mark;
      recorded += 1;
      // Saved before it is announced: the row answers by reading the store,
      // and a sentence reported as finished has to be findable there.
      //
      // One sentence, not the library. This loop is where the JSON array cost
      // the most - two hundred recordings meant two hundred rewrites of a
      // two-hundred-entry array, each one to change two fields on one of them.
      await putPhrase(item);
      onStep?.(item.id, true);
    } catch (error) {
      failed.push(`${item.id}: ${error instanceof Error ? error.message : String(error)}`);
      onStep?.(item.id, true);
    }
  }
  return { recorded, failed };
}

export async function editPhrase(id: string, text: string): Promise<Phrase | null> {
  const item = await getPhrase(id);
  if (!item) return null;
  // The id stays. It is a file name, and the file may already be on a talker.
  item.text = text;
  await putPhrase(item);
  return item;
}

export async function deletePhrase(id: string): Promise<void> {
  await dropPhrase(id);
  await dropAudio(id);
}

/**
 * Always a new Sammlung, always a fresh id.
 *
 * It used to derive the id from the name, and a *named* call — which is what an
 * import is — looked the derived key up first and handed back whatever it
 * found. normTag truncates at 24 characters, so two files whose names agreed
 * that far reduced to one key, and the second import silently poured its
 * sentences into the first file's Sammlung. No error, no warning, and the only
 * visible sign was a count that had grown. That is the collision §1.1 predicts
 * when identity is made out of a mutable field, and it is why this mints
 * instead (conventions.md §1.1, §1.10).
 *
 * Two Sammlungen may now genuinely share a name, which is correct: the identity
 * is never the name, and a person who imports the same file twice has two of
 * them because that is what they asked for. Only the *offered* name is
 * uniquified, and only when nobody supplied one — see §1.5, which is about the
 * suggestion rather than about uniqueness.
 */
export async function createCollection(
  name: string | null, german: boolean, voice?: string,
): Promise<Collection> {
  let shown = name?.trim() ?? '';
  if (!shown) {
    const base = defaultName(german);
    shown = base;
    for (let n = 2; await named(shown); n++) shown = `${base} (${n})`;
  }
  const made: Collection = { id: crypto.randomUUID(), name: shown };
  /* The settings voice is the default for the next Sammlung — that is what the
     setting is now — unless the caller knows better. An import does: the file's
     sentences say which voice they were made in, and honouring that is what
     makes the same file record the same way on a second device. */
  const decided = voice ?? (await loadSettings()).voice;
  if (decided) made.voice = decided;
  await putCollection(made);
  return made;
}

/** Whether a Sammlung is already called this. The one question here that is
 *  genuinely about every one of them - names are not keys and are not indexed,
 *  because nothing else ever looks one up by name. */
const named = async (name: string): Promise<boolean> =>
  (await allCollections()).some((c) => c.name === name);

/**
 * What this Sammlung records in. Its own field, written by the one surface that
 * is unambiguously about one Sammlung — the sheet behind its ⋯.
 *
 * Nothing is re-recorded here and nothing is thrown away. Every clip stays, and
 * every sentence in the Sammlung goes from `ok` to `stale` on the next read,
 * because stateOf compares the fingerprint against the voice the *Sammlung*
 * records in. That is the whole mechanism, and it is the one that already
 * existed; this function only moves the value it reads.
 */
export async function saveCollectionVoice(id: string, voice: string): Promise<Collection | null> {
  const hit = await getCollection(id);
  if (!hit) return null;
  hit.voice = voice;
  // Keeps its place in the list, like a rename: putCollection carries the old
  // stamp across, and setting a voice is not making a Sammlung.
  await putCollection(hit);
  return hit;
}

export async function renameCollection(id: string, to: string): Promise<Collection | null> {
  const hit = await getCollection(id);
  if (!hit) return null;
  hit.name = to.trim();
  // Keeps its place in the list: putCollection carries the old stamp across,
  // because renaming is not making.
  await putCollection(hit);
  return hit;
}

/** The Sammlung goes, the sentences stay: they are the irreplaceable half.
 *  One transaction, and only over the sentences that were actually in it. */
export const deleteCollection = dropCollection;

export const settings = loadSettings;
/** The default for the *next* Sammlung. It does not reach into the ones that
 *  already exist: those carry their own, and changing one of those is a change
 *  to that Sammlung. */
export const saveVoice = async (voice: string): Promise<void> =>
  saveSettings({ ...(await loadSettings()), voice });

/**
 * Which Sammlungen are open, and whether the rail is there — both in the
 * settings record with every other preference, and neither in localStorage.
 * conventions.md §1.2 and §1.3.
 *
 * A preference living in two stores is one that gets restored by one of them
 * and overwritten by the other; and localStorage survives the database being
 * cleared, so "start again from nothing" would leave a pointer to a Sammlung
 * that no longer exists. The scheme and the language stay where they are for a
 * reason this does not have — they must be readable before the first paint,
 * and this is allowed to arrive a frame late.
 */
export const saveOpen = async (open: readonly string[]): Promise<void> =>
  saveSettings({ ...(await loadSettings()), open: [...open] });

export const saveRailOpen = async (railOpen: boolean): Promise<void> =>
  saveSettings({ ...(await loadSettings()), railOpen });

/** Which sheet the export was for, and the circle the run ended on. */
export const savePen = async (pen: Settings['pen']): Promise<void> =>
  saveSettings({ ...(await loadSettings()), pen });
export async function saveAzure(azure: Settings['azure']): Promise<void> {
  const now = await loadSettings();
  if (azure) await saveSettings({ ...now, azure });
  else {
    const { azure: _drop, ...rest } = now;
    await saveSettings(rest);
  }
}
