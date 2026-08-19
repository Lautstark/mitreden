# vorlaut

> vorlaut sein — und wörtlich: Vor-Laut

Text eintippen, Audiodatei rausbekommen — in immer derselben Stimme, für alle
Geräte. `phrases.json` ist die Quelle der Wahrheit. Stimme gewechselt?
Ein Befehl, und alles klingt wieder gleich.

```
python3 vorlaut.py ui        # Weboberfläche auf http://localhost:8770
python3 vorlaut.py backends  # was ist gerade nutzbar?
python3 vorlaut.py build --all
```

Voraussetzung: `ffmpeg` und Python 3. Sonst nichts.

## Was rauskommt

| Ordner | Format | wofür |
|---|---|---|
| `out/anybook/` | 44,1 kHz mono WAV | rein in Anybook Studio |
| `out/esp32/` | 16 kHz mono 16 bit WAV | auf LittleFS, für I2S/MAX98357A |
| `out/preview/` | 44,1 kHz | nur für die Weboberfläche |

Jede Datei ist stillebereinigt und auf −16 LUFS normalisiert. Ohne das ist ein
Satz kaum hörbar und der nächste brüllt — im Alltag der häufigste Grund, warum
so ein Gerät wieder in der Schublade landet.

## Backend wählen (`config.json`)

**`espeak`** / **`say`** — schon da (Linux bzw. macOS), kein Setup. Klingt
roboterhaft, ist aber der schnellste Weg zu prüfen, ob die Kette läuft.

**`piper`** — lokal, offline, kostenlos, quelloffen. Deutsche Modelle gibt es
fertig. Läuft in zehn Jahren noch genauso, ohne Konto und ohne Abo.
Einschränkung: eine echte Kinderstimme ist nicht dabei.

**`azure`** — neuronale Stimmen über die Cloud, darunter deutsche
Mädchenstimmen. Klingt deutlich lebendiger. Erfordert ein Konto, kostet pro
Zeichen, und Microsoft entscheidet, wie lange es die Stimme gibt.

**`elevenlabs`** — kann eine **echte Kinderstimme klonen**. Aus wenigen Minuten
Aufnahme entsteht eine Stimme, die beliebige Sätze sprechen kann. Qualitativ das
Beste. Dafür: Abo, Cloud, und die Einwilligung des Kindes und seiner Eltern,
dessen Stimme du klonst.

## Der Haken, den du kennen solltest

Die Kinderstimmen in MetaTalk lassen sich **nicht** exportieren. Der In-App-Kauf
gilt für die App, nicht für dich. Vollständig identisch wird es also nur, wenn
du dieselbe Stimme beim selben Anbieter noch einmal lizenzierst.

Realistischer: Du wählst hier **eine** Stimme, die alles außerhalb des Talkers
spricht — Anybook, Taster, Rufknopf. Talker und Stimme daneben unterscheiden
sich dann, aber alles andere ist konsistent, und darauf kommt es im Alltag an.

Und ein Gedanke zur Haltbarkeit: Diese Stimme wird in ein paar Jahren *ihre*
Stimme sein — für die Kita, für Verwandte, für sie selbst. Ein Cloud-Dienst kann
verschwinden, eine lokale Datei nicht. Wenn du dich für Azure oder ElevenLabs
entscheidest, sichere die erzeugten WAVs zusätzlich; sie sind dann das Einzige,
was von der Stimme bleibt.

## Repo

`phrases.json` und `config.json` gehören ins Repo — zusammen definieren sie
jede erzeugte Datei. `out/` und `build/` sind ignoriert, weil sie sich jederzeit
aus den beiden neu erzeugen lassen.

```
git clone <dein-repo> && cd vorlaut
cp phrases.example.json phrases.json
python3 vorlaut.py backends
python3 vorlaut.py ui
```

## Nächster Schritt, wenn du magst

`out/esp32/` lässt sich direkt in ein ESP32-Firmware-Image packen — dann sprechen
Rufknopf und Sequenzer mit derselben Stimme wie der Anybook.
