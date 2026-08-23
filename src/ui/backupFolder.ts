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
import { lang, t } from '../i18n/index.ts';
import { el, say } from './dom.ts';

/**
 * "vor 3 Minuten" / "3 minutes ago", in whichever language the page is in.
 * Built per call rather than once: the language can change while the dialog is
 * open, and a formatter captured at module load would keep answering in the
 * old one.
 */
const STEPS: [limit: number, unit: Intl.RelativeTimeFormatUnit, per: number][] = [
  [60_000, 'second', 1000],
  [3_600_000, 'minute', 60_000],
  [86_400_000, 'hour', 3_600_000],
  [Infinity, 'day', 86_400_000],
];

export function ago(at: number, now = Date.now()): string {
  const gap = Math.max(0, now - at);
  const [, unit, per] = STEPS.find(([limit]) => gap < limit)!;
  return new Intl.RelativeTimeFormat(lang(), { numeric: 'auto' })
    .format(-Math.round(gap / per), unit);
}

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

    const forget = button('folder_forget', 'quiet', async () => {
      await backup.forget();
      say(t('folder_forgotten'));
    });

    actions.innerHTML = '';
    switch (status.kind) {
      case 'off':
        actions.append(button('folder_choose', 'primary', () => backup.choose()));
        break;
      case 'needs-permission':
        actions.append(button('folder_confirm', 'primary', () => backup.confirm()), forget);
        break;
      case 'failed':
        actions.append(button('folder_retry', 'primary', () => backup.save()), forget);
        break;
      case 'idle':
        // No "save now". The folder is written on every change already, so a
        // button offering to do it again sat directly above „Sicherung als
        // Datei" and differed from it by a word naming the wrong axis — timing
        // rather than destination. „Erneut versuchen" below is not the same
        // button: after a failure there is nothing happening to be redundant
        // with.
        actions.append(forget);
        break;
      case 'saving':
        // Nothing while it writes. Two greyed buttons flickering on every
        // debounce is worse than a moment with none.
        break;
      case 'unsupported':
        break;
    }
  }

  paint(backup.status);
  backup.subscribe(paint);
}
