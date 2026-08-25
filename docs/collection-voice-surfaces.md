# Where a voice is chosen, now that the Sammlung owns it

The voice moved from the sentence to the Sammlung at `526905c`. The model was
right that day and the screens were not: they went on describing and routing the
voice as though it still lived in Einstellungen. This is what was decided about
the three surfaces that now have a claim on it, and why — the part that is not
readable from the diff.

`~/Code/vorlaut/docs/sammlung-settings.md` answered the same question days
earlier, for a product that holds the same shape and not the same model. Where
this follows it, it says so; where it does not, it says why.

## The three surfaces, and what each one is for

They are not alternatives. Each answers a different question and the failure
mode is one of them answering another's.

| Surface | The question it answers | Whose |
| --- | --- | --- |
| The line under the composer | what the *next recording* gets | a statement, not a control |
| The `⋯` beside a Sammlung's name | what *this Sammlung* records in | that Sammlung's |
| Einstellungen | the Azure key, and the default a *new* Sammlung starts with | this installation |

### The composer line goes on doing exactly what it did

Its comment in `index.html` already said what it was — "not a control: a
statement of which voice the next recording gets, and a way through to where
that is changed" — and that sentence stayed true while becoming wrong, because
what it pointed at moved. It reads the Sammlung now, through
`voiceInForce()` in `src/ui/composer.ts`, which is `voiceFor()`'s rule from
`src/db/repo.ts` applied to what the page has in memory rather than to the
store. The two must not be allowed to disagree: one decides what is said, the
other what is recorded.

### `⋯`, because that is where a per-Sammlung setting can be said without ambiguity

conventions.md §3.10 states the test rather than a list of destinations:

> Does this setting's answer change when a different thing is selected? If it
> does, it is not a setting of the app.

The Sammlung's voice fails that test in Einstellungen and passes it beside the
name, which is §3.6's reason for the menu holding settings as well as acts —
each is answered by *which* Sammlung the menu is beside. Both of those sections
are quoted from the version of `conventions.md` that mitreden does not yet pin;
see [the pin](#the-pin-nothing-here-needs-1160-and-the-rules-here-are-in-it).

### Einstellungen keeps what the installation owns

The Azure key, and `settings.voice` — which is now labelled as what it is,
*Standardstimme*. It survives §3.10's test twice over. Its answer does not
change with the selection, because it is not read off a selection. And it is not
only a deferred default: an uncollected sentence records in it *now*, and
uncollected is a state `composer.ts` creates on purpose when two Sammlungen are
open. That second half is why mitreden keeps a voice control in Einstellungen at
all where vorlaut's amendment 3 removed the equivalent — see below.

## The question worth answering: one button, two doors

`#voicepick` is one button and it now leads to two different places. Inside a
Sammlung it opens that Sammlung's sheet; with none open or with two, it opens
Einstellungen at the default. **This is honest, and it is honest for one reason
that has to hold or it stops being true: the line beside it says which.**

A control whose destination moves is a trap when the control stands alone. A
toolbar button that opens something different depending on state gives the
reader no way to know before pressing, and the only way to learn the rule is to
be surprised by it. That is not this button. It is the verb of a sentence whose
subject is spelled out one word to its left — *Stimme der Sammlung: Kerstin*
against *Standardstimme: Thorsten* — and its accessible name says the same
thing, because „Ändern" alone is a bare verb and a screen reader would otherwise
get the destination last.

So the rule is one rule, not two behaviours: **the button leads to where the
voice the line just named is changed.**

The alternatives were weighed and are worse:

- **Always Einstellungen** is what it did before this branch. It is the defect:
  a way through from a name to a picker that does not govern that name.
- **Always the Sammlung's sheet** cannot answer the uncollected case, which is
  not an edge — two open Sammlungen is a thing the sidebar is built to allow
  (§4.2), and a sentence typed there is in none by design.
- **Two buttons** puts a permanent second control in a caption for a question of
  which only one half is ever live, and the caption is already the element that
  gives way when a voice has a long name (`e2e/app.spec.ts` measures it).
- **Disabling it outside a Sammlung** would be a lie in the other direction: the
  uncollected case has a voice, records fine, and must not read as broken for
  having no Sammlung.

## Where this follows vorlaut, and where it does not

### Followed

- **The panel was split, not moved.** vorlaut's amendment 2 is the argument, and
  it holds: the Sammlung's sheet answers *which voice this one speaks in*, and
  the installation keeps *which voices this machine has*. Putting a 63 MB
  download inside a per-Sammlung sheet would be the same scope error reversed.
- **Live apply, no Save and no Cancel.** A voice destroys nothing. Every clip
  stays exactly where it is and goes on playing.
- **The `⋯` is the mechanism**, with the acts first, the settings under them and
  the delete last.

### Different, and why

- **mitreden's split has nothing to leave behind on the machine side.** vorlaut
  cut `voiceOffer` — the offer to fetch the offline voices, progress bar and all
  — out of its voice panel and kept it in Einstellungen under a heading that
  says so. mitreden has no such offer to keep: it fetches a model on the first
  recording that needs it, reporting through `setProgress` on the page's own
  status line. So what stays in Einstellungen is the Azure key and the default,
  and there is no third thing.
- **The default stayed, where vorlaut's amendment 3 refused one.** vorlaut
  argues a deferred, invisible default is the shape of the bug `920ae21`
  removed, and asks the question at creation instead. mitreden's default is not
  only deferred: it is the standing answer for a sentence in no Sammlung and for
  a Sammlung that never got one — `voiceFor()` reads it on every pass. A setting
  that is doing work today is not an invisible one, and removing it would leave
  those two cases with no answer anybody can see or change.
- **The sheet is not a column of folded panels.** §3.5 governs the settings
  sheet, and vorlaut's per-Sammlung sheet is built to it because a talker
  Sammlung has two things to set. mitreden's Sammlung holds one. A column of one
  folded panel is a heading you have to open to reach the only thing behind it,
  which is the arrangement §3.5 exists to prevent rather than an instance of it.
  So the sheet is the panel: the lead says whose voice, the list is open, the
  cost sits under it. If a Sammlung ever holds a second setting this becomes a
  column and §3.5 applies unchanged.
- **The cost sentence names a button rather than a release.** vorlaut says
  "spoken again on the next release", which is true because vorlaut has a
  release step that rebuilds everything. mitreden records as sentences arrive
  and has no such step, so the sentence names *Sammlung neu aufnehmen* in the
  same menu — and that button had to exist for the sentence to be true. See
  below.

## Two things that had to come with it

### A stale recording had no way back

`openMenu` in `src/ui/list.ts` offered *Jetzt aufnehmen* only when the recording
was **missing**. A stale row had a player, two downloads and nothing else, so
the only route back to a matching recording was retyping the sentence.

That was a small gap while the voice was the sentence's own. It is not one when
one press marks forty rows stale at once. §3.10 already assumed the button
existed — "only an explicit *record again* moves what has been made, which is
somebody pressing a button rather than a preference reaching backwards" — so
this is closing the page against a rule it was already being read as following.

There are two now, at the two levels the page already had: the row's `⋯` offers
it whenever the row is not `ok`, and the Sammlung's `⋯` offers it for the whole
of one. Neither forces: `build()` skips anything whose fingerprint still
matches, so pressing it on a Sammlung that is already right costs nothing.

### The words called the default the next *sentence's*

`voice_now` and `voice_label` are gone as keys. Neither could be worded to cover
both scopes, which is the point: the line names one of two answers and has to
say which, so it is written from `drawVoice()` rather than carried by
`data-i18n`. `voice_now_default` says *Neue Sammlungen bekommen …* because that
is what the setting does now.

## What was deliberately not touched

- **`Phrase.voice`.** It is the record of what a clip was actually made with,
  written by `build()` and by nothing else. `db/backup.ts` needs it and the
  fingerprint to travel together or a restored library cannot decide staleness.
  The sheet writes `Collection.voice` and nothing else.
- **The fingerprint comparison.** Changing a Sammlung's voice makes its
  sentences stale entirely through machinery that already existed. Nothing was
  added to make that happen; `saveCollectionVoice` only moves the value it
  reads.
- **The uncollected sentence.** It goes on working, records in the default, and
  nothing on the page implies it is broken for having no Sammlung.

## The pin: nothing here needs 1.16.0, and the rules here are *in* it

mitreden pins `@lautstark/design#v1.15.0`; vorlaut and bildhaft are on
`v1.16.0`. Checked rather than assumed, because a folded panel, a `⋯` menu and
`menu.js` are all things this work leans on.

**No code needs the bump.** The whole of `v1.15.0..v1.16.0` in shipped code is
`docs/lib/collections.js` gaining an optional `subtitle` second line on a
Sammlung row, and the `docs/components.css` rules that draw it
(`.collections__text`, `.collections__sub`, and a `:has()` baseline rule for the
count). `menu.js`, `dialog.js`, `.sheet`, `.panel` and `.voices` are untouched
between the two tags. mitreden passes no `subtitle` and this branch does not
start.

**But the two rules this branch is built on shipped in it.** §3.10 — *a setting
whose answer changes with the selection is not the app's* — and §3.6's amendment
— *the menu holds a Sammlung's settings as well as the acts on it* — are both
`v1.16.0` commits (`5de2cdb`, `84199b9`). `conventions.md` is a published file of
the package, so a reader inside mitreden's `node_modules` is reading the version
that still says §3.6 is a menu of acts alone, and has no §3.10 at all.

That makes the bump a documentation decision rather than a code one, and it is
not taken here. It is worth taking on its own, with its own gates, and the
`subtitle` field would arrive with it — which is a surface question of its own
(a Sammlung's row could carry the voice it records in as its second line) and
should not be decided as a side effect of a pin.

## What `~/Code/design` has to be told

**Nothing.** Unlike `arity-amendment.md`, this branch leaves no line in that
repository wrong. §3.6 and §3.10 were amended on 2026-08-25 with mitreden's
model already in view, and both name mitreden correctly:

- §3.10's first bullet says `settings.voice` is the voice the next *Sammlung* is
  made with, already corrected from *sentence*.
- §3.6's "Diverging: nobody" now holds for mitreden in fact and not only in
  principle: what a Sammlung is set to is in its `⋯`.
- §3.2's argument comes out stronger for the same reason it did in vorlaut.
  mitreden's objection to Einstellungen at the foot of the rail was that a
  settings entry down at the list suggests it changes something about the list.
  Nothing behind that entry answers differently from one Sammlung to the next
  any more, so the objection has nothing left to point at.

The one line that could be added, and is not asked for here, is a note under
§3.6 that a product with exactly one per-Sammlung setting may use the sheet as
the panel rather than a column of one. That is a reading of §3.5 rather than an
exception to it, and it should be written down only if a second product wants
it.
