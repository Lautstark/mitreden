# What ~/Code/design has to be told

mitreden's arity changed from many to one, and the voice moved from the sentence
to the Sammlung. Four pieces of writing in **~/Code/design** now describe a
product that no longer exists. None of them is touched here — amending them is
its own session, and it needs these decisions stated correctly rather than
guessed at from the diff.

This file is the hand-off. It says what each piece has to become and why; it is
not itself the amendment.

## `docs/conventions.md` §4.1 — Arity

The heading and the settled line stay. The mitreden bullet is wrong in both
halves: the arity and the reason given for it.

It currently reads:

> **mitreden: many.** A sentence belongs in the morning Sammlung and in the
> nursery one, with one recording behind both. Its sidebar multi-selects for
> exactly this reason (§4.2).

It has to become **one**, and the reason has to be the one that overturned it: a
Sammlung carries the voice its sentences are recorded in, so a sentence in two
Sammlungen has two answers to "which voice records this" and no way to choose
between them. The morning sentence and the nursery one are two sentences now,
each with its own recording, which is correct rather than wasteful — they are
two different sounds, and a Sammlung is handed to a device as a set of files.

The closing paragraph — that arity is a fact about what a product holds, and
that a rule overriding it makes one product's model into the others' decoration
— **stands, and is the argument for this change rather than against it.** What
mitreden holds changed when the voice moved. The paragraph should not be
softened on the way past; if anything it earns a second date beside the first.

The clause "Its sidebar multi-selects for exactly this reason (§4.2)" has to go
entirely. It is the claim §4.2 is wrong about, below.

With all three products now at one, §4.1 no longer settles a per-product
question by naming three different answers. It should say so plainly — the
per-product framing is still right, and it is right *because* it was asked three
times and happened to come out the same way, which is a different thing from a
house rule. The three bullets should stay.

## `docs/conventions.md` §4.2 — Multi-select in the sidebar

It currently reads:

> **Multi-select in the sidebar follows from arity.** mitreden only, where Cmd-
> or Ctrl-click adds a second Sammlung to the open set. Elsewhere a rail that
> toggles would have one reachable state.

The behaviour is unchanged and stays. The **derivation is wrong** and has to be
removed: multi-select is about how many Sammlungen may be *open at once*, which
is independent of how many a sentence may be *in*. mitreden opens the morning
Sammlung and the nursery one together and shows the union of the two; that was
useful when a sentence could be in both and it is useful now that it cannot.

So §4.2 keeps its content and loses its dependency. The heading becomes
something like "Multi-select in the sidebar", and the reason becomes mitreden's
own: sentences are worked on across several Sammlungen at a sitting, and the
union is the view that supports it. The second sentence — elsewhere a rail that
toggles would have one reachable state — is still true and still the reason the
other two products ignore the additive flag.

This matters beyond the wording. §4.2 read as a consequence of §4.1, so anybody
amending §4.1 would have taken multi-select down with it. It is the one part of
the old model that survives untouched.

## `docs/lib/collections.d.ts` — two API comments

Neither line describes anything that changed in the package. Both cite the wrong
section, and one of them for the reason above.

**Line 18–19**, on `CollectionRowsOpts.open`:

> A set rather than one id because arity is per product (conventions.md §4.1):
> one in vorlaut and bildhaft, several in mitreden.

`open` is the *open set*, not a membership. It is a set because several
Sammlungen can be open at once in mitreden — §4.2 — and the citation has to
move there. The "one in vorlaut and bildhaft, several in mitreden" clause stays
true as written (it is about how many are open), but naming §4.1 for it is what
made the confusion durable, and with all three products at arity one the
sentence now reads as though it were saying the opposite of what it means.
Rewrite it to name what it is counting: open Sammlungen.

**Line 22–25**, on `onPick`'s `additive`:

> `additive` is true when the press carried Cmd or Ctrl — the "and also this
> one" chord §4.2 settles, decided here so that it cannot drift to a different
> key in one product. A product whose arity is one ignores it.

The first half is right and unchanged. The last sentence is wrong twice over:
arity no longer separates the products, and it was never what decided this.
It should say that a product which opens one Sammlung at a time ignores the
flag — which is vorlaut and bildhaft, for the reason §4.2 gives.

## What is *not* being asked for

- No change to §4.3 (what deleting takes with it). mitreden still drops the
  membership and keeps the sentences; the membership is one field instead of an
  entry in an array, and §4.3 does not say which.
- No change to the `collections` package itself. `drawCollections`, its row
  shape and the additive chord are all unaffected — mitreden is still the one
  product that passes more than one id in `open`.
- No new section for the voice. Where a Sammlung's voice lives is mitreden's
  model, not a shared convention: bildhaft has no voices and vorlaut has no
  sound. If it ever earns a §4.x it will be because a second product grows one.
