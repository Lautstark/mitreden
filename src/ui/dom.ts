/**
 * The status line: what just happened, in words, where a screen reader will
 * read it.
 *
 * This file used to hold the element helpers and the words too. `byId` went
 * with the markup it read — there are no ids to reach for any more, because
 * nothing builds a node and then goes looking for it — and `applyLang()` went
 * with `data-i18n`: a component calls `t()` while it draws, so the words are
 * the drawing rather than a second pass over it. What is left is the one thing
 * that is genuinely not a component: a live region, which has to be the same
 * element from the first frame to the last.
 *
 * It keeps this file name because the language does not decide that. The
 * shelf's unit test mocks `src/ui/dom.ts` for exactly these two functions
 * (tests/unit/shelf.test.ts), and a rename would be a change to a unit test to
 * suit a refactor of the layer above it.
 *
 * ## Why the line is not drawn by Svelte
 *
 * `#s` is in App.svelte's markup and stays empty there. The text is written by
 * @lautstark/design/toast's announcer, into the same node, for the life of the
 * page — which is the whole property the region needs and the one it did not
 * have. The line carried no role and was toggled with [hidden], so it was out
 * of the accessibility tree at the moment every message arrived and back in it
 * a beat later. "42 Sätze hinzugefügt", a saved key and every error this page
 * reports were all silent. e2e/announce.spec.ts is that, written down.
 *
 * Handing the node to the announcer rather than rendering `{status}` is also
 * what keeps `.status:empty` true: an expression that is currently the empty
 * string is still a text node, and this line's whole claim to staying on screen
 * is that it takes no room while it has nothing to say.
 *
 * bildhaft had the same bug by another route — it appended the node with the
 * message on it and removed it again — which is why the rule is
 * @lautstark/design/toast's now rather than three separate retellings of it.
 *
 * No `rest`: this line keeps what it last said. bildhaft's empties after 3.2
 * seconds and vorlaut's dims after four, and all three are right about their
 * own page — see the module, which leaves that to the caller on purpose.
 */

import { announcer, type Announcer } from '@lautstark/design/toast';
import { t, type Key, type Vars } from '../i18n/index.ts';

let line: Announcer | undefined;
let node: HTMLElement | undefined;

/**
 * The element the line is written into, handed over once App.svelte has drawn
 * it. Once, because an announcer holds the pending timer and a second one would
 * not know about the first one's.
 */
export function useStatusLine(element: HTMLElement): void {
  if (line) return;
  node = element;
  line = announcer(element, { busyClass: 'working' });
}

/* Nothing says anything before the page is on screen — start() runs after the
   mount — so this never answers undefined in practice. It answers it rather
   than throwing because a status line is not worth a blank page. */
const status = (): Announcer | undefined => (node ? line : undefined);

/** What just happened, in words. */
export function say(message: string): void {
  status()?.say(message);
}

/**
 * The same line, for something that has started rather than finished.
 *
 * The words were already right — "Wird aufgenommen …" — but they arrived in the
 * same grey as "42 hinzugefügt" and then sat there, so the one message that
 * means *wait* looked exactly like the one that means *done*. The class draws a
 * turning ring in front of it, and every ordinary say() takes it away again,
 * which is why the removal is in say() rather than at each callsite: the end of
 * a job is always reported, and forgetting to stop the spinner would leave the
 * page claiming to be busy for the rest of the session.
 */
export const busy = (key: Key, vars?: Vars): void => {
  status()?.busy(t(key, vars));
};
