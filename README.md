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
Code ist auf Englisch, alles zum Lesen und Hören auf Deutsch — Oberfläche,
README, Sätze. Nur was das Terminal ausgibt, ist englisch geblieben.

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
„Satz hinzufügen“ drücken, fertig. Die Audiodateien landen in `out/`.

Ohne Oberfläche geht es genauso:

```
python3 mitreden.py add "Ich brauche Hilfe." --tags kindergarten,notfall
python3 mitreden.py build        # nur Neues/Geändertes rendern
python3 mitreden.py build --all  # alles neu, nach einem Stimmwechsel
python3 mitreden.py delete ich-brauche-hilfe
```

## Gruppen, Suche, Download

Ab ein paar Dutzend Sätzen willst du Ordnung. mitreden nimmt dafür **Gruppen,
keine Ordner** — und das ist Absicht: „Ich brauche Hilfe." gehört in den
Kindergarten *und* nach Hause *und* zu den Notfällen. In einem Ordnerbaum
müsstest du dich entscheiden oder den Satz doppelt anlegen.

Eine Gruppe ist einfach ein Etikett am Satz:

```json
{ "id": "ich-brauche-hilfe", "text": "Ich brauche Hilfe.",
  "tags": ["kindergarten", "zuhause", "notfall"] }
```

In der Oberfläche steht über der Liste eine Reihe Gruppen zum Anklicken, daneben
ein Suchfeld. Die Suche läuft im Browser, ohne Warten, über Text *und*
Gruppennamen — und sie ist tolerant, was Umlaute angeht: `hor auf`,
`hoer auf` und `Hör auf` finden alle denselben Satz.

**Mehrere Gruppen gleichzeitig** lassen sich anklicken, und sie verknüpfen mit
ODER: Grüffelo *und* Olchis ausgewählt heißt „zeig mir die Sätze aus beiden
Büchern“. Der Freitext schränkt das zusätzlich ein. So kommst du auch mit einer
Gruppe pro Bilderbuch zurecht, ohne dass die Liste unbrauchbar wird.

Damit die Gruppenleiste nicht ausufert, zeigt sie die zwölf meistgenutzten
Gruppen — im Alltag also `zuhause`, `kindergarten`, `spiel` — und dahinter
„+ n weitere“ für den Rest. Was du ausgewählt hast, bleibt immer sichtbar, auch
wenn es sonst eingeklappt wäre. Und wenn du den Namen kennst, ist das Suchfeld
sowieso schneller: es findet Gruppennamen mit.

Solange eine Gruppe ausgewählt ist, landen neu angelegte Sätze automatisch in
ihr. Alles Weitere zu einem einzelnen Satz steckt im ⋮ am rechten Rand seiner
Zeile: dort änderst du seine Gruppen und dort löschst du ihn.

**Ein Text, eine Datei.** Legst du einen Satz an, den es schon gibt, entsteht
kein zweiter Eintrag — der vorhandene bekommt nur die neue Gruppe dazu. Egal in
wie vielen Gruppen ein Satz steckt, in `out/` liegt er genau einmal. Groß- und
Kleinschreibung und zusätzliche Leerzeichen sind dabei egal, Satzzeichen nicht:
„Nochmal!" und „Nochmal." klingen verschieden, also sind es zwei Sätze.

Für Bestände, die vor den Gruppen entstanden sind:

```
python3 mitreden.py dedupe           # zeigt, was zusammengeführt würde
python3 mitreden.py dedupe --apply   # führt es wirklich zusammen
```

Ohne `--apply` wird nichts angefasst. Der Befehl löscht Einträge und
Audiodateien, und deine `phrases.json` ist das Einzige an diesem Projekt, von
dem es keine zweite Kopie gibt — deshalb erst zeigen, dann machen.

**Rausholen, was du gerade siehst.** Der Knopf „Herunterladen“ packt genau die Sätze
zusammen, die die Liste gerade zeigt — nach einer Suche also die Treffer, in
einer Gruppe deren Sätze. Im ZIP liegt ein Ordner pro Geräteformat (`anybook/`
und `esp32/`), du musst dich also vorher für nichts entscheiden: du nimmst den
Ordner, der zum Gerät passt, vor dem du gerade sitzt.

Auf der Kommandozeile geht dasselbe gezielter:

```
python3 mitreden.py export kindergarten ~/Desktop/kiga
python3 mitreden.py export all ~/Desktop/alles --format esp32
```

`out/` bleibt dabei immer flach und ohne Dubletten; die exportierte Kopie ist
der Teil zum Wegwerfen, den du in Anybook Studio ziehst oder auf LittleFS legst.

**Wenn es viele werden.** Die Liste zeichnet höchstens 200 Sätze und bietet den
Rest per Knopfdruck an — Suche und Gruppen sind der eigentliche Weg durch einen
großen Bestand, nicht das Scrollen. Zähler und Download beziehen sich immer auf
alle Treffer, nicht nur auf das Sichtbare.

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

`rate` und `pitch` gelten für die erzeugten Dateien und wirken erst nach einem
`build --all`. Das Tempo, mit dem der Browser beim Vorhören abspielt, hat damit
nichts zu tun — deshalb bietet die Oberfläche es gar nicht erst an.

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

`out/` ist flach — keine Unterordner pro Gruppe, jeder Text genau einmal.
Was zu einer Gruppe gehört, sagt `phrases.json`; zum Übertragen holst du dir
eine Kopie mit `export` oder dem Download-Knopf.

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
