/** Which voices this page may offer, and what to call them. */

import { listVoices, piperVoices, type Offered } from '@lautstark/stimmquelle/browser';
import type { Voice } from './types.ts';

/** `piper:de_DE-thorsten-medium` -> `de_DE-thorsten-medium`, for vits-web. */
export const modelOf = (id: string): string => id.replace(/^piper:/, '');

/**
 * The shipped voices: the catalogue decides which may be offered at all, so a
 * licence rule is enforced where a voice is about to be used rather than in a
 * comment. Azure joins them only once a key is set.
 */
export const shipped = (): readonly Offered[] => piperVoices();

export async function offered(azure?: { key: string; region: string }): Promise<readonly Offered[]> {
  return listVoices(azure ? { azure } : {});
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
