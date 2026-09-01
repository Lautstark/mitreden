/** Which voices this page may offer, and what to call them. */

import { azureVoices, labelOf, piperVoices, type Offered } from '@lautstark/stimmquelle/browser';
import type { Voice } from './types.ts';

/** `piper:de_DE-thorsten-medium` -> `de_DE-thorsten-medium`, the model's name. */
export const modelOf = (id: string): string => id.replace(/^piper:/, '');

/**
 * What this page can honour, which is what decides what it may be offered.
 *
 * `ownsInference` is the `usePiperRuntime()` call in audio.ts: the runtime
 * question is one this page now answers for itself, rather than one about what
 * vits-web could speak, and claiming it is what puts `de_DE-kerstin-low` and
 * `en_US-john-medium` in the picker at all — a German female voice and an
 * English male one, the two slots that stood empty. It claims nothing about
 * licences, which are asked of every voice either way.
 *
 * `rendersAttribution` stays unclaimed, so it stays false. That costs
 * `de_DE-mls-medium`, which is CC-BY: the permission is conditional on the
 * notice being shown, and this interface shows none yet. `attributionsFor()`
 * in the catalogue is what would render them.
 *
 * The same claim has to be made a second time, in the `speak()` call in
 * audio.ts — see the comment there. Listing a voice and being allowed to
 * record it are two separate questions asked at two separate doors.
 */
const OFFERING = { ownsInference: true } as const;

/**
 * The shipped voices: the catalogue decides which may be offered at all, so a
 * licence rule is enforced where a voice is about to be used rather than in a
 * comment. Azure joins them only once a key is set.
 */
export const shipped = (): readonly Offered[] => piperVoices(OFFERING);

type AzureAccess = { key: string; region: string };

/**
 * Azure's catalogue, asked once per key and region: one settings-opening wants
 * it twice — the picker and the state line — and Azure's answer does not change
 * between the asks. The promise is cached rather than the list, so the two
 * share one request even when they race; a failure is dropped again once it
 * has settled, so asking later really asks.
 */
let asked: { stamp: string; catalogue: Promise<readonly Offered[]> } | null = null;

function azureCatalogue(azure: AzureAccess): Promise<readonly Offered[]> {
  const stamp = `${azure.region}\u0000${azure.key}`;
  if (asked?.stamp !== stamp) {
    const catalogue = azureVoices(azure);
    catalogue.catch(() => {
      if (asked?.catalogue === catalogue) asked = null;
    });
    asked = { stamp, catalogue };
  }
  return asked.catalogue;
}

/**
 * A broken Azure costs its own rows and nothing else. stimmquelle throws on a
 * key that does not work — rightly, the person who typed it must find out —
 * but the place to find out is the state line on the settings card, not a
 * picker suddenly missing the shipped voices too.
 */
export async function offered(azure?: AzureAccess): Promise<readonly Offered[]> {
  const list: Offered[] = [...piperVoices(OFFERING)];
  if (azure) {
    try {
      list.push(...(await azureCatalogue(azure)));
    } catch {
      // probeAzure() puts words to this failure on the settings card.
    }
  }
  return list;
}

/**
 * Which voice a page that has not been told starts in. The words on screen are
 * the only evidence there is about what somebody wants read aloud, and the
 * catalogue's own order is not evidence: it opens with three German voices, so
 * an English page was starting in a German man's and staying there.
 *
 * `recommended` is stimmquelle's pick for a language-and-gender slot, and this
 * is the one use left for a flag that stopped being shown. It is what keeps
 * the choice off array order — of the three Thorstens the shipped catalogue
 * offers, order alone would hand a first German page whichever one happens to
 * be listed first, and one of them is 114 MB. Nothing in the picker says it,
 * and no voice wears it: a starting point is not a verdict.
 */
export function defaultVoice(list: readonly Offered[], speaking: string): string {
  const speaks = list.filter((voice) => voice.lang === speaking);
  return (speaks.find((voice) => voice.recommended) ?? speaks[0] ?? list[0])?.id ?? '';
}

/** How Azure answered, for the settings card to put into words. */
export type AzureAnswer =
  | { ok: true; count: number }
  | { ok: false; code: 'unreachable' | 'refused' | 'failed'; words: string };

/**
 * Whether Azure answers for this key and region. "Stored" describes the
 * database; the person who typed a key wants to know whether Azure answers,
 * and each way it does not points somewhere different: a region name that is
 * not one is a hostname that never resolves, so the fetch dies as a TypeError
 * before any status exists — while a live region with a wrong key answers
 * 401, which stimmquelle relays as a sentence.
 */
export async function probeAzure(azure: AzureAccess): Promise<AzureAnswer> {
  try {
    return { ok: true, count: (await azureCatalogue(azure)).length };
  } catch (error) {
    const words = error instanceof Error ? error.message : String(error);
    const code = error instanceof TypeError ? 'unreachable'
      : /rejected the key|401|403/.test(words) ? 'refused'
        : 'failed';
    return { ok: false, code, words };
  }
}

/**
 * Two voices can share a name across quality tiers, and a picker that shows
 * "Thorsten" twice is a picker you cannot use. The rule is stimmquelle's since
 * 2.9.0 and was written here first: whether two voices share a name is a fact
 * about the catalogue, and the catalogue is over there. It was the third
 * separate answer to it — vorlaut kept a set of the names it holds twice, and a
 * third picker was telling the two Thorstens apart by their download sizes.
 *
 * Same signature and same output. What the package does better is that it reads
 * `quality` off the catalogue instead of the last dash-separated chunk of the
 * id, which this had no other way to get and which is not a field anything
 * promised the shape of — so an Azure voice, whose id carries no tier at all,
 * now keeps its bare name rather than gaining a slice of a ShortName.
 */
export { labelOf };

export const asVoice = (voice: Offered, among: readonly Offered[]): Voice => ({
  id: voice.id,
  label: labelOf(voice, among),
  name: voice.name,
  source: voice.source,
  lang: voice.lang,
  locale: voice.locale,
  gender: voice.gender,
  downloadBytes: voice.downloadBytes,
  needsKey: voice.needsKey,
  // Spread rather than assigned, so "absent" survives the trip as absent. The
  // catalogue sets this only on the voices it is true of, and a row asks
  // whether it is there at all; copying an `undefined` into every other voice
  // would say the question had been asked and answered no.
  ...(voice.rushesFragments ? { rushesFragments: true } : {}),
});

/**
 * The voice a set of sentences agrees on, or the commonest one if they do not.
 *
 * The voice is the Sammlung's now, and three places have to hand one to a
 * Sammlung that arrived without: the version 4 migration, a restored backup
 * written before Collection.voice existed, and an imported file whose sentences
 * each name the voice they were made in. All three have the same evidence — a
 * handful of votes, most of which agree — and all three want the same answer,
 * so the rule is written once.
 *
 * Whichever voice the most sentences already carry wins, because that is the
 * one that leaves the fewest recordings stale. Nothing here re-records; a
 * sentence on the losing side keeps its clip and is marked stale, which is the
 * true statement about it.
 *
 * A tie is broken by `preferred` when it is one of the tied, and otherwise by
 * the id, so that the same library migrates the same way twice. Alphabetical
 * order means nothing; being decidable does.
 */
export function commonest(
  votes: Iterable<string | undefined>, preferred?: string,
): string | undefined {
  const tally = new Map<string, number>();
  for (const vote of votes) if (vote) tally.set(vote, (tally.get(vote) ?? 0) + 1);
  if (!tally.size) return undefined;
  const most = Math.max(...tally.values());
  const tied = [...tally].filter(([, n]) => n === most).map(([id]) => id);
  return preferred && tied.includes(preferred) ? preferred : tied.sort()[0];
}
