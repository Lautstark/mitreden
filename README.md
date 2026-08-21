# mitreden

Ein Satz eingetippt, eine Audiodatei zurück — und alle klingen gleich.

Ich baue das für meine dreieinhalbjährige Tochter, die unterstützt
kommuniziert.

## Wofür das gut ist

Wer unterstützt kommuniziert, spricht oft nicht über ein Gerät, sondern über
mehrere: eine Talker-App auf dem Tablet, einen Hörstift, einzelne Taster.
Jedes bringt von sich aus eine eigene Stimme mit. Derselbe Satz klingt dann je
nach Gerät wie eine andere Person — und wer gerade erst lernt, dass diese
Geräte die eigene Stimme sind, merkt das sofort.

mitreden dreht das um: Die Stimme wird einmal festgelegt, die Sätze stehen an
einer Stelle, und jedes Gerät bekommt dieselbe Audiodatei. Wechselst du später
die Stimme, macht ein Befehl alles wieder einheitlich.

Es ist kein Talker und ersetzt keinen. Es ist die Werkstatt dahinter: Text
rein, Audiodateien raus, im Format, das dein Gerät versteht.

## Wie es funktioniert

`phrases.json` ist die Quelle der Wahrheit — eine Liste von Sätzen. `out/` ist
das Ergebnis, eine Audiodatei pro Satz. Alles dazwischen macht ein Befehl:

```
python3 mitreden.py ui        # Weboberfläche auf http://localhost:8770
python3 mitreden.py build     # rendern, was fehlt
python3 mitreden.py backends  # was ist gerade nutzbar?
```

Weil `out/` sich jederzeit neu erzeugen lässt, ist `phrases.json` das Einzige,
was wirklich Sicherung braucht.

Das Repo ist absichtlich klein: eine Datei Python, keine Abhängigkeiten, ein
bisschen ffmpeg. Der Code ist auf Englisch, Oberfläche und Doku auf Deutsch —
die Sätze, die hier entstehen, sind es schließlich auch. Nur was das Terminal
ausgibt, ist englisch geblieben.

## Was du brauchst

Python 3 und `ffmpeg`. Sonst nichts — keine pip-Pakete, kein Framework.

```
brew install ffmpeg          # macOS
sudo apt install ffmpeg      # Debian/Ubuntu
```

Dazu eine Stimme. `say` (macOS) und `espeak` (Linux) sind schon da und kosten
nichts, klingen aber roboterhaft — gut genug, um zu prüfen, ob die Kette läuft.
Für den echten Einsatz siehe [Die Stimme wählen](#die-stimme-wählen).

## Loslegen

```
git clone https://github.com/SteffiPeTaffy/mitreden.git
cd mitreden
cp phrases.example.json phrases.json
python3 mitreden.py backends   # welches Backend steht bei dir auf "found"?
```

In `config.json` das passende Backend eintragen, dann:

```
python3 mitreden.py ui
```

Auf <http://localhost:8770> Sätze eintippen — eine Zeile pro Satz —,
„Satz hinzufügen“ drücken. Die Audiodateien landen in `out/`.

Ohne Oberfläche geht es genauso:

```
python3 mitreden.py add "Ich brauche Hilfe." --tags notfall
python3 mitreden.py edit guck-mal "Guck mal!"
python3 mitreden.py build        # nur Neues/Geändertes
python3 mitreden.py build --all  # alles neu, nach einem Stimmwechsel
python3 mitreden.py delete ich-brauche-hilfe
```

**Vertippt?** Über das ⋮ am rechten Rand einer Zeile lässt sich der Text
ändern, ohne den Satz neu anzulegen. Er wird sofort neu aufgenommen. Die ID
und damit der Dateiname bleiben, wie sie sind — die Datei liegt womöglich
längst auf einem Talker oder einem Hörstift, und die soll ein vergessenes
Fragezeichen nicht umbenennen. Für einen wirklich anderen Satz ist ein neuer
Eintrag der richtige Weg.

## Was rauskommt

Pro Satz eine Datei in `out/`, benannt nach seiner ID. Standard ist WAV mit
44,1 kHz mono; das Format steht in `config.json` und kann alles sein, was
ffmpeg schreiben kann:

```json
{ "output": { "format": "mp3", "sample_rate": 44100, "channels": 1,
              "bitrate": "192k" } }
```

`"mp3"` spart Platz und ist das, was die meisten Apps und Geräte erwarten; ein
kleineres `sample_rate` hilft, wenn das Zielgerät wenig Speicher hat.

`bitrate` gilt nur für platzsparende Formate (mp3, ogg, m4a, opus) — bei WAV
und FLAC wird es ignoriert. 192k klingt sauber, 96k spart die Hälfte und hört
sich bei einer Stimme immer noch ordentlich an. Ohne Angabe sucht ffmpeg selbst
etwas aus, und das ist für Sprache oft zu wenig: dumpf und blechern.

Nach einer Änderung einmal `build` — mitreden merkt selbst, dass neu gerendert
werden muss, und räumt die alten Dateien weg.

Jede Datei ist stillebereinigt und auf −16 LUFS normalisiert. Ohne das ist ein
Satz kaum hörbar und der nächste brüllt.

## Die Stimme wählen

Das Backend steht in `config.json`. Umstellen, dann einmal
`python3 mitreden.py build --all`.

**`say` / `espeak`** — schon da, kein Setup, kein Konto. Roboterhaft, aber der
schnellste Weg zu prüfen, ob alles läuft.

```json
{ "backend": "say", "say": { "voice": "Anna" } }
```

**`piper`** — lokal, offline, kostenlos, quelloffen. Deutsche Modelle gibt es
[fertig zum Herunterladen](https://github.com/rhasspy/piper). Läuft in zehn
Jahren noch genauso, ohne Konto und ohne Abo.

**`azure`** — neuronale Stimmen über die Cloud, klingt deutlich lebendiger als
alles Lokale. Kostenlose Stufe (F0) reicht für diese Mengen meist aus.
`rate` und `pitch` gelten für die erzeugten Dateien und wirken nach einem
`build --all`.

```json
{ "backend": "azure",
  "azure": { "voice": "de-DE-GiselaNeural", "region": "germanywestcentral",
             "key_env": "AZURE_SPEECH_KEY", "rate": "-5%", "pitch": "0%" } }
```

**`elevenlabs`** — kann eine echte Stimme klonen. Qualitativ das Beste, dafür
Abo und Cloud — und die Einwilligung der Person, deren Stimme du klonst.

Schlüssel stehen **nie** in einer Datei im Repo, sondern in einer
Umgebungsvariablen. In `config.json` steht mit `key_env` nur der *Name*:

```
export AZURE_SPEECH_KEY="dein-schluessel"
```

Dauerhafter geht es mit einer `.env` neben `mitreden.py`, die beim Start
gelesen wird und in `.gitignore` steht:

```
AZURE_SPEECH_KEY=dein-schluessel
```

Wenn du dich für eine Cloud-Stimme entscheidest: sichere die erzeugten Dateien
zusätzlich. Ein Dienst kann verschwinden, eine lokale Datei nicht.

## Gruppen, Suche, Download

Ab ein paar Dutzend Sätzen willst du Ordnung. mitreden nimmt dafür **Gruppen,
keine Ordner** — ein Satz kann in mehreren stecken:

```json
{ "id": "ich-brauche-hilfe", "text": "Ich brauche Hilfe.",
  "tags": ["kindergarten", "zuhause", "notfall"] }
```

Über der Liste stehen die Gruppen zum Anklicken, daneben ein Suchfeld. Mehrere
Gruppen lassen sich gleichzeitig wählen und verknüpfen mit ODER; der Freitext
schränkt zusätzlich ein. Die Suche läuft im Browser, ohne Warten, über Text
*und* Gruppennamen, und ist tolerant bei Umlauten: `hor auf`, `hoer auf` und
`Hör auf` finden alle denselben Satz.

Die Leiste zeigt die zwölf meistgenutzten Gruppen und klappt den Rest hinter
„+ n weitere“ weg. Alles Weitere zu einem Satz steckt im ⋮ am rechten Rand
seiner Zeile.

**Ein Text, eine Datei.** Legst du einen Satz an, den es schon gibt, entsteht
kein zweiter Eintrag — der vorhandene bekommt nur die neue Gruppe dazu. Groß-
und Kleinschreibung und zusätzliche Leerzeichen sind egal, Satzzeichen nicht:
„Nochmal!“ und „Nochmal.“ klingen verschieden, also sind es zwei Sätze.

```
python3 mitreden.py dedupe           # zeigt, was zusammengeführt würde
python3 mitreden.py dedupe --apply   # führt es wirklich zusammen
```

Ohne `--apply` wird nichts angefasst.

**Herunterladen.** Der Knopf packt genau die Sätze zusammen, die die Liste
gerade zeigt — nach einer Suche also die Treffer, in einer Gruppe deren Sätze.
Auf der Kommandozeile:

```
python3 mitreden.py export kindergarten ~/Desktop/kiga
python3 mitreden.py export all ~/Desktop/alles
```

## Auf dem NAS laufen lassen

mitreden ist ein Werkzeug, kein Dienst — für den Hausgebrauch reicht es, es auf
dem Rechner zu starten. Wenn es aber dauerhaft laufen soll, damit du auch vom
Handy aus Sätze hinzufügen kannst und `phrases.json` in der NAS-Sicherung
liegt, gibt es ein fertiges Abbild. Das Repo brauchst du dafür nicht — nur
einen Ordner für deine Daten und diese `docker-compose.yml`:

```yaml
services:
  mitreden:
    image: ghcr.io/steffipetaffy/mitreden:latest
    ports: ["8770:8770"]
    volumes: ["./:/data"]
    restart: unless-stopped
```

```
docker compose pull && docker compose up -d
```

Beim ersten Start legt mitreden sich seine `config.json` selbst an; Backend
und Stimme trägst du dort ein, den Schlüssel in eine `.env` daneben. Alles,
was dir gehört — Sätze, Config, `out/`, Schlüssel — liegt in diesem einen
Ordner. Das Programm kommt aus dem Abbild und wird mit `docker compose pull`
aktuell, ohne deine Daten anzufassen.

Gebaut wird das Abbild in der CI für amd64 und arm64, dein NAS zieht es also
fertig. Selbst bauen geht auch: Repo klonen und `docker compose up -d --build`.

Auf einer Synology ist die eigene Kennung wichtig: sonst läuft der Container
als root, und was er anlegt, gehört danach root und ist über die Netzfreigabe
nicht mehr zu bearbeiten. Per SSH `id` aufrufen und `user: "1026:100"` in die
Compose-Datei eintragen.

Und die Portfreigabe gehört ins Heimnetz. Denn: **die Oberfläche hat keine
Anmeldung.** Wer den Port erreicht, kann Sätze anlegen, löschen und über
deinen Schlüssel rendern lassen. Im eigenen Netz oder über VPN ist das in
Ordnung, im offenen Internet nicht. Deshalb lauscht mitreden von sich aus nur
auf `localhost` und muss ausdrücklich ans Netz geschickt werden:

```
python3 mitreden.py ui --host 0.0.0.0 --port 8770
```

Wo deine Daten liegen, steuert `MITREDEN_DIR`. Ohne die Variable ist es der
Ordner neben `mitreden.py` — auf dem Rechner ändert sich also nichts.

## Deine Inhalte bleiben lokal

Im Repo liegt nur `phrases.example.json` als Startpunkt. Deine eigene
`phrases.json`, alles daraus Erzeugte und deine Schlüssel sind in `.gitignore`
eingetragen und wandern nie mit:

```
phrases.json        deine Sätze
phrases.json.*      Sicherungskopien davon
out/  build/        alles daraus Erzeugte
*.wav *.mp3 *.aiff  Audio, wo auch immer es auftaucht
.env  .env.*        Schlüssel
```

Für `phrases.json` nimmst du am besten ein privates Repo oder ein Backup
außerhalb von git — es ist, wie oben gesagt, das Einzige, was sich nicht neu
erzeugen lässt.

## Mitmachen

Das ist ein Hobbyprojekt, entstanden aus einem konkreten Bedarf zu Hause — es
gibt keine Roadmap und keine Zusagen. Wenn du es für dein eigenes Kind oder
für jemanden, den du begleitest, benutzt: schön. Fehlerberichte und Fragen
sind willkommen, auch wenn Antworten dauern können.

Wenn du etwas Ähnliches baust und Rat gebrauchen kannst, mach ein Issue auf.
Zu unterstützter Kommunikation gibt es wenig Werkzeug, das man selbst in der
Hand hat, und die Erfahrung damit teilt sich schlecht über Umwege.

## Lizenz

MIT — siehe [LICENSE](LICENSE). Mach damit, was du willst.
