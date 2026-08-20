# vorlaut

> German for "cheeky, speaking out of turn" — and literally: *Vor-Laut*, "pre-sound"

Type text, get an audio file — always in the same voice, for every device.
`phrases.json` is the source of truth. Changed the voice? One command, and
everything sounds alike again.

```
python3 vorlaut.py ui        # web interface at http://localhost:8770
python3 vorlaut.py backends  # what is usable right now?
python3 vorlaut.py build --all
```

Requirements: `ffmpeg` and Python 3. Nothing else.

The tooling is in English, the spoken content is German — see `phrases.json`
and the voice settings in `config.json`.

## What comes out

| Folder | Format | for |
|---|---|---|
| `out/anybook/` | 44.1 kHz mono WAV | straight into Anybook Studio |
| `out/esp32/` | 16 kHz mono 16 bit WAV | onto LittleFS, for I2S/MAX98357A |
| `out/preview/` | 44.1 kHz | for the web interface only |

Every file is silence-trimmed and normalised to −16 LUFS. Without that one
phrase is barely audible and the next one shouts — in daily use the most
common reason a device like this ends up back in the drawer.

## Choosing a backend (`config.json`)

**`espeak`** / **`say`** — already there (Linux and macOS respectively), no
setup. Sounds robotic, but it is the fastest way to check that the chain works.

**`piper`** — local, offline, free, open source. German models are available
ready-made. Will still run the same way in ten years, without an account and
without a subscription. Limitation: it has no real child's voice.

**`azure`** — neural voices via the cloud, including German girls' voices.
Sounds considerably more alive. Requires an account, costs per character, and
Microsoft decides how long the voice stays available.

**`elevenlabs`** — can **clone a real child's voice**. A few minutes of
recording become a voice that can speak arbitrary sentences. The best quality
by far. In exchange: subscription, cloud, and the consent of the child whose
voice you are cloning, plus their parents.

## The catch you should know about

The children's voices in MetaTalk **cannot** be exported. The in-app purchase
covers the app, not you. So it only becomes fully identical if you license the
same voice from the same provider a second time.

More realistically: you pick **one** voice here that speaks everything outside
the talker — Anybook, buttons, call button. The talker and the voice next to it
will then differ, but everything else is consistent, and that is what matters
day to day.

And a thought about durability: in a few years this voice will be *her* voice —
for daycare, for relatives, for herself. A cloud service can disappear, a local
file cannot. If you go with Azure or ElevenLabs, back up the generated WAVs as
well; they are then the only thing left of that voice.

## Repo

`phrases.json` and `config.json` belong in the repo — together they define
every generated file. `out/` and `build/` are ignored, because they can be
regenerated from those two at any time.

```
git clone <your-repo> && cd vorlaut
cp phrases.example.json phrases.json
python3 vorlaut.py backends
python3 vorlaut.py ui
```

## Next step, if you feel like it

`out/esp32/` can be packed straight into an ESP32 firmware image — then the
call button and the sequencer speak in the same voice as the Anybook.
