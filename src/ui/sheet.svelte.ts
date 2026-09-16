/* A sheet whose contents are components.
 *
 * The frame — the head with its ✕, the body, the foot, the backdrop press, the
 * one `close` exit — stays @lautstark/design/dialog's by way of ui/dialog.ts,
 * which is what supplies this product's two languages to a package that
 * deliberately carries no words. What this adds is that the body and the foot
 * are Svelte components mounted straight into the frame's own containers,
 * sharing one state object the opener made. No wrapper element between the
 * frame and the content, because components.css styles the frame's children
 * directly and a box in between would take those rules away.
 *
 * wochenwerk's kalender/sheet.svelte.ts, with the head left out: no sheet in
 * this product puts a component beside the title.
 */
import { mount, unmount, type Component } from 'svelte';
import { openDialog, type OpenDialog } from './dialog.ts';

export interface Handle { close(): void; dialog: HTMLDialogElement }
type Part<S> = Component<{ s: S; handle: Handle }>;

export function openSheet<S>(options: {
  title: string; panels?: boolean; wide?: boolean; state: S;
  body: Part<S>; foot?: Part<S>; onClose?: () => void;
}): Handle {
  const made: OpenDialog = openDialog({
    title: options.title, panels: options.panels, wide: options.wide,
    body: [], footer: options.foot ? [] : undefined,
    onClose: () => { for (const part of parts) void unmount(part); options.onClose?.(); },
  });
  const handle: Handle = { close: made.close, dialog: made.dialog as HTMLDialogElement };
  const props = { s: options.state, handle };
  const parts = [mount(options.body, { target: made.body, props })];
  const foot = made.dialog.querySelector<HTMLElement>('.foot');
  if (options.foot && foot) parts.push(mount(options.foot, { target: foot, props }));
  return handle;
}
