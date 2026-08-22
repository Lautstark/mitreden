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

`phrases.json` is the source of truth — a list of sentences. `out/` is the
result, one audio file per sentence. Everything in between happens in the web
interface: type the sentences, and the audio files appear.

Because `out/` can be recreated at any time, `phrases.json` is the only thing
that really needs a backup.

The repository is deliberately small: a Python file and the page it serves, no
dependencies, a bit of ffmpeg. The code is in English, the interface speaks
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

### From the command line

It works the same without the interface:

```
python3 mitreden.py add "I need help." --collections emergency
python3 mitreden.py edit look "Look!"
python3 mitreden.py build        # only new or changed ones
python3 mitreden.py build --all  # everything again, after a voice change
python3 mitreden.py delete i-need-help
```

This is the same pipeline the browser runs, with real ffmpeg and a real
piper instead of their WebAssembly builds. It is useful for scripting a large
set, and it is the reference the browser build is measured against — see
[From source](#from-source).

**Typo?** The ⋮ at the right edge of a row changes the text without creating
the sentence again. It is recorded again right away. The id, and with it the
file name, stays as it is — the file may long since be sitting on a talker or
a reading pen, and a forgotten question mark should not rename it there. For a
genuinely different sentence, a new entry is the right way.

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

One file per sentence in `out/`, named after its id. The id stays out of the
list — it is a file name, not something to read. It appears in one place, when
you change a text, because that is where it matters: the file name stays as it
is, and what is already on a device keeps working. It is built from the first
words of the sentence and stops at a word boundary, so a long sentence does
not become a long file name. Two sentences with the same beginning get a
number appended. Existing ids stay as they are — they may already be written
on a device.

The default is MP3 at 44.1 kHz mono, which just about every device and app
understands. The format lives in `config.json` and can be anything ffmpeg can
write:

```json
{ "output": { "format": "mp3", "sample_rate": 44100, "channels": 1,
              "bitrate": "192k" } }
```

`"mp3"` saves space and is what most apps and devices expect; a smaller
`sample_rate` helps when the target device is short on storage.

`bitrate` only applies to the space-saving formats (mp3, ogg, m4a, opus) — for
WAV and FLAC it is ignored. 192k sounds clean, 96k halves that and still holds
up for a single voice. Without it ffmpeg picks something itself, and for
speech that is often too little: muffled and tinny.

After a change, run `build` once — mitreden works out for itself what has to
be rendered again, and clears the old files away.

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

```
python3 mitreden.py voices                              # what works here?
python3 mitreden.py voice piper:de_DE-thorsten-medium   # use this from now on
python3 mitreden.py build --all --voice piper:de_DE-thorsten-medium
```

The last command moves every existing sentence over to that voice.

For Azure, `languages` decides which voices are on offer — Azure has 556, and
that is no longer a choice:

```json
{ "azure": { "languages": ["de-DE", "en-US"], … } }
```

An entry with a dash means exactly that locale, one without means every locale
of that language (`"de"` also takes de-AT and de-CH). Without the setting it
stays at the language of the configured voice. For `["de-DE", "en-US"]` that
is 75 voices. The list comes from Azure itself and is cached for a week;
without a network connection the configured voice remains, so the picker is
never empty.

Only what actually works is offered: a cloud voice once its key is set, a
local one once the program behind it exists. A voice you can pick that then
fails while recording would be worse than no choice at all.

A key can also be entered in the interface itself: the gear next to the
language picker opens the settings, and there a key unlocks the voices of that
service. For Azure the region belongs with it — a key is bound to one, and the
wrong pairing fails with a 401. The key is checked while you are still looking
at the field, written to the `.env` next to your sentences with permissions
0600, and never shown again: the interface only ever learns whether one is set.

Which also means: whoever reaches the interface can set a key there. It has no
login. Home network only.

**The website offers four piper voices** — Thorsten and Thorsten (emotional)
in German, Kristin and HFC female in English, all CC0 or public domain. Each
is fetched once, on first use, and then stays on your machine.

The list is short on purpose, and it is a tested list rather than piper's
catalogue. Every `low` and `x_low` model fails in the browser, because the
phonemizer works from a fixed symbol table instead of the one inside each
model — which is why Kerstin is missing, and she is published as `low` only.
A voice you can pick that then fails would be worse than no choice at all.

If you add another piper voice for the command line, look at its `MODEL_CARD`
first: quite a few of the better-known English voices are under
non-commercial or unclear licences and cannot be passed on. Your own models are added by
dropping an `.onnx` together with its `.onnx.json` into a `voices/` folder
next to your sentences. If your models live somewhere else, `MITREDEN_VOICES`
says where — in the image it points at `/voices`.

By hand it still works through `config.json`, followed by
`python3 mitreden.py build --all`.

**`say` / `espeak`** — already there, no setup, no account. Robotic, but the
fastest way to check that everything runs.

```json
{ "backend": "say", "say": { "voice": "Anna" } }
```

**`piper`** — local, offline, free, open source. The models are
[ready to download](https://huggingface.co/rhasspy/piper-voices) from the
piper project itself. It will still run the same way in ten years, without an
account and without a subscription.

**`azure`** — neural voices over the cloud, noticeably more alive than
anything local. The free tier (F0) is usually enough for these amounts.
`rate` and `pitch` apply to the generated files and take effect after a
`build --all`.

```json
{ "backend": "azure",
  "azure": { "voice": "de-DE-GiselaNeural", "region": "germanywestcentral",
             "key_env": "AZURE_SPEECH_KEY", "rate": "-5%", "pitch": "0%" } }
```

**`elevenlabs`** — can clone a real voice. The best quality, but subscription
and cloud — and the consent of the person whose voice you are cloning.

Keys **never** go into a file in the repository, they go into an environment
variable. `config.json` only holds the *name*, in `key_env`:

```
export AZURE_SPEECH_KEY="your-key"
```

More permanently through a `.env` next to `mitreden.py`, which is read at
startup and is listed in `.gitignore`:

```
AZURE_SPEECH_KEY=your-key
```

If you settle on a cloud voice, back up the generated files as well. A service
can disappear, a local file cannot.

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

```
python3 mitreden.py dedupe           # shows what would be merged
python3 mitreden.py dedupe --apply   # actually merges it
```

Without `--apply` nothing is touched.

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
conversion happens for the download only, `out/` stays as it is.

A single file comes out of the ⋮ of its row, in the same formats.

On the command line:

```
python3 mitreden.py export nursery ~/Desktop/nursery
python3 mitreden.py export all ~/Desktop/everything
```

## Running it yourself

The website is the whole product and needs nothing running. But everything it
does, the command line does too — with real ffmpeg and a real piper rather
than their WebAssembly builds, which is useful for a large set and is how the
browser build is checked.

```
git clone https://github.com/Lautstark/mitreden.git
cd mitreden
python3 mitreden.py add "I need help." --collections emergency
python3 mitreden.py build
```

Python 3 and `ffmpeg`, and nothing after that: no pip packages, no framework.

```
brew install ffmpeg          # macOS
sudo apt install ffmpeg      # Debian/Ubuntu
```

Plus a voice. `say` (macOS) and `espeak` (Linux) are already there and cost
nothing, but they sound robotic — good enough to check the chain works. For
the voices the website uses, install piper and drop a model beside your
sentences; see [Choosing a voice](#choosing-a-voice).

`python3 mitreden.py ui` also serves the interface locally, which is the same
page the website serves. It listens on `localhost` only, and it has no login:
if you send it onto your network with `--host 0.0.0.0`, anyone who reaches
the port can add, delete and record. On your own network that is fine; on the
open internet it is not.

## Your content stays local

The repository only holds `phrases.example.json` as a starting point. Your own
`phrases.json`, everything made from it and your keys are in `.gitignore` and
never travel along:

```
phrases.json        your sentences
phrases.json.*      backups of it
out/  build/        everything made from them
*.wav *.mp3 *.aiff  audio, wherever it turns up
.env  .env.*        keys
```

For `phrases.json` a private repository or a backup outside git is the way to
go — it is, as said above, the only thing that cannot be recreated.

## From source

For working on mitreden. To just use it,
[the website](https://lautstark.github.io/mitreden/app/) needs nothing at all.

You need Python 3 and ffmpeg, and a voice: `say` on macOS and `espeak` on
Linux are already there, but they sound robotic. For a good local voice,
install [piper](https://github.com/OHF-Voice/piper1-gpl) and put a model into
`voices/`.

```
pip install piper-tts==1.7.0
```

The version matters and is pinned on purpose. piper is what turns text into
sound, so a release that changes how a voice speaks would leave older
recordings sitting under fingerprints claiming to match new ones — one set of
sentences, two voices. `PIPER_VERSION` in `mitreden.py` names the same
version, `tests/test_fingerprint.py` checks the two agree, and bumping them
together re-records everything piper made.

```
git clone https://github.com/Lautstark/mitreden.git
cd mitreden
cp phrases.example.json phrases.json
python3 mitreden.py backends   # which backend says "found" on your machine?
```

That command already writes a `config.json` and picks a backend that works
here, so there is nothing to fill in. Change it only if you want a different
voice. Then:

```
python3 mitreden.py ui
```

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
