# A shared design language for mitreden and bildhaft

**Status: proposal.** Nothing here has been applied. This document compares the two
products as they stand today, names what they should share, and lists what mitreden
would have to change. It is written so that either repository can follow it without
looking at the other one's code.

*mitreden* takes a sentence and gives back an audio file, so that every device a
child speaks through uses the same voice. *bildhaft* takes a German sentence and
gives back a row of AAC pictograms to correct and print. Same author, same field,
same mark — a speech bubble with a face, byte-identical path data in `icon.svg`
here and `src/ui/Logo.tsx` there, filled pink in one and orange in the other.

The goal is that they read as siblings: same look, same interaction patterns, same
words for the same things. The method is a written rule set, not shared code.

## Ground rules this document works under

These are constraints, not preferences. Every proposal below is measured against
them.

**No code crosses between the repositories.** Not a component, not a stylesheet,
not a utility. bildhaft is React + TypeScript + Vite with a build step; mitreden is
one HTML file, `ui.html`, with inline CSS and inline JS, no npm, no framework, no
preprocessor, no CDN. That is deliberate on mitreden's side and this document does
not argue with it. What travels between the two is *this document*.

**`ui.html` ships in the container.** `mitreden.py` reads it off disk on every
request (see `UI = ROOT / "ui.html"`), so editing it locally needs no restart — but
the file is `COPY . .`'d into the image, which means any interface change reaches
every NAS running `ghcr.io/steffipetaffy/mitreden` on the next `docker compose
pull`. There is no staged rollout and no way for a user to keep the old interface
short of pinning an image tag. That is the container impact every item on the
change list has to answer for.

**Correction to a common assumption:** on `main` there is *no* `tools/build-site.py`
and no `docs/app/`. `docs/` is the marketing site only — `index.html`, `de.html`,
`style.css`, the videos and posters. A static build of the interface exists only on
the `spike/piper-wasm` branch (`docs/app/index.html`, plus `docs/spike/README.md`).
So today an interface change lands in exactly one place, the container. If that
spike ever merges, every item below gains a second landing place, and the items
marked *server-shaped* are the ones that would not survive there.

**mitreden's interface is bilingual, bildhaft's is not.** Every user-facing string
in mitreden lives in `lang/de.json` and `lang/en.json` with English keys, and there
is a language picker. bildhaft's German strings are literals inside `.tsx` files
with no i18n layer. Any vocabulary decision therefore costs mitreden one JSON edit
per language and costs bildhaft a hunt through components — the opposite of the
usual asymmetry, and it is why several vocabulary recommendations below land on
bildhaft.

---

## 1. Token audit

Extracted values, both sides, as of this writing.

### 1.1 Colour

mitreden declares its palette once in `ui.html` under `:root` and repeats a subset
in `docs/style.css` for the landing page. bildhaft declares its palette in
`src/styles/app.css`, twice: a light set and a dark set behind
`@media (prefers-color-scheme: dark)`.

| Role | mitreden (`ui.html`) | bildhaft light | bildhaft dark |
| --- | --- | --- | --- |
| page background | `--ink` `#0e1014` | `--bg` `#faf9f7` | `#171614` |
| raised surface | `--panel` `#161920` | `--surface` `#ffffff` | `#201f1c` |
| second surface | `--line-soft` `#1c202a` (misused as one) | `--surface-2` `#f2f0ec` | `#2a2825` |
| third surface | — | `--surface-3` `#e9e6e0` | `#34322e` |
| hairline | `--line` `#242833` | `--line` `rgba(28,26,23,.09)` | `rgba(255,255,255,.09)` |
| text | `--text` `#f2efea` | `--text` `#1c1a17` | `#eeebe6` |
| muted text | `--muted` `#7c8496` | `--text-dim` `#6c665e` | `#a49d93` |
| faint text | — | `--text-faint` `#9a938a` | `#7b746a` |
| accent (fill) | `--accent` `#ff8bc7` | `--accent` `#ff6b35` | `#ff6b35` |
| ink on accent | `--accent-ink` `#14161c` | `--accent-ink` `#2b1206` | `#2b1206` |
| accent as text | — (hard-coded `#ffa3d2` for hover) | `--accent-strong` `#c2410c` | `#ff8b5e` |
| accent wash | — | `--accent-soft` `#fff0e9` | `#2e1c13` |
| success | `--ok` `#3fb96b` | — | — |
| warning | `--warn` `#f0a202` | — | — |
| absent/unknown | `--miss` `#5b6377` | — | — |
| danger | `--danger` `#e5484d` | `--danger` `#b3261e` | `#f2867a` |
| danger wash | — | `--danger-soft` `#fdeceb` | `#35201d` |

Hard-coded colours in `ui.html` that have no token: `#1e222c` (the universal hover
fill, used in eleven places), `#ffa3d2` (accent hover), `#4d5464` (placeholder),
`rgba(0,0,0,.5)` (menu shadow), `rgba(0,0,0,.6)` (dialog backdrop),
`rgba(229,72,77,.12)` (danger hover — a hand-written `--danger` wash that is exactly
bildhaft's `--danger-soft` idea without the token).

**Where they already agree.** The token *names* `--accent`, `--accent-ink`,
`--line`, `--text` and `--danger` mean the same thing in both files, and bildhaft
says so in a comment: `--accent` is the fill, `--accent-ink` is text placed on that
fill. This is the existing shared vocabulary and it should be the spine of the token
set. The `--accent` / `--accent-ink` pairing is the single most important thing the
two already do identically, and it is what makes the mark work in two colours.

**Where they diverge, in order of size.**

1. **Light versus dark.** bildhaft is light-first and follows the OS; mitreden is
   dark-only and says so with `color-scheme: dark`, deliberately, so the OS draws
   its own widgets dark too. This is the largest visible difference between the two
   products and no amount of token alignment hides it.
2. **Hierarchy through borders versus through fills.** mitreden separates a surface
   from its ground with a 1px `--line` border. bildhaft separates them with
   `--surface-2` / `--surface-3` fills and uses `outline: 1px solid var(--line)`
   only as a whisper. Consequence: mitreden has one raised level, bildhaft has
   three, and bildhaft's buttons *are* a surface level while mitreden's buttons are
   a transparent box with a border.
3. **mitreden has three status colours bildhaft has none of** (`--ok`, `--warn`,
   `--miss`) because it has a per-sentence recording state and bildhaft has no
   equivalent — what bildhaft generates counts as accepted, with no pending state to
   report. Not a divergence to fix; a real difference in what the products track.
4. **bildhaft has three accent variants mitreden has none of** (`--accent-strong`,
   `--accent-soft`, plus `--danger-soft`) because on a light ground the brand colour
   fails AA as text and needs a darkened sibling. mitreden on a dark ground does not
   have that problem — but it still lacks a token for "accent-tinted background",
   which is why its active chip has to be a full accent fill and has no quieter
   option.

### 1.2 Type

| | mitreden | bildhaft |
| --- | --- | --- |
| stack | `ui-sans-serif, system-ui, "Segoe UI", sans-serif` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` |
| mono | `ui-monospace, SFMono-Regular, Menlo, monospace` (landing page only) | `--mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |
| base | 16px / 1.55 | 15px / 1.55 |
| product title | `clamp(30px, 6vw, 46px)`, weight 800, tracking −.035em | 18px, weight 650, tracking −.02em |
| dialog heading | 20px, tracking −.02em | 17px, weight 650, tracking −.015em |
| the input you type into | 19px (17px under 560px) | 22px, tracking −.012em |
| list row text | 18px, tracking −.01em | 15px, colour `--text-dim` |
| secondary | 15px / 14px / 13px / 12px, ad hoc | 14 / 13.5 / 13 / 12.5 / 12 / 11.5 / 11, ad hoc |
| uppercase caption | 12px, tracking .04em (`.flabel`) | 11–12px, weight 650, tracking .08em (`.sidebar__section > h2`, `.opt > label`) |

Both use `font-variant-numeric: tabular-nums` for counts, and both use a very
similar uppercase micro-caption. Both stacks are system-font-only — no webfont, no
CDN — which is a shared value worth writing down even though neither file states it.

The real divergence is the **title**: mitreden's `mitreden` is a 46px display
headline at weight 800; bildhaft's `bildhaft` is an 18px sidebar label at weight
650. Same wordmark treatment they are not.

### 1.3 Spacing, radii, shadow, motion

| | mitreden | bildhaft |
| --- | --- | --- |
| spacing | no scale; literal px per rule (2, 4, 6, 8, 10, 12, 14, 16, 18, 22, 36, 40) | no scale; literal px per rule (2, 5, 6, 8, 9, 10, 12, 14, 16, 18, 20, 24, 32, 36) |
| content column | `max-width: 720px`, body padding `clamp(20px, 5vw, 64px)` | `max-width: 840px`, padding `36px 32px 32px`, plus a 268px sidebar |
| large radius | 16px (hero, settings sheet) | `--radius: 14px` (cards, rows, composer); dialog 18px |
| small radius | 10–11px (buttons, inputs, menu) | `--radius-sm: 9px` (fields, menu, slots) |
| pill | 999px (chips, gear, language picker) | 99px (all buttons, chips, toast, segmented) |
| tiny | 7px (menu item), 9px (`.dots`) | 7px (menu item), 4px (`kbd`) |
| shadow | one, untokenised: `0 14px 34px rgba(0,0,0,.5)` on the popup menu | `--shadow-sm` and `--shadow`, both redefined for dark |
| transitions | **none anywhere** | `.13s ease` on every hover, `.15s`–`.22s` on layout |
| reduced motion | not handled (nothing moves) | `@media (prefers-reduced-motion: reduce)` clamps everything to .01ms |

Both are within a pixel or two on the small radius and both reach for a full pill
for chip-shaped things. The 16/14 and 11/9 gaps are noise, not intent.

### 1.4 Focus and hover

This is where they are closest, and it is worth stating exactly:

| | mitreden | bildhaft |
| --- | --- | --- |
| focus ring | `outline: 2px solid var(--accent); outline-offset: 2px` | `outline: 2px solid var(--accent); outline-offset: 2px` |
| applied to | `textarea:focus, input:focus, button:focus-visible`, plus repeats on `.langpick`, `.asbutton`, `select` | one rule: `:focus-visible` |
| checkbox tint | `accent-color: var(--accent)` | `accent-color: var(--accent)` |
| hover | `background: #1e222c` (hard-coded, instant) | `background: var(--surface-2/-3)` (tokenised, .13s) |
| text-field focus | ring only | ring *plus* background lifts `--surface-2` → `--surface` and the border takes the accent |

**The focus rule is already byte-identical in intent.** It should be the first thing
written into the shared token set, because it is the one rule that is already true.
mitreden's version is spread over four selectors because it predates `:focus-visible`
support being universal; collapsing it to one rule is a pure simplification.

---

## 2. Component pattern audit

For each shared concept: what mitreden does, what bildhaft does, how far apart.

### Buttons

- **mitreden.** One `button` base: `font: inherit`, weight 600, radius 10px, padding
  `11px 18px`, transparent fill, 1px `--line` border. `.primary` swaps in the accent
  fill and `--accent-ink`. `.quiet` drops the border and goes `--muted`, brightening
  to `--text` on hover. Danger exists only *inside* the popup menu (`.menu
  button.danger`), never as a standalone button.
- **bildhaft.** One `.btn` base: inline-flex with a 7px gap for an icon, radius 99px,
  padding `8px 14px`, **no border**, `--surface-2` fill. Modifiers `--primary`,
  `--quiet`, `--danger` (text-only, `--danger-soft` on hover), `--danger-solid`
  (filled, white text), `--sm`, `--icon` (round, 7px padding).
- **Distance: large in shape, small in intent.** Both have exactly the same three
  tiers — loud, normal, quiet — and both spell primary as accent-fill +
  `--accent-ink`. The disagreement is bordered-rectangle versus borderless-pill and
  whether a quiet button is grey text or grey fill. bildhaft additionally has an
  icon-button size that mitreden has no equivalent of (`.gear` and `.dots` are two
  separate hand-rolled near-misses of it).

### Text fields and search

- **mitreden.** `textarea` and `input[type=text|search|password]` share
  `background: var(--ink)` — *darker* than the panel they sit in — a 1px `--line`
  border, radius 10–11px, `font: inherit`. The search box is a plain
  `input[type=search]` with `flex: 1; min-width: 200px`, dropping to full width
  under 560px. Placeholder `#4d5464`.
- **bildhaft.** One `.field` class: `--surface-2` fill, **transparent** 1px border,
  radius 9px, and on focus the fill lifts to `--surface` while the border takes the
  accent. The composer is not a `.field` at all — it is a borderless textarea inside
  a `.composer__box` that carries the outline and shows focus with
  `:focus-within`, auto-growing to 190px.
- **Distance: medium.** Recessed-and-outlined versus raised-and-fill-lifting. Both
  are `font: inherit`, both are full-width, both put the primary action to the right
  of or below the typing area. bildhaft's composer submits on Enter with
  Shift+Enter for a newline; mitreden's textarea is explicitly multi-line — one
  sentence per line is the input format — so Enter must stay a newline there. That
  is a genuine difference in the data, not a style choice.

### Chips and filters

- **mitreden.** `.chip`: pill, 13px, weight 500, `--line` border, transparent fill,
  `--muted` text, with a `.n` count span at `opacity: .55` and tabular numerals.
  `.chip.on` fills with the accent. `.chip.fold` is dashed and is the "+ n more"
  affordance after the twelfth chip (`CHIP_CAP = 12`). Two rows, each with an
  uppercase `.flabel` naming the axis (Gruppen / Stimmen); several chips combine
  with OR, the free-text search ANDs on top.
- **bildhaft.** No filter chips at all. The nearest things are `.list__item` in the
  sidebar (a full-width row with the same name-plus-count shape, active state
  `--accent-soft` background + `--accent-strong` text + weight 600) and `.tag` (a
  small non-interactive accent-soft pill used as a badge: "Standard", "1284
  Symbole").
- **Distance: this is the structural fork.** Both render "a named grouping with a
  count, one of which can be current". mitreden renders it as a wrapping row of
  pills that multi-select; bildhaft renders it as a vertical rail that
  single-selects. See §5 for why I do not recommend converging on the rail.

### Dialogs and sheets

- **mitreden.** Native `<dialog class="sheet">` opened with `showModal()`. Radius
  16px, `--panel` fill, `--line` border, padding 24px, `max-width: 520px`,
  `::backdrop` `rgba(0,0,0,.6)`. Free browser behaviour: focus trap, Escape, inert
  background. One instance exists — settings — and it closes with a plain
  `Schließen` button in a `.row`.
- **bildhaft.** Hand-built `.overlay` (fixed, grid-centred, `rgba(22,20,17,.38)` +
  `backdrop-filter: blur(3px)`) wrapping a `.dialog` with radius 18px, `--bg` fill,
  `--shadow`, `max-height: min(88vh, 800px)`, and three regions: `.dialog__head`
  (title + ✕), `.dialog__body` (scrolls), `.dialog__foot` (border-top, a `.spacer`
  that pushes buttons right). Escape and click-outside are wired by hand; focus is
  moved into the dialog on mount. Four instances: settings, print, symbol picker,
  confirm.
- **Distance: medium.** Same silhouette, different plumbing and a different backdrop
  weight (.6 opaque versus .38 + blur). The head/body/foot split is bildhaft's and
  is genuinely better once a dialog has more than one action; mitreden's settings
  sheet has one and does not need it yet.

### Overflow (`⋯`) menus

The closest agreement in the entire comparison. Side by side:

| | mitreden `.menu` | bildhaft `.menu__pop` |
| --- | --- | --- |
| position | `absolute; right: 0; top: calc(100% + 6px)` | `absolute; right: 0; top: calc(100% + 6px)` |
| z-index | 10 | 30 |
| min-width | 200px | 190px |
| padding | 6px | 5px |
| radius | 11px | 9px (`--radius-sm`) |
| fill | `--panel` + `--line` border | `--surface` + `--line` outline |
| shadow | `0 14px 34px rgba(0,0,0,.5)` | `--shadow` |
| item | 14px, weight 500, left-aligned, nowrap, radius 7px, padding `9px 11px` | 14px, left-aligned, nowrap, radius 7px, padding `8px 11px` |
| danger item | `--danger` text, `rgba(229,72,77,.12)` hover | `--danger` text, `--danger-soft` hover |
| dismiss | outside click + Escape (document listeners) | outside mousedown + Escape (document listeners) |
| trigger | `⋮` text glyph in a `.dots` button | horizontal three-circle SVG in `.btn--quiet.btn--icon` |
| roles | `aria-haspopup="true"`, `aria-expanded` | `aria-haspopup="menu"`, `aria-expanded`, `role="menu"`/`menuitem` |

They differ by one character of glyph, 10px of width, 2px of radius and an ARIA
role. This pattern is effectively already shared and only needs writing down.

mitreden does one thing bildhaft does not: a **second level in the same popup** —
"Stimme ändern" replaces the menu's contents with the voice list rather than opening
a submenu, on the reasoning that seventeen voices have no place in a bar but are
fine in a list you opened on purpose. That is a good rule and belongs in the shared
set.

### List rows

- **mitreden.** `.item`: a flex row, `padding: 15px 2px`, separated by a 1px
  `--line-soft` bottom border — no card, no fill. Contents: checkbox, a `.txt`
  column (18px sentence + a `.meta` line carrying a status dot, a state word, and
  clickable group tags), an `<audio>` element filtered to look dark, and the `⋮`.
  Under 720px the row wraps and the player takes its own line.
- **bildhaft.** `.row`: an `<article>` card, `--surface` fill, `--radius` 14px,
  `outline: 1px solid var(--line)`, 10px apart in a flex column. Head row is the
  sentence in `--text-dim` plus `.row__actions` that are **`opacity: 0` until the
  row is hovered or focused within**. Body is the wrapping slot strip.
- **Distance: medium-large.** Separator-rows versus cards, and per-row actions
  always visible versus revealed on hover. mitreden's choice is right for a list
  that is 200 rows long and scanned; bildhaft's is right for a list of a dozen rows
  that are each worked on. Note that bildhaft's hover-reveal is a desktop assumption
  it can afford (README: "Desktop is the primary target") and mitreden cannot —
  mitreden's README actively sells adding sentences from a phone.

### Empty states

- **mitreden.** `.empty` — left-aligned, `--muted`, 15px, `32px 2px` padding. Two
  texts: `empty_start` ("Noch nichts da. Mehrere Zeilen auf einmal gehen auch — jede
  Zeile wird ein eigener Satz.") teaches the input format; `empty_no_match` ("Kein
  Satz passt.") is the filtered case.
- **bildhaft.** `.empty-state` — centred, `--text-faint`, `40px 20px`. One text:
  "Tippe oben einen Satz und drücke `<kbd>Enter</kbd>`." Also teaches the input
  gesture. The search-empty case is a separate inline "Nichts gefunden."
- **Distance: small.** Same instinct — an empty state teaches the one thing the user
  does not yet know — and both distinguish "nothing yet" from "nothing matched".
  Only alignment and colour depth differ.

### Status and toast

- **mitreden.** `.status` — an inline paragraph directly under the input box, 14px
  `--muted`, `hidden` when empty so it reserves no space. It **persists** until the
  next message. Everything speaks through it: "Wird aufgenommen …", "3 hinzugefügt,
  3 aufgenommen", "Fehlgeschlagen: …". It is both the progress indicator and the
  error channel.
- **bildhaft.** `.toast` — fixed, bottom-centre, pill, inverted (`--text` fill,
  `--bg` text), `role="status"`, cleared after 3200ms. Progress is a separate
  `.spinner` inside the button that caused it.
- **Distance: large, and the two are not interchangeable.** A toast that disappears
  after 3.2 s is wrong for mitreden's long messages ("3 hinzugefügt, 3 aufgenommen,
  1 gab es schon. 1 konnte nicht aufgenommen werden: …") and wrong for a failure the
  user may need to read twice. An inline line anchored to the input is wrong for
  bildhaft, whose actions happen in dialogs far from any one anchor. The shared rule
  should be about *kinds of message*, not about the furniture — see §4.

### Confirmations and prompts

- **mitreden.** Native `window.confirm()` for every destructive action and native
  `window.prompt()` for **editing** — changing a sentence's text, setting its
  groups, bulk-adding or bulk-removing groups. The prompt strings are carefully
  written (`ask_edit_text` even explains that the id and therefore the file name
  stays put) but they render in the browser's own chrome, which no token reaches.
- **bildhaft.** A `Confirm` component built on `Dialog`, with a title, a body that
  names the thing and counts what is lost ("„Der Grüffelo“ und alle 12 enthaltenen
  Zeilen …"), and a confirm button **labelled with the action** ("12 Zeilen
  löschen") rather than "OK". Editing is done in place — the collection title is a
  click-to-edit input, symbols are swapped in a picker dialog.
- **Distance: the largest interaction gap in the two products.** It is also the one
  place where mitreden's constraint bites hardest: a styled confirm dialog is real
  hand-written JS in a no-build file, and native `confirm`/`prompt` cost nothing and
  never break. See §5 for how I would split this.

### Footers

- **mitreden.** The interface has **no footer**. The landing page (`docs/index.html`)
  has one: `--muted`, 14px, `border-top: 1px solid var(--line)`, licence + GitHub
  link.
- **bildhaft.** The app has one, deliberately: `.footer`, 11.5px, `--text-faint`,
  centred in the same 840px column, carrying the ARASAAC attribution (a licence
  requirement) plus "Läuft vollständig im Browser."
- **Distance: not comparable.** bildhaft's footer exists because a licence demands
  it. mitreden has no attribution obligation in the interface. A footer added to
  mitreden purely for symmetry would be furniture; the one line it might honestly
  carry is the same reassurance bildhaft ends on — that nothing leaves the machine.

---

## 3. Concept and vocabulary glossary

This matters at least as much as the pixels. Two products that use different words
for the same thing do not feel like siblings no matter how well the colours match.

### 3.1 The grouping: Gruppe or Sammlung

**The data models are already the same idea.** bildhaft's README states it outright:
"The unit of reuse is the sentence, not the collection. Collections are just a
grouping over them." Its `Sentence` rows are first-class, keyed by
`normalizedInput`, and search is flat across all of them. mitreden is built the same
way: `phrases.json` is a flat list, `tags` is a field on the sentence, search runs
over text *and* group names at once, and a group that loses its last sentence simply
stops existing (`ui.html` prunes `TAGS` on every load).

There is one real difference: **arity**. In mitreden a sentence carries a list of
tags and can be in several groups at once, and the chips combine with OR. In
bildhaft `Sentence.collectionId` is a single string, so a sentence is in exactly one
collection and the sidebar single-selects to match.

**Recommendation: `Gruppe`. bildhaft changes.**

Reasons, in order of weight:

1. **"Sammlung" is already taken in bildhaft's own vocabulary.** Its README calls
   METACOM "eine kommerzielle Symbolsammlung", and its settings dialog talks about
   choosing between symbol sources. A user reading "Sammlung" in the sidebar and
   "Symbolsammlung" in the settings is reading one word for two unrelated things.
   `Gruppe` collides with nothing in either product.
2. **"Gruppe" survives both arities; "Sammlung" does not.** "Dieser Satz ist in drei
   Gruppen" is ordinary German. "Dieser Satz ist in drei Sammlungen" reads as if
   three copies exist — a *Sammlung* is a container you are inside, a *Gruppe* is a
   label you carry. If bildhaft ever relaxes to many-to-many (and its own "the
   sentence is the unit" principle points that way), `Gruppe` already fits.
3. **The change is cheap in the direction it falls.** mitreden would have to rename
   a persisted field (`tags`), a CLI flag (`--tags`), a JSON key documented in the
   README, and ~15 strings in two language files. bildhaft has to rename German
   labels in `.tsx` — `Sammlungen`, `+ Neue Sammlung`, `Name der Sammlung`,
   `Sammlung exportieren`, `Sammlung löschen`, and a handful of confirmation bodies.
   Its *code* keeps `Collection` and `collectionId`, because bildhaft's code is
   English by policy, exactly like mitreden's. Nothing persisted moves, and the
   export format string `bildhaft.collection` is internal and stays.

I want to be honest that this is the recommendation I hold least firmly.
"Sammlung" is the warmer word and it is the one that fits "Der Grüffelo". If the
author prefers it, the collision in point 1 is the thing that would have to be
solved first — probably by renaming bildhaft's *symbol sources* rather than its
groupings.

### 3.2 The thing being grouped

| | mitreden | bildhaft |
| --- | --- | --- |
| in the composer | „Neue Sätze, einer pro Zeile" | „Satz eingeben …", button „Übersetzen" |
| in search | „Sätze und Gruppen durchsuchen…" | „Alle Sätze durchsuchen …" |
| in counts | „{n} Sätze", „{n} von {all} Sätzen" | „12 Zeilen" |
| when deleting | „Satz löschen", „{n} Sätze löschen" | „Zeile löschen", „12 Zeilen löschen" |
| on import | — | „14 Zeilen importiert" |

**Recommendation: `Satz` everywhere. bildhaft changes.** bildhaft says *Satz* when
you are writing one and *Zeile* when you are counting them, which is a seam a user
can feel. `Zeile` is a print artefact — a row on a sentence strip — and it leaks a
rendering concept into the data. bildhaft's own type is `Sentence`. mitreden already
says `Satz` in all five places and needs no change.

### 3.3 Backup, export, download

Three different acts that both products currently blur.

| act | mitreden today | bildhaft today |
| --- | --- | --- |
| get the produced artefact out | „Als MP3 herunterladen" / „Als WAV herunterladen"; ZIP named `mitreden-{n}-{fmt}.zip` | „Drucken" (browser print, no file) |
| hand a subset to someone | CLI only: `mitreden.py export nursery ~/Desktop/nursery` | „Sammlung exportieren"; file `bildhaft-{name}-{stamp}.json` |
| protect against total loss | not in the interface at all; README says back up `phrases.json` yourself | „Sicherung" — Einstellungen → Daten → „Alles exportieren" |

**Recommended rule, three words, no overlap:**

- **Herunterladen** — the produced artefact leaves in the format a device wants (an
  MP3, a ZIP of them). It is not a backup and cannot be read back in.
- **Exportieren** — a *part* of the library leaves as data that the same product can
  read back. Names the part: „Gruppe exportieren".
- **Sicherung** — *everything* leaves as one file, for the case where the storage is
  gone. Never a subset, never a format conversion.

mitreden's current wording already obeys this: „herunterladen" for audio is exactly
right, and its CLI `export` is exactly the middle case. What it lacks is the third
word — there is no **Sicherung** in the interface, only a paragraph in the README
telling you to copy `phrases.json`. bildhaft calls the same act „Sicherung" in prose
but labels the button „Alles exportieren", which crosses the middle and the outer
case. Both would move slightly: bildhaft relabels one button, mitreden gains a
concept it does not have. Both filename conventions already agree —
`<produkt>-<was>-…` — and that convention should be written down.

### 3.4 Settings

Both say **Einstellungen**, so the word is settled. The placement is not: mitreden
puts a `⚙` next to the title, on the reasoning written into `ui.html` that "beside
the title is where a page-wide setting belongs — not down at the list, which would
suggest it changes something about the list." bildhaft puts a text button
„Einstellungen" at the bottom of the sidebar. mitreden's reasoning is the better
one and it is already written down; bildhaft should adopt the gear beside the mark.

Inside, both organise the same way — a card or block per external thing you can
switch on, with its current state stated in words before any control ("Schlüssel ist
gesetzt" / „Ordner „METACOM" · 1284 Bilddateien indiziert"). That is already a
shared pattern and deserves to be a rule: **a settings block states its status in a
sentence before it offers a control.**

### 3.5 No save button

bildhaft states the principle in code and README: "Storage is IndexedDB, saved
automatically on every change. There is no save button." It goes to some trouble to
keep it — the collection title is debounced 400 ms *and* flushed on blur, precisely
so that closing the tab mid-rename does not lose the name.

mitreden holds the same principle without stating it. Adding a sentence records it
immediately; changing a text re-records immediately; picking a voice, ticking a
chip, changing the language all persist as they happen. Its own comments make the
point in a related form: "A sheet, not a wizard: a fresh install already speaks."

Both have **exactly one exception, and it is the same exception**: a settings field
whose half-typed value would be actively harmful. mitreden's API key has a
„Speichern"; bildhaft's function-word list has a „Speichern". Neither is an
oversight. So the rule to write down is not "never a save button" but:

> Everything is saved as it is done. The only place a save button is allowed is a
> settings field where a partial value would do something wrong — half an API key,
> half a word list. Wherever one exists, its scope is one field, never a screen.

### 3.6 Summary table

| concept | mitreden today | bildhaft today | recommended | who moves |
| --- | --- | --- | --- | --- |
| a stored utterance | Satz | Satz / Zeile | **Satz** | bildhaft |
| a named grouping of them | Gruppe | Sammlung | **Gruppe** | bildhaft |
| making the grouping current | filter chips („Alle") | sidebar selection | both allowed, see §5 | neither |
| the produced artefact leaving | herunterladen | drucken | **herunterladen** | neither |
| a subset leaving as data | export (CLI only) | „Sammlung exportieren" | **Gruppe exportieren** | both, slightly |
| everything leaving as data | — | „Alles exportieren" (called Sicherung in prose) | **Sicherung** | both |
| the settings surface | Einstellungen (⚙ beside title) | Einstellungen (sidebar foot) | **Einstellungen, ⚙ beside the mark** | bildhaft |
| more actions on a thing | ⋮ | ⋯ | one glyph, pick **⋯** | mitreden (one character) |
| a destructive confirmation | native confirm, „OK" | dialog, button named for the act | **name the act on the button** | mitreden |
| saving | implicit | implicit, stated | **implicit, stated, one exception** | mitreden states it |

---

## 4. The shared design language

What follows is the deliverable: named tokens and rules concrete enough to be
implemented independently in a React app with a build step and in a single
dependency-free HTML file. Nothing here requires either repository to look at the
other's source.

### 4.1 The mark

One SVG path, one face, `viewBox="0 0 512 512"`. Both products already carry the
identical geometry; that is the anchor and it must not drift. The rule around it:

- The bubble is filled with the product's **`--accent`**. The eyes and the smile are
  always white — not `--surface`, not `--bg`, plain `#fff` — so the mark survives
  being printed, favicon'd, or dropped on any ground.
- **One accent hue per product, and it is the product's identity.** mitreden is pink
  `#ff8bc7`; bildhaft is orange `#ff6b35`. These must *not* converge. The family
  resemblance is carried by the shape and by every other token; the accent is what
  tells the two apart at a glance, and a sibling product that ever joins takes a
  third hue.
- The mark is never recoloured for a state, never animated, never outlined.
- The wordmark is set in the interface font, lowercase, tight tracking (−.02em to
  −.035em), and sits immediately right of the mark with a gap of roughly a third of
  the mark's width.

### 4.2 Tokens

Names are normative; **values are per product**. A product implements this table
however its stack prefers — CSS custom properties in both cases today, which both
already use.

**Ground and surfaces**

| token | meaning |
| --- | --- |
| `--bg` | the page itself. The furthest-back plane. |
| `--surface` | a raised plane sitting on `--bg`: a card, a sheet, a popup. |
| `--surface-2` | a plane sitting on `--surface`: a quiet button's fill, a field's fill, a code block. |
| `--surface-3` | `--surface-2` under the pointer. Never used at rest. |
| `--line` | the hairline that separates two planes of the same value. |

mitreden's current `--ink`/`--panel` map onto `--bg`/`--surface` exactly.
`--line-soft` is doing `--surface-2`'s job in some places and a lighter `--line`'s
job in others, and should split.

**Text**

| token | meaning |
| --- | --- |
| `--text` | what you read. |
| `--text-dim` | labels, captions, states, counts. Legible, secondary. |
| `--text-faint` | placeholders, attributions, the small print. Must still clear AA. |

mitreden's `--muted` is `--text-dim`; it has no `--text-faint` and hard-codes one
(`#4d5464`) for placeholders.

**Accent and states**

| token | meaning |
| --- | --- |
| `--accent` | the brand fill. The one saturated colour on the screen. |
| `--accent-ink` | text placed **on** `--accent`. Must clear 4.5:1 against it. |
| `--accent-strong` | the accent adjusted so it is legible **as text on `--bg`**. On a dark ground it may equal `--accent`; on a light one it must be darkened. |
| `--accent-soft` | an accent-tinted plane: the current item, an accent notice. |
| `--danger` | destructive. Text colour, not a fill, except on a filled confirm button. |
| `--danger-soft` | a danger-tinted plane: the hover behind a destructive menu item. |
| `--ok` | a thing succeeded and stays succeeded. |
| `--warn` | a thing is out of date but not broken. |
| `--miss` | a thing was never made. Reads as absence, not as failure — it is not red. |

`--ok`/`--warn`/`--miss` are **optional**: a product declares them only if it
actually tracks per-item state. mitreden does (recorded / changed since recording /
not recorded yet); bildhaft does not, because what it generates counts as accepted.
A product that adds such a state later must use these three names and this meaning
rather than inventing its own.

**Shape and motion**

| token | value | meaning |
| --- | --- | --- |
| `--radius` | 14px | cards, sheets, rows, the composer. |
| `--radius-sm` | 9px | fields, buttons, popups, menu shells. |
| `--radius-pill` | 999px | chips, icon buttons, toasts, anything whose height sets its shape. |
| `--radius-item` | 7px | a row inside a popup. |
| `--shadow-sm` | 1px offset, 2px blur, very low alpha | a plane that has only just left the page. |
| `--shadow` | a 2/6 pair plus a 12/32 pair | a plane that floats: popup, dialog. |
| `--font` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | **identical string in both products.** |
| `--mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | ids, keys, formats. |

No webfont, ever. No CDN, ever. The system stack is the shared rule and it is
already true on both sides; the string should simply be made identical.

Motion, where a product has any: **130ms ease** for a colour or fill change, **220ms
ease** for something that changes size or position, nothing else. Both values behind
`@media (prefers-reduced-motion: reduce)`, which clamps them to nothing. A product
with no transitions at all — mitreden today — is compliant; it must simply not
invent a third duration when it adds one.

**Spacing.** A 2px base, used at 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40. This is
descriptive, not aspirational — it is what both files already do — but writing it
down stops the next value being 13.

**Reading column.** Content sits in one centred column of **720–840px**. Text you
read runs at 15–16px with line-height 1.55. The sentence you are composing is set
larger than everything else on the page (19–22px), because it is the point.

### 4.3 Rules

**Focus.** One rule, one appearance, everywhere:
`:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`. Never
removed, never replaced by a border change alone. Both products already do exactly
this; mitreden should collapse its four selectors into the one.

**Hover.** A hoverable surface goes up one step: transparent → `--surface-2`,
`--surface-2` → `--surface-3`. A quiet control's *text* goes `--text-dim` →
`--text`. Never a border colour change alone; never a size change.

**Accent tint means "this one".** `--accent-soft` background plus `--accent-strong`
text plus weight 600 marks the current group, the current source, the chosen symbol.
A full `--accent` fill is reserved for one thing per screen: the primary action.
(mitreden currently uses the full fill for both the primary button *and* an active
chip, which is why two very different things shout equally loudly.)

**Buttons: three tiers, no more.** *Primary* — `--accent` fill, `--accent-ink` text,
weight 600, one per view. *Normal* — `--surface-2` fill, `--text`. *Quiet* —
transparent, `--text-dim`, hovering to `--surface-2` and `--text`. Destructive is
not a fourth tier but a colour applied to a quiet or normal button (`--danger` text,
`--danger-soft` hover); only the confirm button of a destructive dialog is filled.
An icon-only button is a normal or quiet button at pill radius with equal padding.
Whether the family is bordered rectangles or borderless pills is a **per-product
choice** — but a product picks one and applies it to every button it has, including
the gear and the ⋯.

**Fields.** A field is a fill, not a hole. At rest, `--surface-2` with a transparent
border. On focus the fill lifts to `--surface`, the border takes `--accent`, and the
focus ring appears. Placeholder is `--text-faint`. `font: inherit`, always — a
sentence typed into the product must look like the same sentence when it is read
back out of the list.

**Chips.** Pill radius, `--text-dim` on transparent, with an optional count set at
`opacity: .55` and `font-variant-numeric: tabular-nums`. Selected takes the accent
tint. A chip is a **filter**: it changes what is shown and never what is stored.
This is mitreden's rule and it is written into `ui.html` in as many words —
*filters are pills, actions are boxes* — and it should hold in both products.

**The overflow menu.** One pattern, already near-identical: anchored under its
trigger with a 6px gap and right-aligned to it, min-width 190–200px, `--surface`
plane, `--shadow`, `--radius-sm` shell, 5–6px padding, `--radius-item` rows at 14px
left-aligned and nowrapped. Destructive rows sit last, in `--danger`, over
`--danger-soft` on hover. It closes on outside click and on Escape. The trigger is
an icon button carrying `aria-haspopup` and a live `aria-expanded`; the popup
carries `role="menu"` and its rows `role="menuitem"`.

Plus mitreden's own good rule, promoted: **a long list of choices replaces the
menu's contents rather than opening a submenu.** Seventeen voices, or forty
groups, have no place in a bar, but they are fine in a list you opened on purpose.

**A row's actions live in the menu, not in the row.** A row shows its content and
one `⋯`. What it shows *about* itself — a state, a count, its groups — may be
clickable, but everything you can *do* to it is behind the one trigger. This keeps a
row from growing a new control every time the product grows a feature, and it means
one place to look. Actions must not be hidden behind hover: a touch screen has no
hover, and both products are used on one.

**Bulk actions appear only when something is selected**, in a box that is visibly
not a filter row, and their labels name the count they will act on.

**Destructive confirmations name what is lost and label the button with the act.**
Never "OK". „12 Sätze löschen", not „OK". The body states the count and what does
not come back. Where the product cannot style a dialog cheaply, a native
`confirm()` carrying the same *sentence* is acceptable — the wording is the rule,
the chrome is not.

**Messages.** Three kinds, three treatments:

- *Progress* — belongs to the control that started it: a spinner in the button, or a
  line anchored under the input. Disappears when the work does.
- *Outcome* — the sentence that says what happened, including what partly failed.
  Stays until something replaces it. Never auto-dismissed if it names a failure or
  reports a number the user might need.
- *Aside* — a fire-and-forget acknowledgement of something that is already visible
  on screen ("Sicherung exportiert."). May be a toast that clears itself.

Both products may implement these differently — mitreden's persistent inline line is
correct for outcome, bildhaft's toast is correct for aside — but neither may use one
treatment for a kind it does not suit. bildhaft's 3.2 s toast currently carries
outcome messages that report counts; that is the mismatch on its side.

**Empty states teach.** An empty list says the one thing the user does not yet know:
what to type, or how the input is read. A *filtered*-empty is a different, shorter
sentence and must never be confused with the first.

**Saving is implicit**, per §3.5.

**Counts are everywhere.** A group, a selection, a list, a search result: each says
how many, in tabular numerals, next to its name. Both products already do this; it
is one of the strongest existing family resemblances.

**Files that leave carry the product's name**: `mitreden-…`, `bildhaft-…`, followed
by what it is and, where a version matters, a date stamp.

### 4.4 What is explicitly *not* shared

- **The accent hue.** By design.
- **Light or dark.** A product commits to a ground and states it. bildhaft follows
  the OS; mitreden is dark and sets `color-scheme: dark` so the browser's own
  widgets follow. Converging here would cost more than it buys — see §5.
- **The navigation shell.** A sidebar, a chip row, or nothing. See §5.
- **Density.** bildhaft is a desktop tool with card rows and hover-revealed actions.
  mitreden runs on a phone on a home network. A shared token set does not oblige
  them to the same row height.

---

## 5. Prioritised change list for mitreden

Each item: **effort** (small / medium / large), **container impact**, and whether it
is *visual*, *vocabulary*, or *both*.

A note that applies to every item: because `mitreden.py` reads `ui.html` fresh per
request, none of these need a restart in development — but all of them ship in the
image and reach every running NAS on the next pull. There is no partial rollout.
That argues for doing the cheap invisible ones (1–4) in one release and letting the
behavioural ones (7, 9) stand alone so a regression has one suspect.

### Tier 1 — tokens only, no behaviour change

**1. Rename the ground tokens to the shared names.** `--ink` → `--bg`, `--panel` →
`--surface`; split `--line-soft` into `--surface-2` (where it is a fill: `.tag`,
`.asbutton`, `select`) and a lighter `--line` (where it is a separator: `.item`
bottom border, `.svc` top border).
*Effort: small. Container impact: none — pure rename inside one `<style>` block,
no markup, no API, no strings. Visual.*

**2. Tokenise the six hard-coded colours.** `#1e222c` → a `--surface-3` hover token
(eleven occurrences, all meaning the same thing); `#ffa3d2` → an accent-hover value;
`#4d5464` → `--text-faint`; `rgba(229,72,77,.12)` → `--danger-soft`; the two black
alphas → `--shadow` and a backdrop token.
*Effort: small. Container impact: none. Visual.*
This is the highest value-per-line item on the list: it turns "mitreden happens to
use these colours" into "mitreden has a palette", and it is what makes items 5 and 6
one-line changes later.

**3. Add the missing shared tokens even where nothing uses them yet:**
`--accent-strong` (on mitreden's dark ground it may simply equal `--accent`),
`--accent-soft` (a low-alpha pink wash), `--text-faint`, `--radius`/`--radius-sm`/
`--radius-pill`/`--radius-item`, `--shadow-sm`/`--shadow`, `--font`, `--mono`.
*Effort: small. Container impact: none. Visual.*

**4. Adopt the identical font stack string** — add `-apple-system`, `Roboto`,
`"Helvetica Neue"`, `Arial` to the existing four.
*Effort: small. Container impact: none — no layout shift on any platform that
already resolved to `ui-sans-serif` or `system-ui`, which is all of them. Visual.*

### Tier 2 — small visual convergences

**5. Collapse the four focus rules into one `:focus-visible`.** The rule is already
identical to bildhaft's; the selectors are not.
*Effort: small. Container impact: none. Visual.*
Watch for one behaviour change: `textarea:focus`/`input:focus` currently ring on
*any* focus including mouse click; `:focus-visible` will not ring on a mouse click
into a field. That is the intended modern behaviour and matches bildhaft, but it is
a visible difference and should be a deliberate one.

**6. Reserve the full accent fill for the primary action; give the active chip the
accent tint instead** (`--accent-soft` background, `--accent-strong` text, weight
650 — the weight bump is already there).
*Effort: small. Container impact: none. Visual.*
This is the change with the biggest look-and-feel payoff per line. Today "Satz
hinzufügen" and four selected group chips are all solid pink and compete; afterwards
there is one loud thing on the page and the filters are visibly a different class of
control. It also makes the existing written rule — *filters are pills, actions are
boxes* — legible in colour as well as in shape.

**7. Regularise the button family.** Right now there are six near-misses: `button`,
`.primary`, `.quiet`, `.gear` (pill, icon), `.dots` (9px radius, icon), `.chip`
(pill), `.asbutton`/`select` (its own fill), plus `#dlmp3`/`#bulk` with surgically
zeroed corners for the split control. Reduce to: one base, three tiers, one icon
variant, one chip, and let the split control be the base with two corners zeroed.
*Effort: medium. Container impact: none functional, but it touches nearly every
control in the interface at once — the release where a spacing regression is most
likely to be noticed by someone on a NAS. Visual.*
Keep mitreden's bordered-rectangle family; do **not** adopt bildhaft's borderless
pills. On a dark ground with a single surface level, borders are how mitreden
separates planes at all — removing them would require the whole three-surface scheme
and a much larger change than this is worth.

**8. Give the settings sheet a head/body/foot** (title row, scrolling body, a footer
with a border-top holding „Schließen"), matching bildhaft's dialog anatomy.
*Effort: small. Container impact: none — `<dialog>` and `showModal()` stay, which is
the right call: native dialogs bring the focus trap and Escape handling for free and
mitreden has no framework to rebuild them with. Visual.*

### Tier 3 — vocabulary and wording

**9. Name the act on destructive confirmations.** `ask_delete_other` currently
reads "{n} Sätze löschen?\n\nDie Sätze und ihre Audiodateien werden entfernt. Das
lässt sich nicht rückgängig machen." — the body is already exemplary. What is
missing is the button, and a native `confirm()` cannot label its button. Two
options: (a) accept the limit and keep the excellent bodies as they are, which is
defensible and free; or (b) build one small confirm dialog on the existing
`<dialog>` element and route the four `confirm()` calls through it.
*Effort: small for (a) — no change at all; medium for (b) — ~30 lines of JS and one
`<dialog>` in the markup. Container impact: (b) changes a modal that every user
meets when deleting; it must keep Escape, must keep the button order, and must not
regress the case where a bulk delete is triggered with a filter active. Both.*
My recommendation is **(b), but last** — after tiers 1 and 2 have landed and
settled. It is the single biggest step toward feeling like the same product, and
also the only item that adds real JavaScript to a file whose smallness is the point.

**10. `⋮` → `⋯` in the row trigger** (one character in `ui.html`, plus two mentions
in `README.md` and `README.de.md`).
*Effort: small. Container impact: none. Visual.*
Arbitrary but worth settling: the two products currently document two different
glyphs for the same menu in four README files.

**11. Add a `Sicherung` to the interface** — a menu entry that downloads
`phrases.json` (plus, arguably, the `config.json`), named exactly that, distinct
from the existing „herunterladen" for audio.
*Effort: medium. Container impact: real — it needs a new read-only endpoint in
`mitreden.py`, which is the first item on this list that is not confined to
`ui.html`. It is also the item that makes the least sense in a hypothetical
browser-only build of mitreden, where there is no `phrases.json` on a disk to send.
Both.*
This is the strongest *product* argument in the whole document, quite apart from
sibling-feel: mitreden's README already says `phrases.json` is the only thing that
cannot be recreated, and today the interface offers no way to get it. Someone
running the container on a NAS and adding sentences from a phone has no path to a
backup that does not involve a file manager.

### Tier 4 — assessed and not recommended

**A sidebar of groups, as bildhaft has.** I do not recommend it, and not only on
effort grounds.

- **Arity.** mitreden's groups are many-to-many and combine with OR — two groups
  picked at once show the sentences of both, and a sentence appears under every
  group it carries. A rail is a single-selection navigation; it cannot express "both
  of these" or "this sentence is in three places" without becoming a tree of
  checkboxes, which is the chip row again, vertical and taller.
- **What the grouping *is* in each product.** In bildhaft a Sammlung is a working
  context: you open „Der Grüffelo" and stay inside it for an hour translating a book
  — the README says so, "often translate dozens of lines in one sitting". Committing
  268px permanently to the thing you are inside is honest. In mitreden the groups
  are a lens over one long-lived list. A talker vocabulary is built over years and
  filtered by situation — Kindergarten, home, emergency — and a sentence is
  legitimately in all three. The lens changes many times a minute; the list does
  not.
- **Cardinality.** mitreden's chip row caps at twelve and folds the rest behind
  "+ n more", precisely because the group set is unbounded and grows one entry per
  picture book. A rail listing forty groups sorted by nothing is worse than a fold
  sorted by use.
- **Where it runs.** mitreden's README actively sells adding sentences from a phone
  on the home network. bildhaft's says desktop is the primary target and hides its
  sidebar entirely under 820px. A 268px rail would be dead weight in mitreden's
  primary case.

What *should* be shared is not the furniture but the four things underneath it, and
three of them already are: the name-plus-count shape, the accent tint marking the
current one, an explicit "Alle" reset, and search that matches group names as well
as content. mitreden does all four. bildhaft's sidebar has the first two.

**A light theme.** Not recommended as a convergence goal. `color-scheme: dark` in
`ui.html` is deliberate and is documented in the file itself; `docs/style.css`
mirrors the dark palette so the landing page looks like the program; and the two
demo videos and their poster frames (`poster-de.jpg`, `poster-en.jpg`) show a dark
interface. A light mode is not a token change — it is a second palette, a second
`icon.svg` contrast check, a re-shot video, and a landing page that no longer
matches. The family resemblance has to be carried by shape, spacing, vocabulary and
interaction instead. That is achievable and is what §4 is built to do.

**Card rows and hover-revealed row actions.** Not recommended. mitreden's list runs
to 200 rows before it caps (`CAP = 200`) and is scanned, not worked through; hairline
separators are the right density for that. Hover-revealed actions assume a pointer,
and mitreden is used on a phone.

**A footer in the interface.** Not recommended for symmetry's sake. bildhaft's
exists because the ARASAAC licence requires attribution on screen; mitreden has no
such obligation. If mitreden ever wants one, the honest content is the same
reassurance bildhaft ends on — that nothing leaves the machine — and not a copy of
bildhaft's.

---

## 6. Things that argue against the premise

Stated plainly, because a design document that only finds agreement is not worth
much.

1. **The two live in different lighting.** bildhaft is a light, printerly desktop
   tool; mitreden is a dark, phone-friendly workshop. Whichever way that is
   resolved, one product ends up in a ground it did not choose — and mitreden's dark
   is entangled with its landing page and its recorded demo videos, which are the
   first thing a new user sees.
2. **One is a document editor, the other is a batch tool.** bildhaft's screen is one
   collection being worked through, a dozen rows, each edited by hand, actions
   revealed on hover. mitreden's is a growing archive of hundreds of sentences,
   scanned and filtered, acted on in bulk by checkbox. These want different densities
   and different affordances, and forcing one on the other would make one of them
   worse.
3. **mitreden is bilingual and bildhaft is not.** A shared *vocabulary* in German is
   only half of mitreden's surface; every term also needs its English counterpart in
   `lang/en.json`, which bildhaft has no notion of. If the shared glossary ever grows
   teeth, mitreden's English column has no sibling to agree with.
4. **The interaction gap is a technology gap.** bildhaft can afford a styled confirm
   dialog, an inline click-to-edit title, and a drag-and-drop reorder because it has
   React and a build step. mitreden's native `confirm()`/`prompt()` are not a
   shortfall — they are what "no dependencies, one file" costs and buys. Every rule
   in §4 that could be read as "build a component" has to survive being implemented
   in ~30 lines of vanilla JS, or it does not belong here.
5. **They do not track the same things.** mitreden has a per-sentence lifecycle
   (recorded / stale / missing) with three status colours and a voice per row;
   bildhaft has no pending state at all, by design — "whatever is generated counts as
   accepted". A shared token set cannot pretend both need `--ok`, `--warn` and
   `--miss`, which is why §4.2 marks them optional.
6. **The premise that `ui.html` is shared between two products is not currently
   true.** On `main` it is served by the container only. The double-landing
   constraint is real on the `spike/piper-wasm` branch and would become real again
   if a static build returns — so every item above still answers for it — but as of
   today an interface change has one destination, and item 11 (`Sicherung`) is the
   only one on the list that would not survive the second one.

None of these sink the project. They mean the resemblance has to be built out of
mark, palette structure, focus and hover behaviour, component anatomy, and above all
*words* — not out of a shared layout.
