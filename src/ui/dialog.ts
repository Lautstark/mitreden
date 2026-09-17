/**
 * This app's dialogs, which are @lautstark/design/dialog's — with its two
 * dismissals named once instead of at every call site.
 *
 * The shared module deliberately carries no words: two of the four products are
 * bilingual and a string in the package would be wrong in one of them. So every
 * caller supplies `cancelLabel` and `closeLabel`, and here that meant t('cancel')
 * four times and t('close') six — ten chances for one of them to drift.
 *
 * bildhaft has had this wrapper since the shared module existed; the other three
 * wrote the labels out. The family review of 2026-09-02 counted them.
 *
 * The two dismissals stay named apart, which is the rule this exists to hold
 * rather than a detail it happens to satisfy: the corner ✕ says what it *is*, a
 * footer button says what it *does*, and giving both the same name is the defect
 * design.md §2 recorded.
 *
 * `t` is called per invocation and never captured: this page changes language
 * without reloading, and a label read once would be the previous language's.
 */

import { confirmDialog as ask, openDialog as open } from '@lautstark/design/dialog';
import type { ConfirmOptions, DialogOptions, OpenDialog } from '@lautstark/design/dialog';
import { t } from '../i18n/index.ts';

export type { OpenDialog };

export function openDialog(options: Omit<DialogOptions, 'closeLabel'>): OpenDialog {
  return open({ ...options, closeLabel: t('close') });
}

/** A destructive or confirming question. Resolves true when confirmed. */
export function confirmDialog(
  options: Omit<ConfirmOptions, 'cancelLabel' | 'closeLabel'>
    & Partial<Pick<ConfirmOptions, 'cancelLabel' | 'closeLabel'>>,
): Promise<boolean> {
  return ask({ cancelLabel: t('cancel'), closeLabel: t('close'), ...options });
}

/**
 * The two parts of the shared frame this product names, and the one place it
 * reaches past it.
 *
 * @lautstark/design/svelte/Sheet takes an `id` for the `<dialog>` — because
 * vorlaut's `#legal` is 520px by an id selector — and takes none for the ✕ it
 * draws or for the `.body` region. mitreden has four ids on those two
 * elements that its suite clicks and reads: `#infoclose`, `#setupclose`,
 * `#colvoiceclose` and `#infobody`. Losing them would be a change to three
 * e2e files to suit a refactor of the markup under them.
 *
 * `dialog` is a prop of that component for exactly this kind of reach —
 * conventions.md §6.1, "the element, for the caller that has to reach it" —
 * and an id written here stays written, because the frame declares none on
 * either element and so has no attribute to re-render over it. That is the
 * difference from wochenwerk's `setAttribute` on `aria-label`, which §6.1
 * names as a defect: that one fights a value the frame itself draws.
 *
 * It is still a reach, and the fix is a `closeId` and a `bodyId` beside `id`
 * in the package. This is the three call sites that want them, gathered into
 * one function, so that adopting those props later is one edit here and none
 * in the components.
 */
export function nameParts(
  dialog: HTMLDialogElement | undefined,
  ids: { close: string; body?: string },
): void {
  if (!dialog) return;
  const close = dialog.querySelector('.head > button');
  if (close && close.id !== ids.close) close.id = ids.close;
  if (!ids.body) return;
  const body = dialog.querySelector(':scope > .body');
  if (body && body.id !== ids.body) body.id = ids.body;
}
