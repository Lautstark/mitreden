#!/usr/bin/env python3
"""
vorlaut — eine Stimme fuer alle Geraete.

Quelle der Wahrheit ist phrases.json. Aus jedem Eintrag wird pro Ziel-
geraet eine Audiodatei gerendert. Stimme wechseln = Backend in config.json
aendern + `python3 vorlaut.py build --all` = alles klingt wieder gleich.

Aufruf:
    python3 vorlaut.py ui              # Weboberflaeche auf http://localhost:8770
    python3 vorlaut.py add "Nochmal!"  # Satz aufnehmen
    python3 vorlaut.py build           # nur Neues/Geaendertes rendern
    python3 vorlaut.py build --all     # alles neu rendern (nach Stimmwechsel)
    python3 vorlaut.py backends        # zeigt, welche Backends nutzbar sind

Keine pip-Abhaengigkeiten. Gebraucht werden nur ffmpeg und ein TTS-Backend.
"""

import hashlib
import http.server
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PHRASES = ROOT / "phrases.json"
CONFIG = ROOT / "config.json"
RAW = ROOT / "build" / "raw"
OUT = ROOT / "out"

# Ausgabeprofile: Zielgeraet -> ffmpeg-Parameter.
# anybook  : Anybook Studio nimmt WAV/MP3, 44.1 kHz mono reicht voellig.
# esp32    : I2S mit MAX98357A, 16 kHz mono 16 bit spart Flash und klingt gut.
# preview  : fuer die Weboberflaeche.
PROFILES = {
    "anybook": ["-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le"],
    "esp32":   ["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"],
    "preview": ["-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le"],
}

# Stille am Anfang/Ende weg, dann auf einheitliche Lautheit normalisieren.
# Ohne das ist ein Satz fluesterleise und der naechste bruellt.
FILTERS = (
    "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB,"
    "areverse,"
    "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB,"
    "areverse,"
    "loudnorm=I=-16:TP=-1.5:LRA=11"
)

DEFAULT_CONFIG = {
    "backend": "say",
    "say":        {"voice": "Anna"},
    "espeak":     {"binary": "espeak-ng", "voice": "de", "speed": 150},
    "piper":      {"model": "de_DE-kerstin-low.onnx", "binary": "piper"},
    "azure":      {"voice": "de-DE-GiselaNeural", "region": "westeurope",
                   "key_env": "AZURE_SPEECH_KEY", "rate": "-5%", "pitch": "0%"},
    "elevenlabs": {"voice_id": "", "model": "eleven_multilingual_v2",
                   "key_env": "ELEVENLABS_API_KEY"},
}


# ---------------------------------------------------------------- Persistenz

def load_config():
    if not CONFIG.exists():
        CONFIG.write_text(json.dumps(DEFAULT_CONFIG, indent=2, ensure_ascii=False))
    cfg = json.loads(CONFIG.read_text())
    for k, v in DEFAULT_CONFIG.items():          # fehlende Schluessel ergaenzen
        if k not in cfg:
            cfg[k] = v
    return cfg


def load_phrases():
    if not PHRASES.exists():
        return []
    return json.loads(PHRASES.read_text())


def save_phrases(items):
    PHRASES.write_text(json.dumps(items, indent=2, ensure_ascii=False))


def slug(text):
    keep = "abcdefghijklmnopqrstuvwxyz0123456789"
    sub = {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "é": "e", "è": "e"}
    out = []
    for ch in text.lower().strip():
        for c in sub.get(ch, ch):
            out.append(c if c in keep else "-")
    s = "".join(out).strip("-")
    while "--" in s:
        s = s.replace("--", "-")
    return s[:40] or "satz"


def fingerprint(text, cfg):
    """Aendert sich, wenn Text ODER Stimme sich aendert -> Neurendern noetig."""
    backend = cfg["backend"]
    payload = json.dumps([text, backend, cfg.get(backend, {})],
                         sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


# ------------------------------------------------------------------ Backends

def tts_say(text, dest, opt):
    """macOS-Bordmittel. Zum Ausprobieren ohne Setup, nicht als Dauerloesung."""
    aiff = dest.with_suffix(".aiff")
    subprocess.run(["say", "-v", opt["voice"], "-o", str(aiff), text], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(aiff),
                    str(dest)], check=True)
    aiff.unlink(missing_ok=True)


def tts_espeak(text, dest, opt):
    """Auf Linux fast immer schon da. Klingt roboterhaft, beweist aber, dass
    die Kette laeuft, bevor du dich um eine gute Stimme kuemmerst."""
    subprocess.run([opt["binary"], "-v", opt["voice"], "-s", str(opt["speed"]),
                    "-w", str(dest), text], check=True)


def tts_piper(text, dest, opt):
    """Lokal, offline, kostenlos, laeuft in zehn Jahren noch."""
    subprocess.run([opt["binary"], "-m", opt["model"], "-f", str(dest)],
                   input=text.encode("utf-8"), check=True,
                   stdout=subprocess.DEVNULL)


def tts_azure(text, dest, opt):
    key = os.environ.get(opt["key_env"])
    if not key:
        raise RuntimeError(f"Umgebungsvariable {opt['key_env']} ist nicht gesetzt.")
    ssml = (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
        'xml:lang="de-DE">'
        f'<voice name="{opt["voice"]}">'
        f'<prosody rate="{opt["rate"]}" pitch="{opt["pitch"]}">{esc(text)}</prosody>'
        "</voice></speak>"
    )
    url = f"https://{opt['region']}.tts.speech.microsoft.com/cognitiveservices/v1"
    req = urllib.request.Request(url, data=ssml.encode("utf-8"), method="POST",
                                 headers={
                                     "Ocp-Apim-Subscription-Key": key,
                                     "Content-Type": "application/ssml+xml",
                                     "X-Microsoft-OutputFormat":
                                         "riff-48khz-16bit-mono-pcm",
                                 })
    with urllib.request.urlopen(req, timeout=60) as r:
        dest.write_bytes(r.read())


def tts_elevenlabs(text, dest, opt):
    key = os.environ.get(opt["key_env"])
    if not key:
        raise RuntimeError(f"Umgebungsvariable {opt['key_env']} ist nicht gesetzt.")
    if not opt["voice_id"]:
        raise RuntimeError("voice_id fehlt in config.json.")
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{opt['voice_id']}"
    body = json.dumps({"text": text, "model_id": opt["model"]}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"xi-api-key": key,
                                          "Content-Type": "application/json"})
    mp3 = dest.with_suffix(".mp3")
    with urllib.request.urlopen(req, timeout=120) as r:
        mp3.write_bytes(r.read())
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp3),
                    str(dest)], check=True)
    mp3.unlink(missing_ok=True)


BACKENDS = {"say": tts_say, "espeak": tts_espeak, "piper": tts_piper,
            "azure": tts_azure, "elevenlabs": tts_elevenlabs}


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


# -------------------------------------------------------------------- Rendern

def render(item, cfg, force=False):
    """Ein Satz -> Rohdatei -> alle Ausgabeprofile. Gibt True bei Arbeit."""
    fp = fingerprint(item["text"], cfg)
    targets = [OUT / p / f"{item['id']}.wav" for p in PROFILES]
    if not force and item.get("fingerprint") == fp and all(t.exists() for t in targets):
        return False

    RAW.mkdir(parents=True, exist_ok=True)
    raw = RAW / f"{item['id']}.wav"
    backend = cfg["backend"]
    if backend not in BACKENDS:
        raise RuntimeError(f"Unbekanntes Backend '{backend}' in config.json. "
                           f"Moeglich: {', '.join(BACKENDS)}")
    opt = cfg[backend]
    binary = opt.get("binary") or ({"say": "say"}.get(backend))
    if binary and not shutil.which(binary):
        raise RuntimeError(f"'{binary}' ist nicht installiert \u2014 Backend "
                           f"'{backend}' kann nicht rendern. "
                           f"`vorlaut.py backends` zeigt, was da ist.")
    BACKENDS[backend](item["text"], raw, opt)

    for profile, args in PROFILES.items():
        dest = OUT / profile / f"{item['id']}.wav"
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw),
                        "-af", FILTERS, *args, str(dest)], check=True)

    item["fingerprint"] = fp
    item["backend"] = cfg["backend"]
    return True


def build(force=False):
    cfg = load_config()
    items = load_phrases()
    if not items:
        print("phrases.json ist leer. Erst Saetze anlegen: vorlaut.py add \"Text\"")
        return
    done = 0
    for item in items:
        try:
            if render(item, cfg, force):
                print(f"  gerendert  {item['id']}  \u2014 {item['text']}")
                done += 1
        except Exception as e:
            print(f"  FEHLER     {item['id']}: {e}", file=sys.stderr)
    save_phrases(items)
    print(f"\n{done} von {len(items)} Saetzen neu gerendert. Stimme: {cfg['backend']}")
    print(f"Dateien liegen in {OUT}/anybook und {OUT}/esp32")


# ------------------------------------------------------------------------ UI

PAGE = """<!doctype html><html lang="de"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>vorlaut</title>
<style>
:root{
  --ink:#14161c; --panel:#1d212b; --line:#2b3040;
  --text:#ece9e4; --muted:#868da0; --accent:#f0a202; --accent-ink:#14161c;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ink);color:var(--text);
  font:16px/1.55 ui-sans-serif,system-ui,"Segoe UI",sans-serif;
  padding:clamp(20px,5vw,56px)}
main{max-width:760px;margin:0 auto}
h1{font-size:clamp(28px,6vw,44px);font-weight:800;letter-spacing:-.03em;
  margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 32px;font-size:15px}
.hero{background:var(--panel);border:1px solid var(--line);border-radius:14px;
  padding:20px;margin-bottom:14px}
label{display:block;font-size:13px;color:var(--muted);margin-bottom:8px}
textarea{width:100%;min-height:96px;resize:vertical;background:var(--ink);
  color:var(--text);border:1px solid var(--line);border-radius:9px;padding:14px;
  font:inherit;font-size:19px}
textarea:focus,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px}
button{font:inherit;font-weight:600;border-radius:9px;padding:11px 18px;
  border:1px solid var(--line);background:transparent;color:var(--text);cursor:pointer}
button.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
button:disabled{opacity:.45;cursor:default}
.status{color:var(--muted);font-size:14px;min-height:20px;margin:6px 2px 26px}
.item{display:flex;gap:14px;align-items:flex-start;padding:14px 2px;
  border-top:1px solid var(--line)}
.item .txt{flex:1;font-size:18px}
.item .id{font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;
  color:var(--muted);word-break:break-all}
.item audio{height:34px}
.empty{color:var(--muted);border-top:1px solid var(--line);padding:28px 2px}
</style>
<main>
<h1>vorlaut</h1>
<p class="sub">Ein Satz, eine Stimme, Dateien fuer Anybook und ESP32.</p>

<div class="hero">
  <label for="t">Was soll sie sagen koennen?</label>
  <textarea id="t" placeholder="Nochmal!&#10;Ich bin dran.&#10;Lass mich in Ruhe."></textarea>
  <div class="row">
    <button class="primary" id="add">Satz anlegen</button>
    <button id="build">Neue rendern</button>
    <button id="rebuild">Alles neu rendern</button>
  </div>
</div>
<p class="status" id="s">&nbsp;</p>

<div id="list"></div>
</main>
<script>
const $=id=>document.getElementById(id);
const say=m=>$('s').textContent=m||'\\u00a0';

async function load(){
  const r=await fetch('/api/phrases');const items=await r.json();
  $('list').innerHTML = items.length ? '' :
    '<p class="empty">Noch nichts da. Mehrere Zeilen auf einmal gehen auch \\u2014 '+
    'jede Zeile wird ein eigener Satz.</p>';
  for(const it of items){
    const d=document.createElement('div');d.className='item';
    d.innerHTML='<div class="txt"></div>'+
      '<audio controls preload="none" src="/audio/'+it.id+'.wav"></audio>';
    d.querySelector('.txt').textContent=it.text;
    const id=document.createElement('div');id.className='id';id.textContent=it.id;
    d.querySelector('.txt').appendChild(id);
    $('list').appendChild(d);
  }
}
async function post(url,body){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body||{})});
  if(!r.ok){say('Fehlgeschlagen: '+await r.text());return null}
  return r.json();
}
$('add').onclick=async()=>{
  const lines=$('t').value.split('\\n').map(s=>s.trim()).filter(Boolean);
  if(!lines.length){say('Erst etwas eintippen.');return}
  say('Lege an und rendere \\u2026');
  const res=await post('/api/phrases',{lines});
  if(res){$('t').value='';say(res.added+' angelegt, '+res.rendered+' gerendert.');load()}
};
$('build').onclick=async()=>{say('Rendere \\u2026');
  const r=await post('/api/build',{force:false});
  if(r){say(r.rendered+' gerendert.');load()}};
$('rebuild').onclick=async()=>{
  if(!confirm('Alle Saetze mit der aktuellen Stimme neu rendern?'))return;
  say('Rendere alles neu, das dauert \\u2026');
  const r=await post('/api/build',{force:true});
  if(r){say(r.rendered+' neu gerendert.');load()}};
load();
</script>
</html>"""


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/":
            return self._send(200, PAGE, "text/html; charset=utf-8")
        if self.path.startswith("/audio/"):
            f = OUT / "preview" / Path(self.path).name
            if not f.exists() or ".." in self.path:
                return self._send(404, b"", "text/plain")
            return self._send(200, f.read_bytes(), "audio/wav")
        if self.path == "/api/phrases":
            return self._send(200, json.dumps(load_phrases(), ensure_ascii=False))
        self._send(404, b"", "text/plain")

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        data = json.loads(self.rfile.read(n) or "{}")
        cfg = load_config()
        items = load_phrases()

        if self.path == "/api/phrases":
            existing = {i["id"] for i in items}
            added, rendered = 0, 0
            for line in data.get("lines", []):
                base, sid, n2 = slug(line), slug(line), 2
                while sid in existing:
                    sid, n2 = f"{base}-{n2}", n2 + 1
                item = {"id": sid, "text": line}
                items.append(item)
                existing.add(sid)
                added += 1
                try:
                    rendered += 1 if render(item, cfg) else 0
                except Exception as e:
                    return self._send(500, str(e), "text/plain")
            save_phrases(items)
            return self._send(200, json.dumps({"added": added, "rendered": rendered}))

        if self.path == "/api/build":
            force = bool(data.get("force"))
            rendered = 0
            for item in items:
                try:
                    rendered += 1 if render(item, cfg, force) else 0
                except Exception as e:
                    save_phrases(items)
                    return self._send(500, str(e), "text/plain")
            save_phrases(items)
            return self._send(200, json.dumps({"rendered": rendered}))

        self._send(404, b"", "text/plain")


# ----------------------------------------------------------------------- CLI

def check_backends():
    cfg = load_config()
    print(f"Aktiv laut config.json: {cfg['backend']}\n")
    print("  say        ", "vorhanden" if shutil.which("say") else "nicht gefunden (nur macOS)")
    print("  espeak     ", "vorhanden" if shutil.which(cfg["espeak"]["binary"]) else "nicht gefunden")
    print("  piper      ", "vorhanden" if shutil.which(cfg["piper"]["binary"]) else "nicht gefunden")
    print("  azure      ", "Key gesetzt" if os.environ.get(cfg["azure"]["key_env"]) else "kein Key")
    print("  elevenlabs ", "Key gesetzt" if os.environ.get(cfg["elevenlabs"]["key_env"]) else "kein Key")
    print("\n  ffmpeg     ", "vorhanden" if shutil.which("ffmpeg") else "FEHLT \u2014 ohne geht nichts")


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else "ui"

    if cmd == "ui":
        load_config()
        port = 8770
        print(f"vorlaut laeuft auf http://localhost:{port}  (Strg-C beendet)")
        http.server.HTTPServer(("127.0.0.1", port), Handler).serve_forever()
    elif cmd == "add":
        if len(args) < 2:
            sys.exit('Aufruf: vorlaut.py add "Der Satz"')
        items = load_phrases()
        existing = {i["id"] for i in items}
        base, sid, n = slug(args[1]), slug(args[1]), 2
        while sid in existing:
            sid, n = f"{base}-{n}", n + 1
        items.append({"id": sid, "text": args[1]})
        save_phrases(items)
        print(f"angelegt: {sid}")
        build()
    elif cmd == "build":
        build(force="--all" in args)
    elif cmd == "backends":
        check_backends()
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
