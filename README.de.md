# mitreden

**Deutsch** · [English](README.md)

Ein Satz eingetippt, eine Audiodatei zurück — und alle klingen gleich.

Ich baue das für meine dreieinhalbjährige Tochter, die unterstützt
kommuniziert.

*Diese Seite bringt dich zum Laufen. Die ausführliche Anleitung — NAS,
Cloud-Stimmen, Formate, Sammlungen — steht auf [Englisch](README.md).*

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

## Loslegen

Am schnellsten geht es mit dem Container. Er bringt vier Stimmen mit und
spricht deshalb sofort — ohne Konto, ohne Schlüssel, ohne dass etwas dein Netz
verlässt.

**Ohne Terminal:** Eine dieser Dateien in einen leeren Ordner legen und öffnen
— [mitreden.command](docs/mitreden.command) auf dem Mac,
[mitreden.bat](docs/mitreden.bat) unter Windows,
[mitreden.sh](docs/mitreden.sh) unter Linux. Es gibt sie auch auf
[der Webseite](https://lautstark.github.io/mitreden/de.html), die in einer
halben Minute zeigt, wie das aussieht. Sie holt mitreden, startet es und
öffnet den Browser. Docker muss installiert sein; steht es nicht bereit, sagt
die Datei es dir. Solange das Fenster offen bleibt, läuft mitreden.

Auf dem Mac kommt die Datei aus dem Internet, deshalb braucht der erste Start
Rechtsklick → Öffnen statt eines Doppelklicks. macOS fragt einmal, danach
nicht mehr.

**Mit Terminal** geht dasselbe in einer Zeile:

```
mkdir mitreden && cd mitreden
docker run -d -p 8770:8770 -v "$PWD:/data" ghcr.io/steffipetaffy/mitreden:latest
```

<http://localhost:8770> öffnen, Sätze eintippen — eine Zeile pro Satz —,
„Satz hinzufügen" drücken. Die Audiodateien landen in `out/`, in dem Ordner,
in dem du gestartet hast, zusammen mit einer `config.json`, die mitreden sich
selbst schreibt.

Das ist alles.

## Die Stimme wählen

Die Stimme steht neben „Satz hinzufügen". Sie entscheidet, womit aufgenommen
wird: Jeder neue Satz bekommt sie, bestehende behalten ihre, bis du sie
ankreuzt und „Stimme ändern" wählst. Eine Stimme für alles bleibt der
Normalfall — „Alle auswählen", einmal aufnehmen, fertig.

**Im Container sind vier Piper-Stimmen dabei** — Thorsten und Kerstin auf
Deutsch, John und Kristin auf Englisch, alle vier CC0 oder gemeinfrei. Damit
spricht mitreden sofort, ohne Konto, ohne Schlüssel, ohne dass je etwas dein
Netz verlässt.

Wer eine Cloud-Stimme will: Das Zahnrad neben der Sprachauswahl nimmt den
Schlüssel entgegen, danach stehen die Stimmen des Dienstes zur Wahl. Der
Schlüssel landet in einer `.env` neben deinen Sätzen und wird nie wieder
angezeigt.

Was zugleich heißt: Wer die Oberfläche erreicht, kann dort einen Schlüssel
setzen. Sie hat keine Anmeldung. Nur im Heimnetz.

## Deine Inhalte bleiben lokal

Deine Sätze, alles daraus Gemachte und deine Schlüssel stehen in `.gitignore`
und wandern nie mit. `phrases.json` ist das Einzige, was sich nicht wieder
erzeugen lässt — dafür lohnt eine Sicherung.

## Mehr

Alles Weitere steht in der [englischen Anleitung](README.md): Dauerbetrieb auf
dem NAS, eigene Piper-Modelle, Azure und ElevenLabs, Ausgabeformate, Sammlungen
und Suche, die Kommandozeile.

Fehlerberichte und Fragen sind willkommen — gern auf Deutsch.

## Verwandt

[bildhaft](https://github.com/SteffiPeTaffy/bildhaft) ist ein Schwesterprojekt:
deutschen Satz eintippen, eine Reihe UK-Piktogramme zurückbekommen,
korrigieren, ausdrucken. Läuft ebenfalls ganz im Browser. Es ist derselbe Satz,
zweimal gesehen: bildhaft gibt ihm Symbole, mitreden gibt ihm eine Stimme.

Beide tragen dasselbe Zeichen, dieselbe Sprechblase, nur in anderer Farbe. Und
dasselbe Prinzip: bildhaft speichert Symbol-Verweise statt Bilder, mitreden
speichert Sätze statt Audio. So funktioniert die exportierte Datei bei dem, der
sie bekommt — egal, welche Symbole oder Stimmen dort da sind.

## Lizenz

MIT — siehe [LICENSE](LICENSE). Mach damit, was du willst.
