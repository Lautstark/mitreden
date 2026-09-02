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
