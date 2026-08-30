/* Opening a Sammlung that the address names.
 *
 *     …/mitreden/?sammlung=spiegel-und-ei
 *
 * A link on <https://lautstark.tech/sammlungen/> lands somebody here with the
 * sentences already in the list, instead of: download the file, find it again,
 * open Einstellungen, press einlesen.
 *
 * The reading half is `@lautstark/werkzeuge/sammlung`, shared with vorlaut and
 * with bildhaft when it wants the same door. What is worth sharing is not the
 * lines but the check it does: the address names an entry and never a URL,
 * because a parameter holding an address turns a link into „fetch whatever this
 * says and import it" — and what gets imported is read to a child.
 *
 * ## Why there is no check that the file is ours
 *
 * vorlaut needed one. Its importer sends JSON that is not a Sicherung to the
 * talker's board reader, which read a list of sentences as a board with no
 * buttons and made an empty five-key set out of it — silently. Here the same
 * mistake lands in readFile(), which finds no sentences in a board file and
 * says „Keine Sätze in dieser Datei." That is true, and it is the sentence
 * somebody needs. A second, cleverer refusal would be a second thing to keep
 * right for no gain.
 */

import { wanted } from '@lautstark/werkzeuge/sammlung';
import { importFile } from './settings.ts';
import { say, busy } from './dom.ts';
import { OPEN, notify } from './state.ts';
import { t } from '../i18n/index.ts';

/**
 * Reads the address and, where it names a Sammlung, puts it in the list.
 *
 * Never rejects. It runs at the end of start(), where a rejection would be read
 * as the page having failed to load — and this failing is a message, not a
 * broken page: whatever was already here is still here.
 *
 * `here` is an argument with the live address as its default, which is what
 * lets this be tested where there is no window.
 */
export async function openNamed(here?: string): Promise<void> {
  const asked = here === undefined ? await wanted() : await wanted(here);

  switch (asked.kind) {
    case 'none':
      return;
    case 'unknown':
      say(t('shelf_unknown'));
      return;
    case 'offline':
      say(t('shelf_offline', { error: asked.error.message }));
      return;
    case 'file':
      busy('shelf_fetching');
      {
        // Everything here is what „Sammlung einlesen" already does, down to the
        // words: the count, the voices that could not be honoured, the redraw.
        // Two ways in, one import.
        const into = await importFile(asked.file);
        /* And then open it, which the file picker does not have to: somebody
           there is standing in Einstellungen with the rail behind them, while
           somebody arriving from a link asked for one Sammlung by name. Landing
           them on whatever happened to be open, with the thing they clicked for
           sitting closed in the rail, is not an arrival. Alone, rather than
           added to what was open, for the same reason. */
        if (into) {
          OPEN.clear();
          OPEN.add(into);
          notify();
        }
      }
  }
}
