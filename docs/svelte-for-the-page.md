# The page is Svelte components over the same core

**Status: built, 2026-09-16.** The second of the four Lautstark web products to
take a rendering framework, after the wochenwerk pilot the same day
(`~/Code/wochenwerk/docs/decisions/003-svelte-for-the-two-pages.md`, which this
mirrors). What it was for, and what it found that the pilot could not, is at the
end.

## Context

mitreden drew itself three ways at once. `index.html` carried 370 lines of
static markup — the rail, the composer, the work head, and three `<dialog>`s
with six `<details class="panel">` inside one of them — which a dozen modules in
`src/ui/` found by id and wrote into. `list.ts` built rows with
`document.createElement` and refilled `#list` on every change, then carried two
more paths for the changes a full rebuild could not afford: `repaintWork()`,
which wrote a class and a word back into nodes it found by query, and
`landed()`, which rebuilt exactly one row so a batch reporting itself did not
revoke the blob URL under an `<audio>` playing two rows down. `settings.ts` built
the Azure card from an HTML string and then went looking for its own
`.probe`, `.save` and `.forget` inside it.

Underneath all three sat a subscriber list — `subscribe`, `onWork`, `onLanded`
in `ui/state.ts` — whose whole purpose was answering *who has to be told*, and
`applyLang()`, which walked every `[data-i18n]` in the document on a language
change and was followed by five hand-written redraws for the words that had
never been in the markup. Both had been wrong before: the backup panel was
forgotten once, the three scheme labels a second time.

The core was never the problem. `src/db/` and `src/core/` hold no DOM and are
covered by 137 unit tests. The question was only how the top layer is drawn.

## Decision

The page is one Svelte 5 component tree. `index.html` is 34 lines — the head,
the theme boot snippet, and `<div id="app">`. `src/main.ts` is the boot and
nothing else: the order the stores are read in, which is the one thing that was
never about drawing. `src/ui/store.svelte.ts` replaced the subscriber list with
`$state.raw` over the two loaded lists, and whatever reads `shown()` while it
draws is drawn again when they move.

Four things were kept on purpose:

- **The core is untouched.** Not one line under `src/db/` or `src/core/`
  changed, and no unit test did either.
- **The dialog frame is still `@lautstark/design/dialog`.** The Anybook export
  and every confirmation are built by it, and `ui/sheet.svelte.ts` — wochenwerk's
  file, with the head dropped because no sheet here needs one — mounts
  components straight into the frame's own `.body` and `.foot`, with no wrapper
  between, because `components.css` styles those children directly.
- **The three sheets that were already in the markup stayed markup.** `#info`,
  `#setup` and `#colvoice` are hand-written `<dialog class="sheet">` in
  components, not frames built by the package, and that is a decision rather
  than laziness: their ✕ is `.btn.quiet.icon` where the package's is `.btn.icon`,
  `#info`'s body carries no `.body` class, and `#setup` has no body region at
  all — the panels are the dialog's own children. All three are inside a visual
  baseline compared at a tolerance of zero.
- **The shared vanilla panels are still vanilla.** `@lautstark/sicherung`'s two
  panels, `@lautstark/stimmquelle`'s voice picker and `@lautstark/design`'s
  language row are built once and put in place by `pieces/Vanilla.svelte`, a
  `display: contents` host — wochenwerk's file, unchanged. Nothing in a shared
  package had to change for this product to move.

Not chosen, and why: the same four as the pilot — vanilla with one idiom, React
or Preact, Lit, Solid — for the same four reasons, which are written out over
there and are not this product's to restate.

## What moved, and what stayed

`src/ui/` went from thirteen modules to ten components and eight modules. What
stayed is everything that was never markup:

| Kept | Why |
| --- | --- |
| `dialog.ts` | the two German labels a wordless package needs |
| `dom.ts` | the live region, which must be one element for the life of the page |
| `shelf.ts` | the `?sammlung=` door |
| `settings.ts` | files out and in, and the wipe |
| `penNotes.ts` | the two lines printed on a label sheet |
| `sammlung.ts` | *new* — the acts on a whole Sammlung, which three surfaces reach |
| `store.svelte.ts`, `voices.svelte.ts`, `words.svelte.ts` | *new* — the runes |

Gone outright: `state.ts`'s three watcher arrays, `applyLang()` and every
`data-i18n` attribute, `byId`, `list.ts`'s `draw`/`repaintWork`/`landed` and its
`Map` of blob URLs, `composer.ts`'s `drawVoice`, `rail.ts`'s `drawRail`,
`settings.ts`'s `drawSetup`/`drawTheme`/`drawStates`/`drawVoices`, and
`penExport.ts`'s `draw()` with its `node()` helper.

`src/i18n/index.ts` did **not** become a rune. It holds the tables and is
imported by three unit tests and by the modules that answer a click rather than
draw. `ui/words.svelte.ts` is the half a component needs: one `$state<Lang>`,
and a `t()` that reads it before looking a key up. That one `void current` is
the whole of what replaced `applyLang()` and its five redraws.

## What this conversion measured

The 71 e2e cases were written against the old rendering and pass unchanged
against the new one, including six visual baselines at a tolerance of zero,
which were **not** re-recorded. The emitted stylesheet is byte-identical — same
content hash before and after — which is what a move with no scoped CSS added
looks like.

Bundle, gzipped, what the browser actually fetches:

| chunk | before | after |
| --- | --- | --- |
| `index.html` | 6.8 kB | 1.0 kB |
| the stylesheet | 5.6 kB | 5.6 kB |
| the module runtime | 0.5 kB | 0.5 kB |
| the app (now with the Svelte runtime and the compiled templates) | 53.1 kB | 74.4 kB |
| **on arrival** | **66.1 kB** | **81.5 kB** |
| piper, onnxruntime and lamejs, on the first recording | 125.3 kB | 125.3 kB |
| **everything the page can fetch** | **191.3 kB** | **206.8 kB** |

Twenty-three per cent more to open the page, eight per cent more over
everything it can ever fetch. The pilot's figure was fifteen per cent, and the
difference is arithmetic rather than disagreement: wochenwerk's speech stack
loads with its page and dilutes the runtime, and mitreden's does not arrive
until somebody records. The 15 kB is the runtime and the templates, against a
60 MB voice model that is the actual cost of using this program.

Lines: 3.2k of TypeScript and HTML became 3.3k of TypeScript, Svelte and 34
lines of HTML. That is the one number that did not improve, and the honest
reading is that the prose grew where the code shrank — every `sync()`,
`repaint()`, `draw()` and watcher list is gone, and the arguments that used to
sit in `index.html`'s comments are now in the components that hold the markup
they were about.

## The five things the next product should know

1. **Every record handed to a component is a `$state` proxy, and
   `structuredClone()` and IndexedDB both refuse one.** The pilot's gotcha, and
   it is still the first one. Every write goes through `$state.snapshot()` —
   here that is the Anybook choice on its way to `savePen()`.
2. **A unit test that mocks a module path pins that path.**
   `tests/unit/shelf.test.ts` mocks `src/ui/settings.ts` and `src/ui/dom.ts`,
   and `tests/unit/backup-payload.test.ts` reads `src/main.ts` looking for the
   one `new Sicherung(`. Both had to stay where they were: the first is why
   `settings.ts` still has that name for a file that is now about files rather
   than settings, the second is why the standing backup is still constructed in
   the boot and passed down rather than living beside the panel that draws it.
   Neither is a good place any more, and moving either would have been a change
   to a unit test made to suit a refactor of the layer above it.
3. **`vitest` needs runes compiled the moment a `.svelte.ts` is in a test's
   import graph, and `@sveltejs/vite-plugin-svelte` is the wrong way to get
   them.** `$state` is a compiler form, not a function; without a transform the
   import throws a `ReferenceError` out of a file the test is not about. The
   plugin looks like the answer and is not: it declares an `optimizeDeps` set,
   which turns vitest's dependency optimizer on, and the optimizer fails
   resolving its own runtime's `node:module` before a single test is collected —
   on a clean install, which is why a warm one said it was fine for an
   afternoon. There are no components in these suites, so twelve lines of
   `compileModule` at `enforce: 'post'` do the whole job. wochenwerk did not hit
   any of this because nothing it unit-tests reaches its store.
4. **A rune draws at the press; the thing it is about is written a moment
   later.** The vanilla build could not draw until the write returned, because
   drawing was something it had to go and call and the call sat after the await.
   Runes give you the optimistic version for free, and free is the problem:
   `pickVoice` moved the mark and named the voice before `saveVoice` had landed,
   and `saveVoice` is a read of the settings record, a merge and a put — so two
   presses a moment apart could commit in the order their *reads* resolved.
   Arrow down, arrow up, reload, and the row above the chosen one came back,
   about one run in forty-eight. It is two fixes: the writes go in a chain, and
   the mark waits for its own. The read-modify-write in `db/repo.ts` is the
   actual defect and is still there, under every `save*` in that file; this was
   just the one place a person presses three times in a second. Whatever the
   next product draws from a rune, ask what used to be waiting for the write.
5. **The bundle names `svelte.dev` sixteen times.** Svelte throws
   `new Error('https://svelte.dev/e/effect_orphan')` rather than carrying the
   sentence, so the address *is* the message. Nothing is fetched and nothing is
   linked, but `e2e/offline.spec.ts` sweeps every text file in `dist/` for
   hosts and went red until it was classified — which is the guard working.
   bildhaft and vorlaut-editor carry the same sweep and will see the same thing.

And one thing that is this product's shape rather than a lesson: wochenwerk
mounts into `<main id="app">`, because over there the app *is* one column. Here
the rail is a fixed column beside the work and `main` is the 720px measure the
sentences get, so the mount point is a `<div id="app">` carrying
`display: contents` — the four siblings land in the body's flex layout exactly
as they did when `index.html` wrote them out, the stylesheet did not have to
learn a new name for the column, and `<main>` still means the sentences rather
than the sentences plus the sidebar.

## Consequences

- `npm run typecheck` is `svelte-check`, and it reads the components too.
- `@lautstark/toolchain` is adopted here, the first app to take it: vite,
  vitest, typescript and Playwright arrive through it, and `tsconfig.json`,
  `vitest.config.ts` and `playwright.config.ts` extend its three bases. The
  ports, the plugins and `E2E_PORT` stay this product's.
- The Anybook export has an e2e file of its own for the first time
  (`e2e/pen-export.spec.ts`, four cases). It was the one surface reachable only
  with a recording in hand, so nothing had ever covered it, and it is also the
  one with the most state — three answers that lean on each other and a map of
  the paper drawn from all three. The rewrite had nothing to fail against,
  which is a thing to fix rather than to note.
- Two of four products have moved. By the two-consumer rule the dialog frame is
  now worth turning into a shared Svelte component, and the shared panels after
  it — with the caveat this product adds: three of mitreden's sheets are markup
  rather than frames, and a shared frame has to be able to draw them without
  moving a pixel, or it takes six baselines with it.
