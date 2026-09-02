import { Ablage } from '@lautstark/sicherung/ablage';
import type { Collection, Phrase } from '../core/types.ts';

/**
 * mitreden's library in a folder, rather than only in this browser.
 *
 * A household keeps its sentences *either* in IndexedDB *or* in a folder it
 * chose — never in both as sources, so there is never a second truth to
 * reconcile. Where a folder is connected it is the truth and IndexedDB is a copy
 * of it: read wholesale on start, written to on every edit, and served read-only
 * while the folder is out of reach. See sicherung's adr/0001.
 *
 * The audio does not go. It is synthesised from the text by piper, and
 * `fingerprint` is what decides whether a file still matches its sentence — so
 * every device can make its own, and a shared folder full of megabytes that any
 * machine can regenerate would be paying sync for something free. It is a cache,
 * like Wochenwerk's clips, and caches are not a source of anything.
 */

export const KINDS = ['saetze', 'sammlungen'] as const;
export type Kind = (typeof KINDS)[number];

/** The name every Lautstark programme files under; mitreden's is `HOME/mitreden/`. */
export const HOME = 'Lautstark';
export const APP = 'mitreden';

export const ablage = new Ablage({ app: APP, kinds: KINDS });
export const supported = Ablage.supported;

export const isStore = () =>
  ablage.status.kind !== 'off' && ablage.status.kind !== 'unsupported';
export const isStale = () => ablage.status.kind === 'stale';

/*
 * A sentence's id is a slug of its own text, deliberately: it is a filename on
 * somebody's talker, and `ich-moechte-wasser.wav` is what a household is meant
 * to recognise on the device. That is load-bearing and not up for changing to
 * suit a store.
 *
 * The folder needs a filename it can tell a record by, so the *file* gets an id
 * hashed from the slug and the slug rides inside the record. The same sentence
 * lands on the same file on every device without two devices that have never met
 * having to agree on anything. What is lost is a browsable name in the store
 * folder, which the export to the talker gives back where it actually matters.
 */
const digested = new Map<string, string>();
export async function fileNameFor(slug: string): Promise<string> {
  const known = digested.get(slug);
  if (known) return known;
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(slug)),
  );
  const hex = [...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  digested.set(slug, id);
  return id;
}

/** A sentence as the folder holds it: its own id kept, the filename derived. */
export const asStored = async (item: Phrase & { updatedAt?: number }) => ({
  ...item,
  slug: item.id,
  id: await fileNameFor(item.id),
  updatedAt: item.updatedAt ?? 0,
});

/** And back: the slug is the id, and the filename was never part of the record. */
export const asPhrase = (row: Record<string, unknown>): Phrase => {
  const { slug, id: _file, ...rest } = row as { slug: string; id: string };
  return { ...rest, id: slug } as unknown as Phrase;
};

/* A write reaches the folder only where the folder is the store, and never while
   it is stale — a copy that took writes nobody else can see would be the second
   source of truth this arrangement exists to avoid. */
const canWrite = () => isStore() && !isStale();

export async function filePhrase(item: Phrase & { updatedAt?: number }): Promise<void> {
  if (canWrite()) await ablage.write('saetze', await asStored(item));
}
export async function unfilePhrase(slug: string): Promise<void> {
  if (canWrite()) await ablage.remove('saetze', await fileNameFor(slug));
}
export async function fileCollection(item: Collection & { updatedAt: number }): Promise<void> {
  if (canWrite()) await ablage.write('sammlungen', { ...item });
}
export async function unfileCollection(id: string): Promise<void> {
  if (canWrite()) await ablage.remove('sammlungen', id);
}

/* A batch happens inside one IndexedDB transaction, and reaching into that to
   file each record would put a folder write inside a transaction that has to
   stay open. So a batch is mirrored afterwards, wholesale — through `writeAll`,
   so a folder that goes out of reach partway stops instead of running silently
   to the end writing nothing. */
export async function pushKind(
  kind: Kind,
  records: { id: string; updatedAt: number }[],
): Promise<void> {
  if (!canWrite()) return;
  const there = new Map((await ablage.list(kind)).map((item) => [item.id, item.updatedAt]));
  const here = new Set(records.map((record) => record.id));
  await ablage.writeAll(kind, records.filter((r) => there.get(r.id) !== r.updatedAt));
  for (const id of there.keys()) if (!here.has(id)) await ablage.remove(kind, id);
}

export const readKind = <T>(kind: Kind) => ablage.all(kind) as Promise<T[]>;
export const adopted = () => ablage.adopted();
export const adopt = (all: Record<string, { id: string; updatedAt: number }[]>) =>
  ablage.adopt(all);

/* Somebody else's edit, arriving as a file that changed under this browser. */
export const watchFolder = (onChange: () => void) =>
  ablage.watch(30_000, (found) => {
    if (found.length) onChange();
  });
