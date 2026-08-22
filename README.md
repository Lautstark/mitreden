# mitreden

[Deutsch](README.de.md) · **English**

Type a sentence, get an audio file back — and they all sound alike.

I am building this for my three-and-a-half-year-old daughter, who uses
augmentative communication.

*mitreden* is German for joining in a conversation.

## What it is for

People who use augmentative communication often speak through more than one
device: a talker app on a tablet, a reading pen, single buttons. Each brings
its own voice along. The same sentence then sounds like a different person
depending on the device — and someone who is only just learning that these
devices are their own voice notices immediately.

mitreden turns that around: the voice is chosen once, the sentences live in
one place, and every device gets the same audio file. Change the voice later
and one command makes everything match again.

It is not a talker and does not replace one. It is the workshop behind it:
text in, audio files out, in the format your device understands.

## How it works

The sentences are the source of truth — a list, kept in the browser. The audio
is the result, one file per sentence, made on the spot and downloaded when you
want it.

Because the audio can be made again at any time, the sentences are the only
thing that really needs a backup. They come out as `phrases.json`, a plain
list you can read.

The repository is deliberately small: a page, the recording chain it runs, and
the words it says in two languages. No framework, no build step for the
interface, and no dependency it fetches while you are using it. The code is in English, the interface speaks
German and English, and this guide exists in both languages. Commit messages
are English too — the history is a developer document, and the sibling
projects settled on the same rule.

## What you need

A browser. Nothing else.

**[Open mitreden](https://lautstark.github.io/mitreden/app/)** and start
typing. There is no account, no key, no installation, and nothing to keep
running. The voice is downloaded once — about 60 MB the first time, then it
stays on your machine — and after that every recording happens in the tab.
Nothing you type is ever sent anywhere.

## Getting started

Type sentences into the box, one per line, and press "Add sentence". Each one
is spoken and appears in the list below with a player. Tick the ones you want
and download them as MP3 or WAV, then copy them onto the talker, the reading
pen or wherever they need to go.

The sentences stay in the browser you typed them in. That is the one thing
worth a copy: **Settings → Save sentences to a file**. Clearing the browser's
data takes them with it, and unlike the audio they cannot be made again.

For more voices, see [Choosing a voice](#choosing-a-voice).

## German or English

The language picker sits at the top right. On your first visit mitreden
follows your browser — German for a German one (de, de-AT, de-CH), English for
everyone else — after that whatever you chose last; the choice is also in the
address (`?lang=en`), so a link carries it along.

The language of the interface and the language of the voices have nothing to
do with each other: both versions offer the same voices, German and English
alike.

The texts live in `lang/de.json` and `lang/en.json`, with English keys.
Another language is another file — it shows up in the picker without a code
change. A missing key falls back to English, and if it is missing there too,
the key itself appears: a gap should be visible, not blank.

## What comes out

One file per sentence, named after its id. The id stays out of the
list — it is a file name, not something to read. It appears in one place, when
you change a text, because that is where it matters: the file name stays as it
is, and what is already on a device keeps working. It is built from the first
words of the sentence and stops at a word boundary, so a long sentence does
not become a long file name. Two sentences with the same beginning get a
number appended. Existing ids stay as they are — they may already be written
on a device.

Recordings are MP3 at 44.1 kHz mono, which just about every device and app
understands. WAV comes out of the same menu when a device insists on it —
converted on the way out, from audio that was already trimmed and levelled, so
the two sound the same.

Every file is silence-trimmed and normalised to −16 LUFS. Without that one
sentence is barely audible and the next one shouts.

## Choosing a voice

The voice sits next to "Add sentence". It decides what recordings are made
with: every new sentence gets it, existing ones keep theirs until you tick
them and pick "Change voice". One voice for everything stays the normal case —
"Select all", record once, done. But when a sentence belongs to someone else,
or is in another language, it may sound different.

Every row says which voice it was recorded in. A voice is called
`Kerstin · piper · de`: name, where it comes from, which language it speaks.
The language is there because that is the reason two voices in the same list
really differ — in a household with two languages, say.

To move sentences already recorded, tick them and choose "Change voice" from
the actions menu. "Select all" first makes every sentence match.

Cloud voices — Azure, ElevenLabs — are deliberately not offered. A key typed
into a public web page is a different promise from the one this makes, and it
is not one worth making for a handful of extra voices: the four here are free,
offline after the first download, and cannot be switched off by a company
changing its mind.

**piper** is what speaks, compiled to WebAssembly and running in the tab. The
models come from the piper project's own publication on Hugging Face, fetched
once and then kept on your machine. It will still work in ten years, without
an account and without a subscription, because nothing about it depends on a
service staying up.

## Collections, search, download

Past a few dozen sentences you want some order. mitreden uses **collections,
not folders** — one sentence can be in several at once.

That is not a detail of the interface, it is the point. A collection does not
own its sentences; it points at them. If it owned them, a sentence you use at
nursery *and* at home would be two sentences, and two sentences are two
recordings that can drift into two different voices. One text stays one
sentence and one audio file, however many collections it belongs to.


```json
{ "id": "i-need-help", "text": "I need help.",
  "collections": ["nursery", "home", "emergency"] }
```

Above the list are two rows to click: **Collections** and **Voices**, plus a
search box. The voices row also holds "Not recorded", in case something is missing.
Several can be picked at once, and the rows work together: collection "play"
and voice "Kerstin" shows what is both.

How to tell filters from actions: **filters are pills, actions are boxes.**
The pills only change what you see. The buttons in the separate box below do
something — and they only appear once you have ticked some sentences. What
collections a new sentence joins is decided solely by its own field at the top.

Several collections can be picked at once and combine with OR; the free text
narrows it further. The search runs in the browser, without waiting, over text
*and* collection names, and is forgiving about umlauts: `hor auf`, `hoer auf` and
`Hör auf` all find the same sentence.

The row shows the twelve most used collections and folds the rest behind
"+ n more". Everything else about a sentence sits in the ⋮ at the right edge
of its row.

**One text, one file.** Add a sentence that already exists and no second entry
appears — the existing one just picks up the new collection. Capitalisation and
extra spaces do not matter, punctuation does: "Again!" and "Again." are spoken
differently, so they are two sentences.

Loading a file works the same way: sentences that are already there are
merged rather than duplicated, and you are told how many were.

**Selecting.** Recording happens by itself — when you add a sentence and after
you change its text. The checkboxes in front of the rows are for the two
things that concern several sentences: downloading and **switching to another
voice**. Both buttons appear as soon as something is ticked: "Download as MP3"
directly, everything rarer behind the chevron next to it — as WAV, change
voice, add to a collection, remove from one, delete. It is the same menu the ⋮ of a
row shows for a single sentence.

For several sentences there is **adding and removing, but no replacing**.
Ticked sentences usually sit in different collections, and a filter may hide
some — replacing would silently throw away something you cannot see. In a
single row "Change collections" still replaces, because there the existing ones
are in the field.

Should a recording fail, the "Not recorded" pill in the voices row says so.
Click it, select, set a voice — and they are there. A filter leaves the
selection untouched and tells you when something selected is currently out of
sight. A single sentence can also be recorded again from the ⋮.

**Downloading.** The button packs up the ticked sentences — as MP3 directly,
as WAV through the chevron next to it. The format is independent of how the
files were recorded; that is for the one device that does not fit in. The
conversion happens on the way out — what is stored stays as it is.

A single file comes out of the ⋮ of its row, in the same formats.

## Your content stays local

Nothing you type leaves your machine. There is no server to send it to: the
sentences live in the browser's own storage, the voice is downloaded once and
then works offline, and the audio is made in the tab. The only request that
ever goes out is the one that fetches a voice model, from the piper project's
publication on Hugging Face.

That has one consequence worth taking seriously. **The sentences are in that
browser and nowhere else.** Clearing its site data deletes them, as does a
browser that decides to reclaim storage. The audio can always be made again;
the sentences cannot.

So: **Settings → Save sentences to a file**, and keep it somewhere real. What
comes out is a plain JSON file you can read, and loading it back merges rather
than overwrites, so a backup can never cost you work that came after it.

## From source

The whole program is four files: `ui.html` is the interface, `docs/audio.js`
is the recording chain, `docs/backend-local.js` answers what the page asks,
and `lang/*.json` is every word it says. `tools/build-site.py` puts the first
and the last together into the page that gets published.

```
git clone https://github.com/Lautstark/mitreden.git
cd mitreden
python3 tools/build-site.py        # rebuild docs/index.html from ui.html
python3 -m http.server -d docs 8771
```

Open <http://localhost:8771>. Python is only there to serve files and run the
build; nothing in the program itself needs it.

```
python3 tests/run.py               # everything
python3 tools/vendor.py --check    # the vendored code is what was pinned
```

The third-party code in `docs/vendor/` is fetched by `tools/vendor.py` and
pinned by hash in `tools/vendor.lock.json`. It is committed rather than
fetched at runtime, because a page that pulls executing code from a CDN can
have it changed underneath it — and because GitHub Pages serves `docs/`
straight from the branch, with no build step that could fetch anything.

## Contributing

This is a hobby project, grown out of a concrete need at home — there is no
roadmap and no promises. If you use it for your own child, or for someone you
support: good. Bug reports and questions are welcome, even if answers may take
a while.

If you change something: `python3 tests/run.py` runs the tests. No pip
packages, a few seconds, and the same run happens in CI on every push. A
single one is `python3 tests/run.py voice`. What each is for is written at the
top of its own file.

If you are building something similar and could use advice, open an issue.
There is little tooling for augmentative communication that you can hold in
your own hands, and the experience of it travels badly by other routes.

## Related

[bildhaft](https://github.com/SteffiPeTaffy/bildhaft) is a companion project:
type a German sentence, get a row of AAC pictograms back, correct them, print
them. It runs entirely in the browser too. The two are the same sentence seen
twice — bildhaft gives it symbols, mitreden gives it a voice — and mitreden's
importer reads bildhaft's collection files, so a picture book translated over
there does not have to be typed again over here.

They share a mark: the same speech bubble, drawn from the same path, in a
different colour. And a principle. bildhaft stores symbol references rather
than pictures; mitreden stores sentences rather than audio. Either way the
exported file still works for the person who receives it, whichever symbols or
voices they happen to have.

## Licence

MIT — see [LICENSE](LICENSE). Do what you like with it.
