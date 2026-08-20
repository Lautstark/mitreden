# mitreden

> mitreden können — mit derselben Stimme, auf jedem Gerät

Ich baue das für meine dreieinhalbjährige Tochter, die unterstützt
kommuniziert. Wer über mehrere Geräte spricht, bekommt von jedem eine andere
Stimme geliehen — derselbe Satz klingt dann wie eine andere Person. Wer
gerade erst lernt, dass diese Geräte die eigene Stimme sind, merkt das sofort.

mitreden löst genau das: Text eintippen, Audiodatei rausbekommen — in immer
derselben Stimme, im passenden Format für jedes Gerät. `phrases.json` ist die
Quelle der Wahrheit. Stimme gewechselt? Ein Befehl, und alles klingt wieder
gleich.

```
python3 mitreden.py ui        # Weboberfläche auf http://localhost:8770
python3 mitreden.py backends  # was ist gerade nutzbar?
python3 mitreden.py build --all
```

Wenn du etwas Ähnliches für dein Kind bauen willst: Das Repo ist absichtlich
klein und ohne Abhängigkeiten. Eine Datei Python, ein bisschen ffmpeg. Der
Code und die Oberfläche sind auf Englisch, gesprochen wird Deutsch.

## Was du brauchst

**Zwingend:** Python 3 und `ffmpeg`. Sonst nichts — keine pip-Pakete, kein
Framework, kein Docker.

```
brew install ffmpeg          # macOS
sudo apt install ffmpeg      # Debian/Ubuntu
```

**Dazu eine Stimme.** `say` (macOS) und `espeak` (Linux) sind schon da und
kosten nichts, klingen aber roboterhaft — gut genug, um zu prüfen, ob die Kette
läuft. Für den echten Einsatz willst du `piper` (lokal) oder `azure` (Cloud);
siehe [Die Stimme wählen](#die-stimme-wählen).

**Optional, je nach Zielgerät:**

- **Anybook Reader** — ein Hörstift, der Audiodateien über Aufkleber abspielt.
  Die Dateien kommen mit „Anybook Studio“ auf den Stift.
- **ESP32 mit MAX98357A** — für selbstgebaute Taster und Rufknöpfe. Die Dateien
  aus `out/esp32/` passen direkt auf LittleFS.

Du brauchst keines von beiden, um mitreden auszuprobieren. Die Weboberfläche
spielt alles auch direkt im Browser ab.

## Loslegen

```
git clone https://github.com/SteffiPeTaffy/mitreden.git
cd mitreden
cp phrases.example.json phrases.json
python3 mitreden.py backends   # zeigt, was auf deinem Rechner nutzbar ist
```

**Beim ersten Start wichtig:** In `config.json` steht `"backend": "azure"` —
das ist unsere Einstellung, und ohne Schlüssel scheitert damit jeder Satz. Wenn
du noch keinen hast, stell zuerst auf eine Stimme um, die auf deinem Rechner
schon da ist (`say` auf macOS, `espeak` auf Linux):

```
python3 mitreden.py backends   # welche steht bei dir auf "found"?
```

Dann in `config.json` die erste Zeile auf `"backend": "say"` bzw.
`"backend": "espeak"` ändern. Es klingt roboterhaft, aber du siehst sofort, ob
alles läuft. Eine schöne Stimme suchst du dir danach aus — siehe
[Die Stimme wählen](#die-stimme-wählen).

```
python3 mitreden.py ui
```

Dann auf <http://localhost:8770>: Sätze eintippen — eine Zeile pro Satz —,
„Add phrase“ drücken, fertig. Die Audiodateien landen in `out/`.

Ohne Oberfläche geht es genauso:

```
python3 mitreden.py add "Ich brauche Hilfe."
python3 mitreden.py build        # nur Neues/Geändertes rendern
python3 mitreden.py build --all  # alles neu, nach einem Stimmwechsel
python3 mitreden.py delete ich-brauche-hilfe
```

## Die Stimme wählen

Das Backend steht in `config.json`. Umstellen, dann einmal
`python3 mitreden.py build --all` — danach ist alles in der neuen Stimme.

**`say` / `espeak`** — schon da (macOS bzw. Linux), kein Setup, kein Konto.
Klingt roboterhaft, ist aber der schnellste Weg zu prüfen, ob die Kette läuft.

```json
{ "backend": "say", "say": { "voice": "Anna" } }
```

**`piper`** — lokal, offline, kostenlos, quelloffen. Deutsche Modelle gibt es
[fertig zum Herunterladen](https://github.com/rhasspy/piper). Läuft in zehn
Jahren noch genauso, ohne Konto und ohne Abo. Einschränkung: eine echte
Kinderstimme ist nicht dabei.

```json
{ "backend": "piper",
  "piper": { "binary": "piper", "model": "de_DE-kerstin-low.onnx" } }
```

**`azure`** — neuronale Stimmen über die Cloud, darunter deutsche Mädchen- und
Frauenstimmen wie `de-DE-GiselaNeural`. Klingt deutlich lebendiger als alles
Lokale. So kommst du an einen Schlüssel:

1. Kostenloses Microsoft-Azure-Konto anlegen.
2. Im Portal eine Ressource vom Typ **Speech Service** erstellen, Region z. B.
   `germanywestcentral`.
3. Unter *Keys and Endpoint* einen der beiden Schlüssel kopieren.
4. Als Umgebungsvariable setzen — **nicht** in `config.json` schreiben:

```
export AZURE_SPEECH_KEY="dein-schluessel"
```

Azure hat eine kostenlose Stufe (F0). Für die Menge an Sätzen, um die es hier
geht, zahlst du damit in aller Regel nichts. In `config.json` stehen nur
Stimme und Region:

```json
{ "backend": "azure",
  "azure": { "voice": "de-DE-GiselaNeural", "region": "germanywestcentral",
             "key_env": "AZURE_SPEECH_KEY", "rate": "-5%", "pitch": "0%" } }
```

**`elevenlabs`** — kann eine **echte Kinderstimme klonen**. Aus wenigen Minuten
Aufnahme entsteht eine Stimme, die beliebige Sätze sprechen kann. Qualitativ das
Beste. Dafür: Abo, Cloud, und die Einwilligung des Kindes und seiner Eltern,
dessen Stimme du klonst. Schlüssel wie bei Azure über
`ELEVENLABS_API_KEY`, dazu die `voice_id` in `config.json`.

## Was rauskommt

| Ordner | Format | wofür |
|---|---|---|
| `out/anybook/` | 44,1 kHz mono WAV | rein in Anybook Studio |
| `out/esp32/` | 16 kHz mono 16 bit WAV | auf LittleFS, für I2S/MAX98357A |
| `out/preview/` | 44,1 kHz | nur für die Weboberfläche |

Jede Datei ist stillebereinigt und auf −16 LUFS normalisiert. Ohne das ist ein
Satz kaum hörbar und der nächste brüllt — im Alltag der häufigste Grund, warum
so ein Gerät wieder in der Schublade landet.

## Der Haken, den du kennen solltest

Talker-Apps bringen eigene Kinderstimmen mit, und die lassen sich in aller
Regel **nicht** exportieren — bei MetaTalk zum Beispiel gilt der In-App-Kauf
für die App, nicht für dich. Vollständig identisch wird es also nur, wenn du
dieselbe Stimme beim selben Anbieter noch einmal lizenzierst.

Realistischer: Du wählst hier **eine** Stimme, die alles außerhalb des Talkers
spricht — Hörstift, Taster, Rufknopf. Talker und Stimme daneben unterscheiden
sich dann, aber alles andere ist konsistent, und darauf kommt es im Alltag an.

## Ein Gedanke zur Haltbarkeit

Diese Stimme wird in ein paar Jahren *ihre* Stimme sein — für die Kita, für
Verwandte, für sie selbst. Ein Cloud-Dienst kann verschwinden, eine lokale
Datei nicht. Wenn du dich für Azure oder ElevenLabs entscheidest, sichere die
erzeugten WAVs zusätzlich; sie sind dann das Einzige, was von der Stimme
bleibt.

## Wie das Repo gedacht ist

`config.json` gehört ins Repo, `phrases.json` nicht: Die Sätze sind persönlich,
also bleibt deine `phrases.json` lokal und ist in `.gitignore` eingetragen.
Im Repo liegt nur `phrases.example.json` als Startpunkt.

`out/` und `build/` sind ebenfalls ignoriert, weil sie sich jederzeit aus
`phrases.json` und `config.json` neu erzeugen lassen.

Schlüssel stehen nie in einer Datei, sondern immer in einer Umgebungsvariablen.
In `config.json` steht mit `key_env` nur der *Name* der Variablen — die
Datei kann also gefahrlos öffentlich sein.

**Wenn du deine Sätze versioniert sichern willst:** Nimm ein privates Repo
oder ein Backup außerhalb von git. Sonst sind sie das Einzige an diesem
Projekt, von dem es keine zweite Kopie gibt.

## Nächster Schritt, wenn du magst

`out/esp32/` lässt sich direkt in ein ESP32-Firmware-Image packen — dann sprechen
Rufknopf und Sequenzer mit derselben Stimme wie der Hörstift.

## Lizenz

MIT — siehe [LICENSE](LICENSE). Mach damit, was du willst; wenn es deinem Kind
hilft, umso besser.
