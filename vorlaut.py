#!/usr/bin/env python3
"""
vorlaut — one voice for every device.

phrases.json is the source of truth. Every entry is rendered into one audio
file per target device. Change the voice = change the backend in config.json
+ `python3 vorlaut.py build --all` = everything sounds alike again.

Usage:
    python3 vorlaut.py ui              # web interface at http://localhost:8770
    python3 vorlaut.py add "Nochmal!"  # record a phrase
    python3 vorlaut.py build           # render only new/changed phrases
    python3 vorlaut.py build --all     # re-render everything (after a voice change)
    python3 vorlaut.py delete <id>     # delete a phrase and its files
    python3 vorlaut.py backends        # show which backends are usable

No pip dependencies. All you need is ffmpeg and a TTS backend.

Note: the spoken content is German (see phrases.json and the voice settings in
config.json). Only the tooling around it is in English.
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

# Output profiles: target device -> ffmpeg parameters.
# anybook  : Anybook Studio accepts WAV/MP3, 44.1 kHz mono is plenty.
# esp32    : I2S with MAX98357A, 16 kHz mono 16 bit saves flash and sounds fine.
# preview  : for the web interface.
PROFILES = {
    "anybook": ["-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le"],
    "esp32":   ["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"],
    "preview": ["-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le"],
}

# Strip silence at the start/end, then normalise to a uniform loudness.
# Without this one phrase is barely audible and the next one shouts.
FILTERS = (
    "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB,"
    "areverse,"
    "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB,"
    "areverse,"
    "loudnorm=I=-16:TP=-1.5:LRA=11"
)

# The voice settings stay German on purpose — German is the spoken language.
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


# --------------------------------------------------------------- Persistence

def load_config():
    if not CONFIG.exists():
        CONFIG.write_text(json.dumps(DEFAULT_CONFIG, indent=2, ensure_ascii=False))
    cfg = json.loads(CONFIG.read_text())
    for k, v in DEFAULT_CONFIG.items():          # fill in missing keys
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
    """Filename-safe id. The substitutions are German because the phrases are."""
    keep = "abcdefghijklmnopqrstuvwxyz0123456789"
    sub = {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "é": "e", "è": "e"}
    out = []
    for ch in text.lower().strip():
        for c in sub.get(ch, ch):
            out.append(c if c in keep else "-")
    s = "".join(out).strip("-")
    while "--" in s:
        s = s.replace("--", "-")
    return s[:40] or "phrase"


def fingerprint(text, cfg):
    """Changes when the text OR the voice changes -> re-render needed."""
    backend = cfg["backend"]
    payload = json.dumps([text, backend, cfg.get(backend, {})],
                         sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


# ------------------------------------------------------------------ Backends

def tts_say(text, dest, opt):
    """Built into macOS. Good for a quick try without setup, not for the long run."""
    aiff = dest.with_suffix(".aiff")
    subprocess.run(["say", "-v", opt["voice"], "-o", str(aiff), text], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(aiff),
                    str(dest)], check=True)
    aiff.unlink(missing_ok=True)


def tts_espeak(text, dest, opt):
    """Almost always present on Linux. Sounds robotic, but proves the chain
    works before you go looking for a good voice."""
    subprocess.run([opt["binary"], "-v", opt["voice"], "-s", str(opt["speed"]),
                    "-w", str(dest), text], check=True)


def tts_piper(text, dest, opt):
    """Local, offline, free, and still running the same way in ten years."""
    subprocess.run([opt["binary"], "-m", opt["model"], "-f", str(dest)],
                   input=text.encode("utf-8"), check=True,
                   stdout=subprocess.DEVNULL)


def tts_azure(text, dest, opt):
    key = os.environ.get(opt["key_env"])
    if not key:
        raise RuntimeError(f"Environment variable {opt['key_env']} is not set.")
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
        raise RuntimeError(f"Environment variable {opt['key_env']} is not set.")
    if not opt["voice_id"]:
        raise RuntimeError("voice_id is missing in config.json.")
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


# ----------------------------------------------------------------- Rendering

def render(item, cfg, force=False):
    """One phrase -> raw file -> every output profile. Returns True if it worked."""
    fp = fingerprint(item["text"], cfg)
    targets = [OUT / p / f"{item['id']}.wav" for p in PROFILES]
    if not force and item.get("fingerprint") == fp and all(t.exists() for t in targets):
        return False

    RAW.mkdir(parents=True, exist_ok=True)
    raw = RAW / f"{item['id']}.wav"
    backend = cfg["backend"]
    if backend not in BACKENDS:
        raise RuntimeError(f"Unknown backend '{backend}' in config.json. "
                           f"Available: {', '.join(BACKENDS)}")
    opt = cfg[backend]
    binary = opt.get("binary") or ({"say": "say"}.get(backend))
    if binary and not shutil.which(binary):
        raise RuntimeError(f"'{binary}' is not installed — backend "
                           f"'{backend}' cannot render. "
                           f"`vorlaut.py backends` shows what is available.")
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
        print("phrases.json is empty. Add phrases first: vorlaut.py add \"Text\"")
        return
    done = 0
    for item in items:
        try:
            if render(item, cfg, force):
                print(f"  rendered   {item['id']}  — {item['text']}")
                done += 1
        except Exception as e:
            print(f"  ERROR      {item['id']}: {e}", file=sys.stderr)
    save_phrases(items)
    print(f"\nRe-rendered {done} of {len(items)} phrases. Voice: {cfg['backend']}")
    print(f"Files are in {OUT}/anybook and {OUT}/esp32")


def phrase_state(item, cfg):
    """ok = current, missing = never rendered, stale = other voice or other text."""
    if not all((OUT / prof / f"{item['id']}.wav").exists() for prof in PROFILES):
        return "missing"
    if item.get("fingerprint") != fingerprint(item["text"], cfg):
        return "stale"
    return "ok"


def voice_label(cfg):
    """Voice name for the interface, e.g. de-DE-GiselaNeural -> Gisela."""
    opt = cfg.get(cfg["backend"], {})
    name = opt.get("voice") or cfg["backend"]
    return name.split("-")[-1].replace("Neural", "") if name.count("-") >= 2 else name


def phrases_with_state():
    cfg = load_config()
    items = [dict(i, state=phrase_state(i, cfg)) for i in load_phrases()]
    return {"items": items, "voice": voice_label(cfg)}


def delete_phrase(pid):
    """Drop a phrase from phrases.json and delete every WAV it produced.

    Returns (True, deleted_files), or (False, []) if the id does not exist.
    Missing files are fine, that is not an error."""
    items = load_phrases()
    rest = [i for i in items if i.get("id") != pid]
    if len(rest) == len(items):
        return False, []

    removed = []
    for profile in PROFILES:
        f = OUT / profile / f"{pid}.wav"
        if f.exists():
            f.unlink()
            removed.append(f)
    raw = RAW / f"{pid}.wav"
    if raw.exists():
        raw.unlink()
        removed.append(raw)

    save_phrases(rest)
    return True, removed


# ------------------------------------------------------------------------ UI

PAGE = """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>vorlaut</title>
<style>
:root{
  --ink:#0e1014; --panel:#161920; --line:#242833; --line-soft:#1c202a;
  --text:#f2efea; --muted:#7c8496; --accent:#f0a202; --accent-ink:#14161c;
  --ok:#3fb96b; --warn:#f0a202; --miss:#5b6377; --danger:#e5484d;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ink);color:var(--text);
  font:16px/1.55 ui-sans-serif,system-ui,"Segoe UI",sans-serif;
  padding:clamp(20px,5vw,64px);-webkit-font-smoothing:antialiased}
main{max-width:720px;margin:0 auto}
h1{font-size:clamp(30px,6vw,46px);font-weight:800;letter-spacing:-.035em;margin:0}
.sub{color:var(--muted);margin:6px 0 36px;font-size:15px}
.hero{background:var(--panel);border:1px solid var(--line);border-radius:16px;
  padding:22px 22px 16px}
label{display:block;font-size:13px;color:var(--muted);margin-bottom:10px}
textarea{width:100%;min-height:132px;resize:vertical;background:var(--ink);
  color:var(--text);border:1px solid var(--line);border-radius:11px;padding:14px;
  font:inherit;font-size:19px}
textarea::placeholder{color:#4d5464}
textarea:focus,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px}
button{font:inherit;font-weight:600;border-radius:10px;padding:11px 18px;
  border:1px solid var(--line);background:transparent;color:var(--text);cursor:pointer}
button:hover{background:#1e222c}
button.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
button.primary:hover{background:#ffb01a}
button.quiet{border-color:transparent;color:var(--muted);padding:11px 12px}
button.quiet:hover{color:var(--text)}
.status{color:var(--muted);font-size:14px;min-height:20px;margin:12px 2px 0}
.bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  margin:40px 2px 4px;padding-bottom:14px;border-bottom:1px solid var(--line)}
.bar .count{font-weight:650;font-size:15px}
.bar .spacer{flex:1}
.voice{color:var(--muted);font-size:13px;white-space:nowrap}
.voice b{color:var(--text);font-weight:600}
.item{display:flex;gap:14px;align-items:center;padding:15px 2px;
  border-bottom:1px solid var(--line-soft)}
.item .dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--miss)}
.item.ok .dot{background:var(--ok)}
.item.stale .dot{background:var(--warn)}
.item .txt{flex:1;min-width:0}
.item .line{font-size:18px;letter-spacing:-.01em}
.item .meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:3px}
.item .id{font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;
  color:var(--muted);word-break:break-all}
.item .state{font-size:12px;color:var(--muted)}
.item.stale .state{color:var(--warn)}
.item audio{height:32px;flex:none;filter:invert(.92) hue-rotate(180deg);opacity:.85}
.item .del{background:transparent;border:1px solid transparent;border-radius:9px;
  padding:7px 9px;font-size:16px;line-height:1;cursor:pointer;color:var(--muted);flex:none}
.item .del:hover{color:var(--danger);border-color:rgba(229,72,77,.35);
  background:rgba(229,72,77,.1)}
.empty{color:var(--muted);padding:32px 2px;font-size:15px}
.foot{margin-top:28px;color:var(--muted);font-size:13px}
</style>
<main>
<h1>vorlaut</h1>
<p class="sub">One phrase, one voice, files for Anybook and ESP32.</p>

<div class="hero">
  <label for="t">What should she be able to say?</label>
  <textarea id="t" placeholder="Nochmal!&#10;Ich bin dran.&#10;Lass mich in Ruhe."></textarea>
  <div class="row">
    <button class="primary" id="add">Add phrase</button>
    <button class="quiet" id="build">Render missing</button>
  </div>
  <p class="status" id="s">&nbsp;</p>
</div>

<div class="bar">
  <span class="count" id="count">&nbsp;</span>
  <span class="spacer"></span>
  <span class="voice">Voice <b id="voice">…</b></span>
</div>

<div id="list"></div>

<div class="foot">
  <button class="quiet" id="rebuild">Re-record all phrases</button>
</div>
</main>
<script>
const $=id=>document.getElementById(id);
const say=m=>$('s').textContent=m||'\\u00a0';
const LABEL={ok:'recorded',missing:'not recorded yet',stale:'still in the old voice'};

async function load(){
  const data=await (await fetch('/api/phrases')).json();
  // Newest first. phrases.json stays chronological, only the display flips.
  const items=(data.items||[]).slice().reverse();
  $('voice').textContent=data.voice||'\\u2014';

  const pending=items.filter(i=>i.state!=='ok').length;
  $('count').textContent = !items.length ? 'No phrases yet'
    : items.length+(items.length===1?' phrase':' phrases')+
      (pending? ', '+pending+' pending' : ', all recorded');

  $('list').innerHTML = items.length ? '' :
    '<p class="empty">Nothing here yet. Several lines at once work too \\u2014 '+
    'each line becomes its own phrase.</p>';
  for(const it of items){
    const d=document.createElement('div');d.className='item '+it.state;
    d.innerHTML='<span class="dot"></span>'+
      '<div class="txt"><div class="line"></div>'+
      '<div class="meta"><span class="id"></span><span class="state"></span></div></div>'+
      (it.state==='missing'?'':'<audio controls preload="none" src="/audio/'+it.id+'.wav"></audio>')+
      '<button class="del" title="Delete phrase" aria-label="Delete phrase">\\uD83D\\uDDD1\\uFE0F</button>';
    d.querySelector('.line').textContent=it.text;
    d.querySelector('.id').textContent=it.id;
    d.querySelector('.state').textContent=LABEL[it.state];
    d.querySelector('.del').onclick=()=>del(it);
    $('list').appendChild(d);
  }
}
async function del(it){
  if(!confirm('Really delete \\u201C'+it.text+'\\u201D?\\n\\nThe phrase and its audio files '+
              'will be removed. This cannot be undone.'))return;
  say('Deleting \\u2026');
  const r=await post('/api/delete',{id:it.id});
  if(r){say('Deleted: '+r.id);load()}
}
async function post(url,body){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body||{})});
  if(!r.ok){say('Failed: '+await r.text());return null}
  return r.json();
}
$('add').onclick=async()=>{
  const lines=$('t').value.split('\\n').map(s=>s.trim()).filter(Boolean);
  if(!lines.length){say('Type something first.');return}
  say('Recording \\u2026');
  const res=await post('/api/phrases',{lines});
  if(res){$('t').value='';say(res.added+' added, '+res.rendered+' recorded.');load()}
};
$('build').onclick=async()=>{say('Rendering what is missing \\u2026');
  const r=await post('/api/build',{force:false});
  if(r){say(r.rendered?r.rendered+' recorded.':'Nothing was missing.');load()}};
$('rebuild').onclick=async()=>{
  if(!confirm('Re-record all phrases with the current voice?'))return;
  say('Re-recording everything, this takes a while \\u2026');
  const r=await post('/api/build',{force:true});
  if(r){say(r.rendered+' re-recorded.');load()}};
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
            return self._send(200, json.dumps(phrases_with_state(),
                                              ensure_ascii=False))
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

        if self.path == "/api/delete":
            pid = (data.get("id") or "").strip()
            if not pid:
                return self._send(400, "No id provided.", "text/plain")
            ok, _ = delete_phrase(pid)
            if not ok:
                return self._send(404, f"No phrase with the id '{pid}'.", "text/plain")
            return self._send(200, json.dumps({"ok": True, "id": pid},
                                              ensure_ascii=False))

        self._send(404, b"", "text/plain")


# ----------------------------------------------------------------------- CLI

def check_backends():
    cfg = load_config()
    print(f"Active per config.json: {cfg['backend']}\n")
    print("  say        ", "found" if shutil.which("say") else "not found (macOS only)")
    print("  espeak     ", "found" if shutil.which(cfg["espeak"]["binary"]) else "not found")
    print("  piper      ", "found" if shutil.which(cfg["piper"]["binary"]) else "not found")
    print("  azure      ", "key set" if os.environ.get(cfg["azure"]["key_env"]) else "no key")
    print("  elevenlabs ", "key set" if os.environ.get(cfg["elevenlabs"]["key_env"]) else "no key")
    print("\n  ffmpeg     ", "found" if shutil.which("ffmpeg") else "MISSING — nothing works without it")


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else "ui"

    if cmd == "ui":
        load_config()
        port = 8770
        print(f"vorlaut is running at http://localhost:{port}  (Ctrl-C to stop)")
        http.server.HTTPServer(("127.0.0.1", port), Handler).serve_forever()
    elif cmd == "add":
        if len(args) < 2:
            sys.exit('Usage: vorlaut.py add "The phrase"')
        items = load_phrases()
        existing = {i["id"] for i in items}
        base, sid, n = slug(args[1]), slug(args[1]), 2
        while sid in existing:
            sid, n = f"{base}-{n}", n + 1
        items.append({"id": sid, "text": args[1]})
        save_phrases(items)
        print(f"added: {sid}")
        build()
    elif cmd == "delete":
        if len(args) < 2:
            sys.exit("Usage: vorlaut.py delete <id>")
        pid = args[1]
        ok, removed = delete_phrase(pid)
        if not ok:
            ids = [i["id"] for i in load_phrases()]
            print(f"No phrase with the id '{pid}'.", file=sys.stderr)
            if ids:
                print("Available ids: " + ", ".join(ids), file=sys.stderr)
            sys.exit(1)
        print(f"deleted: {pid}")
        for f in removed:
            print(f"  removed    {f.relative_to(ROOT)}")
        if not removed:
            print("  (no audio files present)")
    elif cmd == "build":
        build(force="--all" in args)
    elif cmd == "backends":
        check_backends()
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
