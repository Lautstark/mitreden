/** Which voices this page may offer, and what to call them. */

import { azureVoices, piperVoices, type Offered } from '@lautstark/stimmquelle/browser';
import type { Voice } from './types.ts';

/** `piper:de_DE-thorsten-medium` -> `de_DE-thorsten-medium`, for vits-web. */
export const modelOf = (id: string): string => id.replace(/^piper:/, '');

/**
 * The shipped voices: the catalogue decides which may be offered at all, so a
 * licence rule is enforced where a voice is about to be used rather than in a
 * comment. Azure joins them only once a key is set.
 */
export const shipped = (): readonly Offered[] => piperVoices();

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
  const list: Offered[] = [...piperVoices()];
  if (azure) {
    try {
      list.push(...(await azureCatalogue(azure)));
    } catch {
      // probeAzure() puts words to this failure on the settings card.
    }
  }
  return list;
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
 * "Thorsten" twice is a picker you cannot use. The tier only appears when it
 * has to.
 */
export function labelOf(voice: Offered, among: readonly Offered[]): string {
  const twins = among.filter((other) => other.name === voice.name).length > 1;
  const tier = voice.id.split('-').at(-1);
  return twins ? `${voice.name} (${tier})` : voice.name;
}

export const asVoice = (voice: Offered, among: readonly Offered[]): Voice => ({
  id: voice.id,
  label: labelOf(voice, among),
  backend: voice.id.startsWith('azure:') ? 'azure' : 'piper',
});
