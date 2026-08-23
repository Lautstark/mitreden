/**
 * The Sicherung that keeps itself: a folder chosen once, written to from then
 * on without anybody remembering to.
 *
 * An *addition* to „Alles sichern" beside it and never a replacement. The
 * picker exists only on Chromium on the desktop — not Safari, not Firefox, and
 * on no browser on Android — so this draws nothing at all elsewhere and the
 * download stays the whole offer. A tablet must not be shown a backup story it
 * cannot have. @lautstark/design design.md §3.3 settles the wording, which is
 * why the German here reads the same as bildhaft's and vorlaut's.
 *
 * What goes into the folder is `exportEverything()` from db/backup.ts, and
 * that function drops the Azure key on the way out. It matters here more than
 * anywhere: choosing a folder is choosing to have the file carried off the
 * machine by a sync client, so a credential in it would be posted to somebody's
 * cloud. tests/unit/backup-payload.test.ts holds that in place.
 */

import { Sicherung, type Status } from '@lautstark/sicherung';
import { actionsFor, ago as relative } from '@lautstark/sicherung/ui';
import { lang, t } from '../i18n/index.ts';
import { el, say } from './dom.ts';

/**
 * "vor 3 Minuten" / "3 minutes ago", in whichever language the page is in
 * *right now*.
 *
 * lang() is read on every call and must stay that way. This page changes
 * language without reloading, so a locale captured once — in a const here, or
 * in a formatter inside the package — would go on answering in the language
 * the reader has just left, while still returning a perfectly well-formed
 * relative time. The package builds its formatter per call for this reason and
 * says so; this is the other half of that arrangement, and the reason it is a
 * function rather than a value. tests/unit/backup-language.test.ts holds it.
 *
 * Exported for that test alone. The page-local one-argument shape is also what
 * this file exported before the arithmetic moved into the package, so the seam
 * is where it always was.
 */
export const ago = (at: number): string => relative(at, lang());

/** The age of the last real copy, or the admission that there has never been one. */
const lastCopy = (at: number | null): string =>
  at === null ? t('folder_never') : t('folder_last', { age: ago(at) });

/**
 * The sentence for each state. The two that mean *nothing is being written*
 * both carry the age: „es funktioniert nicht" is a sentence somebody can put
 * off, „seit elf Tagen nichts gesichert" is not.
 */
function sentence(status: Status): string {
  switch (status.kind) {
    case 'unsupported': return '';
    case 'off': return t('folder_off');
    case 'saving': return t('folder_saving');
    case 'idle': return status.lastWrite === null
      ? t('folder_idle_never', { folder: status.folder })
      : t('folder_idle', { folder: status.folder, age: ago(status.lastWrite) });
    case 'needs-permission':
      return t('folder_permission', { folder: status.folder, age: lastCopy(status.lastWrite) });
    case 'failed':
      return t('folder_failed', { reason: status.reason, age: lastCopy(status.lastWrite) });
  }
}

/**
 * Paints into the markup index.html already carries, rather than building it.
 *
 * mitreden's settings are a static <dialog> that the language pass walks with
 * data-i18n; a block assembled in JavaScript would sit outside that pass and
 * would be the one thing on the page that did not change language. The two
 * nodes here hold no translated text of their own — every string arrives
 * through t() on each paint — so they are the exception that stays honest.
 */
export function wireBackupFolder(backup: Sicherung): void {
  const box = el('folderbox');
  if (!Sicherung.supported) {
    // Not disabled, not explained: a control that cannot exist here should not
    // take up a paragraph telling somebody their browser is wrong.
    box.hidden = true;
    return;
  }

  const line = el('folderstate');
  const actions = el('folderactions');

  const button = (key: Parameters<typeof t>[0], kind: string, run: () => Promise<unknown>) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `btn ${kind} sm`;
    node.textContent = t(key);
    node.onclick = () => {
      // The gesture is why these are buttons: choose() and confirm() open a
      // browser prompt and are refused without one.
      node.disabled = true;
      void run().finally(() => { node.disabled = false; });
    };
    return node;
  };

  function paint(status: Status): void {
    // data-state takes the kind verbatim — components.css keys off exactly
    // these names, so there is no mapping here to disagree with it.
    line.setAttribute('data-state', status.kind);
    line.innerHTML = '';
    const dot = document.createElement('span');
    dot.className = 'dot';
    const words = document.createElement('span');
    words.textContent = sentence(status);
    line.append(dot, words);

    // Which buttons belong to this state is the package's answer now. It was
    // the same six-branch switch in all three products — one contract with
    // three copies and nothing checking they agreed, which is the arrangement
    // where one of them quietly stops offering a way out of `failed`. What
    // stays here is the drawing and the words: the ids the table returns are
    // exactly the i18n keys, so `folder_${id}` is a lookup and not a mapping
    // table that could disagree with it.
    //
    // Two of that table's decisions were argued in this margin and are worth
    // keeping findable. `idle` offers no "save now": the folder is written on
    // every change already, so the button sat directly above „Sicherung als
    // Datei" differing from it by a word naming the wrong axis — timing rather
    // than destination. `saving` offers nothing rather than disabled buttons,
    // which would flicker greyed on every debounce.
    actions.innerHTML = '';
    for (const action of actionsFor(backup, status))
      actions.append(button(`folder_${action.id}`, action.primary ? 'primary' : 'quiet',
        async () => {
          await action.run();
          // The only one that says anything out loud: the rest are reported by
          // the status line repainting underneath.
          if (action.id === 'forget') say(t('folder_forgotten'));
        }));
  }

  paint(backup.status);
  backup.subscribe(paint);
}
