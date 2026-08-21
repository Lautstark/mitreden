#!/usr/bin/env python3
"""
mitreden — one voice for everything that speaks for you.

phrases.json is the source of truth. Every entry is rendered into one audio
file in out/. Change the voice = change the backend in config.json
+ `python3 mitreden.py build --all` = everything sounds alike again.

The output format lives in config.json too: mp3 by default, anything ffmpeg
can write if you need something else. Lossy formats get a bitrate from there
as well — a voice needs a generous one to stay clear.

Phrases can belong to groups ("kindergarten", "spiel"). Groups are labels, not
folders: one phrase can be in several of them, and out/ stays flat — one text,
one audio file, no matter how many groups point at it.

Usage:
    python3 mitreden.py ui              # web interface at http://localhost:8770
    python3 mitreden.py ui --host 0.0.0.0 --port 8770   # reachable from the network
    python3 mitreden.py add "Nochmal!" --tags spiel,zuhause
    python3 mitreden.py edit hallo "Hallo!"
    python3 mitreden.py voices          # which voices are usable here?
    python3 mitreden.py voice piper:de_DE-thorsten-medium
    python3 mitreden.py build --all --voice piper:de_DE-thorsten-medium
    python3 mitreden.py build           # render only new/changed phrases
    python3 mitreden.py build --all     # re-render everything (after a voice change)
    python3 mitreden.py delete <id>     # delete a phrase and its files
    python3 mitreden.py dedupe          # show duplicates (--apply to merge them)
    python3 mitreden.py export <group> <folder>   # copy one group somewhere else
    python3 mitreden.py backends        # show which backends are usable

No pip dependencies. All you need is ffmpeg and a TTS backend.

Note: what a person reads is German where German is what is being spoken —
the web interface and the content itself (phrases.json, the voice settings in
config.json). The guide is README.md in English, with README.de.md as a short
German way in. English is for the code throughout: identifiers, comments,
docstrings, CLI output.
"""

import hashlib
import http.server
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Everything that is yours — phrases, config, audio, key — lives in DATA. That
# is the script's own folder, unless MITREDEN_DIR points somewhere else. The
# split is what lets a container keep the code to itself and still put your
# phrases on a NAS, where they get backed up.
DATA = Path(os.environ.get("MITREDEN_DIR") or ROOT).expanduser()
PHRASES = DATA / "phrases.json"
CONFIG = DATA / "config.json"
ICON = ROOT / "icon.svg"          # part of the program, not of your data
RAW = DATA / "build" / "raw"
OUT = DATA / "out"

# Piper models are looked for here, first match wins. The image ships its own
# under /voices via MITREDEN_VOICES; dropping an .onnx into voices/ next to
# your phrases adds it without touching the image.
VOICE_DIRS = [d for d in dict.fromkeys(
    [Path(os.environ["MITREDEN_VOICES"]) if os.environ.get("MITREDEN_VOICES") else None,
     DATA / "voices", ROOT / "voices"]) if d is not None]

# Anything ffmpeg can write works as a format; the extension picks the codec.
# 16000/1 keeps files small for microcontroller flash, 44100/1 is the safe
# default that plays everywhere.
MIME = {"wav": "audio/wav", "mp3": "audio/mpeg", "ogg": "audio/ogg",
        "flac": "audio/flac", "m4a": "audio/mp4", "opus": "audio/opus"}

# These formats throw audio away to get small. Left alone, ffmpeg picks a
# bitrate that makes a voice sound thin and hollow, so we set one ourselves.
LOSSY = {"mp3", "ogg", "m4a", "opus"}
DEFAULT_BITRATE = "192k"

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
                   "key_env": "AZURE_SPEECH_KEY", "rate": "-5%", "pitch": "0%",
                   "languages": ["de-DE", "en-US"]},
    "elevenlabs": {"voice_id": "", "model": "eleven_multilingual_v2",
                   "key_env": "ELEVENLABS_API_KEY"},
    # mp3 by default: it is what talkers, reading pens and phone apps expect,
    # and a fresh install should produce files that are usable somewhere.
    "output":     {"format": "mp3", "sample_rate": 44100, "channels": 1,
                   "bitrate": DEFAULT_BITRATE},
}


# --------------------------------------------------------------- Persistence

def load_env():
    """Read .env if it is there, without touching what the shell already set.

    Keys never belong in config.json, so they live in the environment — and a
    .env next to the script saves exporting them by hand in every new shell.
    An explicit export still wins over the file."""
    f = DATA / ".env"
    if not f.exists():
        return
    for line in f.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def first_config():
    """The config a fresh installation starts with.

    Which voice depends on where mitreden is running: the container brings
    piper models along, a Mac has say, Linux usually espeak. Picking one that
    works here means a fresh start speaks without anyone editing a file — and
    without a key for a service nobody signed up for."""
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))     # a copy, not the original
    for stem, path in piper_models().items():
        cfg["backend"] = "piper"
        cfg["piper"]["model"] = str(path)
        return cfg
    for backend in ("say", "espeak"):
        opt = DEFAULT_CONFIG.get(backend) or {}
        if shutil.which(opt.get("binary") or backend):
            cfg["backend"] = backend
            return cfg
    return cfg


def write_atomic(path, text, mode=None):
    """Write a file so that it is either the old one or the new one.

    write_text truncates first and writes after, and everything that matters
    here goes through it: phrases.json is the only copy these sentences have,
    config.json is what makes them sound alike. A Ctrl-C, a full disk or a
    container stopping in that window used to leave an empty file behind.
    A temporary file next to it and a rename cannot land half-way.

    mode is set on the temporary file, before it becomes the real one — so a
    file that is meant for you alone is never briefly readable by everyone."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(text)
        if mode is not None:
            try:
                tmp.chmod(mode)
            except OSError:
                pass            # some mounted filesystems do not allow it
        tmp.replace(path)              # atomic within one filesystem
    except BaseException:
        tmp.unlink(missing_ok=True)    # never leave a stray half file
        raise


def load_config():
    if not CONFIG.exists():
        DATA.mkdir(parents=True, exist_ok=True)   # a fresh mount is empty
        write_atomic(CONFIG, json.dumps(first_config(), indent=2,
                                        ensure_ascii=False) + "\n")
    cfg = json.loads(CONFIG.read_text())
    for k, v in DEFAULT_CONFIG.items():
        if k not in cfg:
            cfg[k] = v
        elif isinstance(v, dict) and isinstance(cfg[k], dict):
            # One level deeper, because a config.json is written by hand and
            # people write down the part they care about. "espeak": {"voice":
            # "de"} used to lose the binary and come back as KeyError instead
            # of a sentence anyone could act on. What you wrote wins; the rest
            # is filled in behind it.
            cfg[k] = {**v, **cfg[k]}
    return cfg


def load_phrases():
    if not PHRASES.exists():
        return []
    return json.loads(PHRASES.read_text())


def save_phrases(items):
    write_atomic(PHRASES, json.dumps(items, indent=2, ensure_ascii=False))


SLUG_WORDS = 6
SLUG_CHARS = 40


def slug(text, fallback="phrase"):
    """Filename-safe id. The substitutions are German because the phrases are.

    A long phrase gets a short id: whole words up to a limit, never a cut
    through the middle of one. "Du und ich, ich und du, und Teddy gehoert
    auch dazu" used to end up as du-und-ich-ich-und-du-und-teddy-gehoert-,
    chopped mid-word with a dash hanging off it.

    Two phrases can now end up wanting the same id, but that could happen
    before as well — whoever adds them numbers the second one."""
    keep = "abcdefghijklmnopqrstuvwxyz0123456789"
    sub = {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "é": "e", "è": "e"}
    out = []
    for ch in text.lower().strip():
        for c in sub.get(ch, ch):
            out.append(c if c in keep else "-")
    words = [w for w in "".join(out).split("-") if w]
    short = []
    for w in words[:SLUG_WORDS]:
        if short and len("-".join(short + [w])) > SLUG_CHARS:
            break
        short.append(w)
    return "-".join(short)[:SLUG_CHARS].strip("-") or fallback


def norm_tag(text):
    """Groups get the same treatment as ids, so "Kindergarten" and
    "kindergarten " are one group and not two.

    Without a name there is no group — hence no filename fallback here."""
    return slug(text, "")[:24]


def norm_text(text):
    """Two phrases are the same phrase when this matches.

    Punctuation stays in on purpose: "Nochmal!" and "Nochmal." are spoken
    differently, so they are two phrases, not a duplicate."""
    return " ".join(text.split()).casefold()


def find_twin(items, text):
    """The existing phrase that already says this, or None."""
    key = norm_text(text)
    return next((i for i in items if norm_text(i["text"]) == key), None)


def add_tags(item, tags):
    """Union, order kept. True if anything was actually new."""
    cur = list(item.get("tags") or [])
    new = [t for t in tags if t not in cur]
    if not new:
        return False
    item["tags"] = cur + new
    return True


def add_lines(items, lines, tags=()):
    """Append phrases to `items`, in place.

    A line whose text already exists does not become a second entry — the
    existing phrase just picks up the new groups. That is what keeps one text
    at one audio file, however many groups it belongs to.

    Returns (new items, phrases that were already there)."""
    tags = [t for t in (norm_tag(x) for x in tags) if t]
    existing = {i["id"] for i in items}
    fresh, twins = [], []
    for raw in lines:
        line = " ".join(str(raw).split())
        if not line:
            continue
        twin = find_twin(items, line)
        if twin:
            add_tags(twin, tags)
            twins.append(twin)
            continue
        base = sid = slug(line)
        n = 2
        while sid in existing:            # different texts can still slug alike
            sid, n = f"{base}-{n}", n + 1
        item = {"id": sid, "text": line, "tags": list(tags)}
        items.append(item)
        existing.add(sid)
        fresh.append(item)
    return fresh, twins


def change_tags(ids, tags, mode="set"):
    """Groups for one phrase or many. Returns the ids that were touched.

    "set" replaces and is what a single row does, where the current groups are
    filled in and you can see what disappears. Over a selection that would be
    a silent deletion — the phrases have different groups, and a filter may be
    hiding some of them — so a selection adds or removes instead, which only
    ever touches the groups you named."""
    clean = [t for t in dict.fromkeys(norm_tag(x) for x in tags) if t]
    wanted = set(ids)
    items = load_phrases()
    hit = []
    for i in items:
        if i.get("id") not in wanted:
            continue
        cur = list(i.get("tags") or [])
        if mode == "add":
            i["tags"] = cur + [t for t in clean if t not in cur]
        elif mode == "remove":
            i["tags"] = [t for t in cur if t not in clean]
        else:
            i["tags"] = clean
        hit.append(i["id"])
    if hit:
        save_phrases(items)
    return hit


def edit_text(items, pid, text):
    """Change what one phrase says. Works on `items` in place.

    The id stays as it is. It names the audio file, and that file may already
    sit on a talker or a reading pen — renaming it there is real work for a
    forgotten question mark. Correcting a text is the common case; a genuinely
    different sentence is a new phrase, not an edit.

    The fingerprint is left alone on purpose: it no longer matches the new
    text, which is exactly what marks the phrase as "needs recording".

    Returns (item, None) once changed, or (None, reason) when it cannot be:
    an empty text, an unknown id, or another phrase that already says this."""
    text = " ".join(str(text).split())
    if not text:
        return None, "An empty phrase says nothing."
    me = next((i for i in items if i.get("id") == pid), None)
    if me is None:
        return None, f"No phrase with the id '{pid}'."
    if norm_text(me["text"]) == norm_text(text):
        return me, None                      # same text, nothing to do
    twin = find_twin(items, text)
    if twin is not None and twin is not me:
        return None, (f"'{twin['id']}' already says that. "
                      f"Two phrases with the same text would be one file.")
    me["text"] = text
    return me, None


def out_format(cfg):
    return (cfg.get("output") or {}).get("format", "wav").lower().lstrip(".")


def out_file(pid, cfg):
    """Where one phrase lands. out/ is flat — one phrase, one file."""
    return OUT / f"{pid}.{out_format(cfg)}"


def output_args(cfg):
    """ffmpeg settings for the configured format."""
    out = cfg.get("output") or {}
    fmt = out_format(cfg)
    args = ["-ar", str(out.get("sample_rate", 44100)),
            "-ac", str(out.get("channels", 1))]
    if fmt == "wav":                        # otherwise ffmpeg guesses from .wav
        args += ["-c:a", "pcm_s16le"]
    if fmt in LOSSY:
        args += ["-b:a", str(out.get("bitrate") or DEFAULT_BITRATE)]
    return args


def fingerprint(text, cfg):
    """Changes when the text, the voice OR the output format changes."""
    backend = cfg["backend"]
    payload = json.dumps([text, backend, cfg.get(backend, {}), cfg.get("output", {})],
                         sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


# ------------------------------------------------------------------ Backends

def run(cmd, **kw):
    """Run a program and, when it fails, say what it said.

    check=True raises with the whole command line and an exit code, which is
    the one thing nobody can act on — and the page shows that message. ffmpeg
    and piper both explain themselves on stderr: a model that is not there, a
    format that cannot hold this audio. That sentence is what has to arrive."""
    done = subprocess.run(cmd, capture_output=True, **kw)
    if done.returncode:
        why = (done.stderr or b"").decode("utf-8", "replace").strip()
        # The last line is the complaint; everything above it is ffmpeg
        # introducing itself.
        last = why.splitlines()[-1].strip() if why else ""
        raise RuntimeError(f"{Path(cmd[0]).name}: "
                           f"{last or f'exit status {done.returncode}'}")
    return done


def tts_say(text, dest, opt):
    """Built into macOS. Good for a quick try without setup, not for the long run."""
    aiff = dest.with_suffix(".aiff")
    run(["say", "-v", opt["voice"], "-o", str(aiff), text])
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(aiff), str(dest)])
    aiff.unlink(missing_ok=True)


def tts_espeak(text, dest, opt):
    """Almost always present on Linux. Sounds robotic, but proves the chain
    works before you go looking for a good voice."""
    run([opt["binary"], "-v", opt["voice"], "-s", str(opt["speed"]),
         "-w", str(dest), text])


def tts_piper(text, dest, opt):
    """Local, offline, free, and still running the same way in ten years."""
    run([opt["binary"], "-m", opt["model"], "-f", str(dest)],
        input=text.encode("utf-8"))


def tts_azure(text, dest, opt):
    key = os.environ.get(opt["key_env"])
    if not key:
        raise RuntimeError(f"Environment variable {opt['key_env']} is not set.")
    ssml = (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
        'xml:lang="de-DE">'
        f'<voice name="{esc(opt["voice"])}">'
        f'<prosody rate="{esc(opt["rate"])}" pitch="{esc(opt["pitch"])}">'
        f'{esc(text)}</prosody>'
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
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp3), str(dest)])
    mp3.unlink(missing_ok=True)


BACKENDS = {"say": tts_say, "espeak": tts_espeak, "piper": tts_piper,
            "azure": tts_azure, "elevenlabs": tts_elevenlabs}


def esc(s):
    """XML-safe, for text and for attribute values alike."""
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                  .replace('"', "&quot;").replace("'", "&#39;"))


# ----------------------------------------------------------------- Rendering

def render(item, cfg, force=False, voice_id=None, voices=None):
    """One phrase -> raw file -> one output file. Returns True if it worked.

    voice_id records it with that voice and gives it to the phrase for good.
    Without it, a phrase keeps the voice it already has — catching up on what
    is missing must not quietly repaint the rest."""
    voices = available_voices(cfg) if voices is None else voices
    vid = voice_id or phrase_voice(item, cfg)
    vcfg = voice_config(cfg, vid, voices)
    if vcfg is None:
        # The voice a phrase was recorded with can be gone: a model deleted, a
        # key removed, another machine. Recording then falls back to the one
        # that is configured — and the phrase has to say so. Keeping the old
        # id would label it with a voice you cannot hear in the file, and the
        # row would read "ok" forever, so nothing would ever put it right.
        vcfg, vid = cfg, active_voice(cfg)
    fp = fingerprint(item["text"], vcfg)
    dest = out_file(item["id"], cfg)         # the format is not the voice's business
    if not force and item.get("fingerprint") == fp and dest.exists():
        return False

    RAW.mkdir(parents=True, exist_ok=True)
    raw = RAW / f"{item['id']}.wav"
    backend = vcfg["backend"]
    if backend not in BACKENDS:
        raise RuntimeError(f"Unknown backend '{backend}' in config.json. "
                           f"Available: {', '.join(BACKENDS)}")
    opt = vcfg[backend]
    binary = opt.get("binary") or ({"say": "say"}.get(backend))
    if binary and not shutil.which(binary):
        raise RuntimeError(f"'{binary}' is not installed — backend "
                           f"'{backend}' cannot render. "
                           f"`mitreden.py backends` shows what is available.")
    # The recording before this one is not an acceptable answer. A backend
    # that writes nothing and still exits happily used to leave the previous
    # wav lying here, and ffmpeg re-encoded that instead — a phrase that
    # failed to record came out sounding like whatever it said last time.
    raw.unlink(missing_ok=True)
    BACKENDS[backend](item["text"], raw, opt)
    if not raw.exists() or raw.stat().st_size == 0:
        raise RuntimeError(f"'{backend}' produced no audio for "
                           f"'{item['id']}'. Check the voice in config.json.")

    dest.parent.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw),
         "-af", FILTERS, *output_args(cfg), str(dest)])
    raw.unlink(missing_ok=True)     # nothing reads it again; out/ is the work

    item["fingerprint"] = fp
    item["backend"] = backend
    item["voice_id"] = vid               # the identity; the name is made from
    item.pop("voice", None)              # it on the way out, never stored
    return True


def prune_out(cfg):
    """Drop whatever in out/ no phrase claims any more.

    out/ is reproducible from phrases.json and config.json, so leftovers from
    a deleted phrase or an earlier output format are only clutter. Directories
    count as leftovers too: out/ is flat now, it used to have one per device.

    Returns what went away."""
    if not OUT.exists():
        return []
    keep = {out_file(i["id"], cfg).name for i in load_phrases()}
    gone = []
    for f in sorted(OUT.iterdir()):
        if f.is_dir():
            shutil.rmtree(f)
            gone.append(f)
        elif f.name not in keep:
            f.unlink()
            gone.append(f)
    return gone


def build(force=False, voice_id=None):
    cfg = load_config()
    voices = available_voices(cfg)      # once for the whole run
    items = load_phrases()
    if not items:
        print("phrases.json is empty. Add phrases first: mitreden.py add \"Text\"")
        return
    done = 0
    for item in items:
        try:
            if render(item, cfg, force, voice_id, voices):
                print(f"  rendered   {item['id']}  — {item['text']}")
                done += 1
        except Exception as e:
            print(f"  ERROR      {item['id']}: {e}", file=sys.stderr)
    save_phrases(items)
    gone = prune_out(cfg)
    print(f"\nRe-rendered {done} of {len(items)} phrases. Voice: {cfg['backend']}")
    if gone:
        print(f"Cleaned up {len(gone)} leftover file(s) in {OUT.name}/:")
        for f in gone[:5]:
            print(f"  removed    {f.name}")
        if len(gone) > 5:
            print(f"  ... and {len(gone) - 5} more")
    print(f"Files are in {OUT} as .{out_format(cfg)}")


def phrase_voice(item, cfg):
    """The voice this phrase is measured against: its own, or — for one that
    was never recorded — whatever is currently selected."""
    return item.get("voice_id") or active_voice(cfg)


def phrase_state(item, cfg, voices=None):
    """ok = current, missing = never rendered, stale = the text or the format
    moved on since it was recorded.

    Choosing another voice does not make a phrase stale any more. It keeps the
    one it was recorded with until someone records it again — which is the
    whole point of being able to mix them."""
    if not out_file(item["id"], cfg).exists():
        return "missing"
    vcfg = voice_config(cfg, phrase_voice(item, cfg), voices) or cfg
    if item.get("fingerprint") != fingerprint(item["text"], vcfg):
        return "stale"
    return "ok"


LANGS = ROOT / "lang"


def strings():
    """Every language the interface can speak, by code.

    The files sit next to the program, not next to your phrases: they are part
    of mitreden, not of what you write with it. A missing or broken file costs
    that one language, not the page."""
    out = {}
    for f in sorted(LANGS.glob("*.json")):
        try:
            out[f.stem] = json.loads(f.read_text())
        except Exception as e:
            print(f"  skipping {f.name}: {e}", file=sys.stderr)
    return out


# Which services can be unlocked with a key, and what else they need. Azure
# keys are bound to a region, so asking for the key alone would hand people a
# 401 and no idea why.
CLOUD = {"azure": {"label": "Azure Speech", "region": True},
         "elevenlabs": {"label": "ElevenLabs", "region": False}}


def env_file():
    return DATA / ".env"


def set_env_var(name, value):
    """Put one variable into the .env beside your phrases, keeping the rest.

    The file is written for you alone (0600). An empty value removes the line;
    the running process is updated too, so a new key works without a restart."""
    if value and ("\n" in value or "\r" in value):
        # One variable per line is the whole format. A value carrying its own
        # line break would quietly write a second variable nobody asked for.
        raise ValueError("A key cannot contain a line break.")
    lines = []
    if env_file().exists():
        lines = [l for l in env_file().read_text().splitlines()
                 if not l.strip().startswith(f"{name}=")]
    if value:
        lines.append(f"{name}={value}")
        os.environ[name] = value
    else:
        os.environ.pop(name, None)
    DATA.mkdir(parents=True, exist_ok=True)
    write_atomic(env_file(), "\n".join(lines) + ("\n" if lines else ""), 0o600)


def azure_ok(region, key):
    """Ask Azure whether this key works here. A key belongs to one region, and
    the wrong pairing fails with 401 — better to say so while someone is still
    looking at the field than at the first recording."""
    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/voices/list"
    req = urllib.request.Request(url, headers={"Ocp-Apim-Subscription-Key": key})
    with urllib.request.urlopen(req, timeout=15) as r:
        return len(json.load(r))


def setup_state(cfg):
    """What can be unlocked, and what already is. Never the key itself."""
    out = []
    for name, meta in CLOUD.items():
        opt = cfg.get(name) or {}
        out.append({"id": name, "label": meta["label"],
                    "key_env": opt.get("key_env", ""),
                    "set": bool(os.environ.get(opt.get("key_env", ""))),
                    "needs_region": meta["region"],
                    "region": opt.get("region", "")})
    return {"cloud": out, "voices": len(available_voices(cfg))}


def piper_models():
    """Every piper model on this machine, by name. The .onnx.json beside it is
    piper's own and has to be there, so a lone .onnx is not a usable voice."""
    found = {}
    for d in VOICE_DIRS:
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.onnx")):
            if f.with_suffix(".onnx.json").exists() and f.stem not in found:
                found[f.stem] = f
    return found


def pretty_piper(stem):
    """de_DE-thorsten-medium -> Thorsten. The quality tier is part of the file
    name, not of the voice — it does not belong in a picker."""
    rest = stem.split("-", 1)[1] if "-" in stem else stem
    return rest.partition("-")[0].replace("_", " ").title()


def label_of(name, backend, lang=""):
    """Name, where it comes from, and which language it speaks — the three
    things that tell two entries in the picker apart."""
    return " \u00b7 ".join(p for p in (name, backend, lang) if p)


def lang_of(tag):
    """de_DE-thorsten-medium, de-DE-GiselaNeural, de -> de"""
    return tag.replace("_", "-").split("-")[0].lower() if tag else ""


AZURE_CACHE_DAYS = 7


def azure_voices(cfg):
    """The voices Azure offers for the configured language.

    Asked of Azure itself rather than kept as a list in here: a hand-typed
    list goes stale, and it would offer German voices to someone who set up
    French. The answer is cached — this runs on every page load, and it barely
    changes from one month to the next.

    Whatever config.json names is always in the result, even offline. An empty
    picker, or one without the voice you are currently using, would be worse
    than a slightly old list."""
    opt = cfg.get("azure") or {}
    mine = opt.get("voice") or ""
    # Which languages to offer. "de" takes every German locale, "de-DE" only
    # that one. Without the setting it stays at the language of the configured
    # voice — Azure has 556 voices, and a picker with all of them is no picker.
    want = [w.lower() for w in (opt.get("languages") or [])]
    if not want:
        want = ["-".join(mine.split("-")[:2]).lower()] if mine else []
    cache = DATA / ".azure-voices.json"
    try:
        age = time.time() - cache.stat().st_mtime
        if age < AZURE_CACHE_DAYS * 86400:
            known = json.loads(cache.read_text())
            if known.get("want") == want:
                return known["voices"]
    except Exception:
        pass
    try:
        url = (f"https://{opt['region']}.tts.speech.microsoft.com"
               f"/cognitiveservices/voices/list")
        req = urllib.request.Request(
            url, headers={"Ocp-Apim-Subscription-Key":
                          os.environ.get(opt.get("key_env", ""), "")})
        with urllib.request.urlopen(req, timeout=10) as r:
            names = sorted(v["ShortName"] for v in json.load(r)
                           if any(v.get("Locale", "").lower() == w
                                  or v.get("Locale", "").lower().startswith(w + "-")
                                  for w in want))
        if mine and mine not in names:
            names.append(mine)          # configured by hand, keep it usable
        DATA.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({"want": want, "voices": names}))
        return names
    except Exception:
        return [mine] if mine else []


def available_voices(cfg):
    """What this installation can actually speak with, right now.

    A voice nobody can use is worse than no choice at all: it turns into a
    failed recording later. So a cloud voice only shows up once its key is
    there, and a local one only once the program behind it exists."""
    out = []
    for stem, path in piper_models().items():
        out.append({"id": f"piper:{stem}",
                    "label": label_of(pretty_piper(stem), "piper", lang_of(stem)),
                    "backend": "piper", "model": str(path)})
    opt = cfg.get("azure") or {}
    if os.environ.get(opt.get("key_env", "")):
        for name in azure_voices(cfg):
            out.append({"id": f"azure:{name}",
                        "label": label_of(short_voice(name), "azure", lang_of(name)),
                        "backend": "azure", "voice": name})
    opt = cfg.get("elevenlabs") or {}
    if os.environ.get(opt.get("key_env", "")):
        out.append({"id": "elevenlabs", "label": "ElevenLabs",
                    "backend": "elevenlabs"})
    for backend in ("say", "espeak"):
        opt = cfg.get(backend) or {}
        binary = opt.get("binary") or backend
        if shutil.which(binary):
            out.append({"id": backend,
                        "label": label_of(opt.get("voice", backend), backend,
                                          lang_of(opt["voice"]) if backend == "espeak"
                                          else ""),
                        "backend": backend})
    active = active_voice(cfg)
    for v in out:
        v["active"] = v["id"] == active
    return out


def short_voice(name):
    """de-DE-GiselaNeural -> Gisela, de-DE-FlorianMultilingualNeural -> Florian
    Multilingual. Nobody needs the locale twice, it is in every entry."""
    if name.count("-") < 2:
        return name
    base = name.split("-")[-1].replace("Neural", "")
    out = ""
    for i, ch in enumerate(base):
        if i and ch.isupper() and base[i - 1].islower():
            out += " "
        out += ch
    return out


def active_voice(cfg):
    """Which catalogue entry the config currently points at."""
    backend = cfg.get("backend")
    if backend == "piper":
        return f"piper:{Path((cfg.get('piper') or {}).get('model', '')).stem}"
    if backend == "azure":
        return f"azure:{(cfg.get('azure') or {}).get('voice', '')}"
    return backend


def voice_config(cfg, vid, voices=None):
    """A copy of cfg pointed at one voice. Nothing is written.

    This is what lets one phrase be recorded with Thorsten while the next
    keeps Gisela: rendering never reads the configured voice directly, it
    reads the voice that phrase was given."""
    catalogue = voices if voices is not None else available_voices(cfg)
    chosen = next((v for v in catalogue if v["id"] == vid), None)
    if chosen is None:
        return None
    out = json.loads(json.dumps(cfg))
    out["backend"] = chosen["backend"]
    if chosen["backend"] == "piper":
        out.setdefault("piper", {})["model"] = chosen["model"]
    if chosen["backend"] == "azure":
        out.setdefault("azure", {})["voice"] = chosen["voice"]
    return out


def voice_name(cfg, vid, voices=None):
    """The label of one catalogue entry.

    A voice can be missing here and still be the one a phrase was recorded
    with — another machine, a key that is gone, a model that was deleted. The
    name is then built from the id, because "azure:de-DE-GiselaNeural" is
    something nobody should have to read."""
    for v in voices if voices is not None else available_voices(cfg):
        if v["id"] == vid:
            return v["label"]
    kind, _, rest = vid.partition(":")
    if kind == "piper" and rest:
        return label_of(pretty_piper(rest), "piper", lang_of(rest))
    if kind == "azure" and rest:
        return label_of(short_voice(rest), "azure", lang_of(rest))
    return vid


def use_voice(cfg, vid):
    """Point the config at one voice from the catalogue and write it down.

    Returns the new label, or None if that voice is not on offer. Everything
    else follows by itself: the voice is part of the fingerprint, so every
    phrase turns stale and asks to be recorded again."""
    fresh = voice_config(cfg, vid)
    if fresh is None:
        return None
    cfg.clear()
    cfg.update(fresh)
    # Only the backend and its own settings go back into the file. What
    # load_config fills in from the defaults belongs in memory, not on disk —
    # otherwise a config.json someone wrote by hand grows four backends they
    # never asked for, every time they pick a voice.
    raw = json.loads(CONFIG.read_text()) if CONFIG.exists() else {}
    raw["backend"] = cfg["backend"]
    raw[cfg["backend"]] = cfg[cfg["backend"]]   # complete, for the one in use
    write_atomic(CONFIG, json.dumps(raw, indent=2, ensure_ascii=False) + "\n")
    return voice_name(cfg, vid)


def voice_label(cfg, voices=None):
    """Voice name for the interface, e.g. de-DE-GiselaNeural -> Gisela."""
    mine = active_voice(cfg)
    for v in voices if voices is not None else available_voices(cfg):
        if v["id"] == mine:
            return v["label"]
    opt = cfg.get(cfg["backend"], {})       # configured, but not usable here
    name = opt.get("voice") or cfg["backend"]
    return name.split("-")[-1].replace("Neural", "") if name.count("-") >= 2 else name


def phrases_with_state():
    """The list as the page needs it: state and voice name per phrase.

    Both are worked out here rather than kept in phrases.json. A name is how
    something is shown, not what it is — storing it means an old entry keeps
    an old spelling forever, and the voice filter then sees one voice as two.
    The catalogue is built once for the whole list; it used to be rebuilt for
    every single phrase."""
    cfg = load_config()
    voices = available_voices(cfg)
    items = [dict(i, tags=i.get("tags") or [],
                  state=phrase_state(i, cfg, voices),
                  voice=voice_name(cfg, phrase_voice(i, cfg), voices))
             for i in load_phrases()]
    return {"items": items, "voice": voice_label(cfg, voices),
            "format": out_format(cfg)}


def remove_files(pid):
    """Every file this phrase produced, in whatever format. Missing ones are fine.

    The glob catches leftovers from an earlier output format too."""
    removed = []
    for f in sorted(OUT.glob(f"{pid}.*")) + [RAW / f"{pid}.wav"]:
        if f.exists():
            f.unlink()
            removed.append(f)
    return removed


def delete_phrases(ids):
    """Drop several phrases and everything they produced, in one pass.

    One read and one write, however many were picked. Deleting them one at a
    time rewrote the whole file per phrase, and each rewrite was a chance to
    be interrupted half way through the list.

    The list is saved before the audio goes: a file with no phrase is clutter
    that `build` clears up by itself, while a phrase with no file would ask
    to be recorded again forever.

    Returns (ids that were there, files that went away)."""
    items = load_phrases()
    wanted = {str(i).strip() for i in ids if str(i).strip()}
    gone = [i["id"] for i in items if i.get("id") in wanted]
    if not gone:
        return [], []
    save_phrases([i for i in items if i.get("id") not in wanted])
    removed = []
    for pid in gone:
        removed += remove_files(pid)
    return gone, removed


def delete_phrase(pid):
    """One phrase. Returns (True, deleted_files), or (False, []) if unknown."""
    gone, removed = delete_phrases([pid])
    return bool(gone), removed


def dedupe(apply=False):
    """Merge phrases that say the same thing.

    Groups make duplicates easy to create by hand, and phrase sets that grew
    before groups existed have them anyway. The oldest entry wins, takes over
    the groups of the others, and their audio files go away.

    Nothing is written unless apply=True. phrases.json is the only copy these
    sentences have, so the merge is worth seeing before it happens.

    Returns (kept, merges) where a merge is (dropped phrase, phrase it joins)."""
    keep, merges, seen = [], [], {}
    for it in load_phrases():
        twin = seen.get(norm_text(it["text"]))
        if twin:
            add_tags(twin, it.get("tags") or [])   # in memory until we save
            merges.append((it, twin))
        else:
            seen[norm_text(it["text"])] = it
            keep.append(it)
    if merges and apply:
        save_phrases(keep)                      # the list first, as above
        for dropped, _ in merges:
            remove_files(dropped["id"])
    return keep, merges


def in_group(item, tag):
    return not tag or tag in (item.get("tags") or [])


def selected_ids(ids):
    """Only ids that really exist — never build a path out of raw input."""
    known = {i["id"] for i in load_phrases()}
    return [pid for pid in ids if pid in known]


def as_format(f, fmt, cfg):
    """One finished file in another container. The audio is not touched again
    beyond the format change — it was trimmed and levelled when it was made."""
    with tempfile.TemporaryDirectory() as tmp:
        conv = Path(tmp) / f"{f.stem}.{fmt}"
        args = output_args(dict(cfg, output=dict(cfg.get("output") or {}, format=fmt)))
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(f),
             *args, str(conv)])
        return conv.read_bytes()


def zip_phrases(ids, cfg, fmt=None):
    """The current selection as one flat download, named by id.

    fmt converts on the way out, for the device that wants something else than
    what is in out/. It converts the finished file, not the raw recording, so
    what you get is the same audio — trimmed and levelled — in another
    container. out/ itself is left alone."""
    fmt = (fmt or "").lower().lstrip(".") or out_format(cfg)
    buf = io.BytesIO()
    n = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for pid in selected_ids(ids):
            f = out_file(pid, cfg)
            if not f.exists():
                continue
            if fmt == out_format(cfg):
                z.write(f, f.name)
            else:
                z.writestr(f"{pid}.{fmt}", as_format(f, fmt, cfg))
            n += 1
    return buf.getvalue(), n


def export_group(tag, dest, cfg):
    """Copy one group into a folder, for carrying it somewhere else.

    Returns (copied names, ids that are not recorded yet)."""
    tag = norm_tag(tag) if tag else ""
    dest = Path(dest).expanduser()
    dest.mkdir(parents=True, exist_ok=True)
    copied, missing = [], []
    for item in load_phrases():
        if not in_group(item, tag):
            continue
        f = out_file(item["id"], cfg)
        if f.exists():
            shutil.copy2(f, dest / f.name)
            copied.append(f.name)
        else:
            missing.append(item["id"])
    return copied, missing


# ------------------------------------------------------------------------ UI

UI = ROOT / "ui.html"        # the page itself, part of the program


def page():
    r"""The interface, read fresh so that editing ui.html needs no restart.

    It lives beside the program, the way icon.svg and lang/ already do: it is
    part of mitreden, not of what you write with it.

    As a string inside this file it was 779 lines of HTML, CSS and JavaScript
    that no editor could colour, check or indent — and every backslash had to
    be written twice, because Python ate one before the browser ever saw it.
    The same character needed \u22ee in the JavaScript and ⚙ in the HTML
    a few lines above it, which is not a difference anyone can see."""
    try:
        return UI.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise RuntimeError(f"ui.html is missing from {ROOT}. It belongs next "
                           f"to mitreden.py, like icon.svg and lang/ do.")


# One recording at a time, one write at a time. See route_post below.
STATE_LOCK = threading.Lock()


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.answered = True

    def log_request(self, *a):
        pass                # the access log is noise on your own machine

    def guard(self, work):
        """Answer every request, including the ones that go wrong.

        An exception used to travel straight out of the handler and close the
        socket without a word. The page then fell over on `await r.text()`
        — there was no text, so the button simply died and said nothing. The
        interface is built to show what went wrong; it can only do that if
        something comes back.

        Whatever already answered stays answered: a handler that fails half
        way through has said its piece, and a second reply on the same socket
        would only garble it."""
        try:
            work()
        except (BrokenPipeError, ConnectionResetError):
            pass                      # the browser left mid-answer, fine
        except json.JSONDecodeError:
            self.trouble(400, "That was not valid JSON.")
        except Exception as e:
            # The name matters as much as the text: a bare "returned non-zero
            # exit status 1" at least says CalledProcessError, so it is clear
            # the recording failed and not the request.
            self.trouble(500, f"{type(e).__name__}: {e}")

    def trouble(self, code, why):
        if getattr(self, "answered", False):
            return
        try:
            self._send(code, why, "text/plain; charset=utf-8")
        except OSError:
            pass                      # the socket is gone too; nothing to do

    def do_GET(self):
        self.guard(self.route_get)

    def do_POST(self):
        self.guard(self.route_post)

    def route_get(self):
        # The path, without whatever the page appended for its own state. A
        # link with ?lang=de is still the page, not a different one.
        route = urllib.parse.urlsplit(self.path).path
        if route == "/":
            return self._send(200, page(), "text/html; charset=utf-8")
        if route == "/icon.svg":
            if not ICON.exists():
                return self._send(404, b"", "text/plain")
            return self._send(200, ICON.read_bytes(), "image/svg+xml")
        if route.startswith("/audio/"):
            # The id alone is enough — the server knows the configured format,
            # so the page never has to care what it is. ?format= asks for a
            # different one, ?dl=1 makes the browser save instead of play.
            url = urllib.parse.urlsplit(self.path)
            query = urllib.parse.parse_qs(url.query)
            pid = Path(url.path).name
            cfg = load_config()
            f = out_file(pid, cfg)
            if ".." in url.path or "/" in pid or not f.exists():
                return self._send(404, b"", "text/plain")
            fmt = (query.get("format", [""])[0] or "").lower().lstrip(".")
            if fmt and fmt != out_format(cfg):
                if fmt not in MIME:
                    return self._send(400, "Unknown format.", "text/plain")
                body, name = as_format(f, fmt, cfg), f"{pid}.{fmt}"
            else:
                body, name = f.read_bytes(), f.name
            extra = ({"Content-Disposition": f'attachment; filename="{name}"'}
                     if query.get("dl") else None)
            return self._send(200, body,
                              MIME.get(name.rsplit(".", 1)[-1], "application/octet-stream"),
                              extra)
        if route == "/api/phrases":
            return self._send(200, json.dumps(phrases_with_state(),
                                              ensure_ascii=False))
        if route == "/api/setup":
            return self._send(200, json.dumps(setup_state(load_config()),
                                              ensure_ascii=False))
        if route == "/api/strings":
            return self._send(200, json.dumps(strings(), ensure_ascii=False))
        if route == "/api/voices":
            return self._send(200, json.dumps(available_voices(load_config()),
                                              ensure_ascii=False))
        self._send(404, b"", "text/plain")

    def same_site(self):
        """Whether this POST came from the page itself.

        The interface has no login — it is yours because it listens on your
        machine. But a browser will happily send a request to localhost on
        behalf of any site you have open in another tab, and a POST with a
        plain Content-Type needs no permission from us first. That was enough
        to delete every phrase from a page nobody here wrote.

        Two things a foreign page cannot fake: the Origin header, which the
        browser sets and no script can change, and application/json, which
        does not go out without asking us first. Requiring both leaves the
        page working and everything else outside."""
        origin = self.headers.get("Origin")
        if origin and origin not in (f"http://{self.headers.get('Host', '')}",
                                     f"https://{self.headers.get('Host', '')}"):
            return False
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip()
        return ctype == "application/json"

    def route_post(self):
        if not self.same_site():
            return self._send(403, "This request did not come from mitreden.",
                              "text/plain")
        try:
            n = int(self.headers.get("Content-Length", 0))
        except ValueError:
            return self._send(400, "Content-Length is not a number.", "text/plain")
        data = json.loads(self.rfile.read(n) or "{}")
        route = urllib.parse.urlsplit(self.path).path   # same rule as route_get
        # Reading happens side by side, changing does not. Every route below
        # loads phrases.json, works on it and writes it back; two of them at
        # once would each save a copy that never saw the other, and the second
        # one wins. The lock is around the change, not around the server —
        # playing a file or opening the page never waits for a recording.
        with STATE_LOCK:
            return self.change(route, data)

    def change(self, route, data):
        cfg = load_config()
        items = load_phrases()

        if route == "/api/phrases":
            fresh, twins = add_lines(items, data.get("lines", []),
                                     data.get("tags", []))
            # A phrase that cannot be recorded is still a phrase: it is in the
            # file, it shows up in the list, and it asks to be recorded again.
            # Failing the whole request over one of them meant the others were
            # added too and the page was told it had failed — so it did not
            # reload, and they only turned up the next time you opened it.
            rendered, failed = 0, []
            for item in fresh:
                try:
                    rendered += 1 if render(item, cfg) else 0
                except Exception as e:
                    failed.append(f"{item['id']}: {e}")
            save_phrases(items)
            return self._send(200, json.dumps({"added": len(fresh),
                                               "rendered": rendered,
                                               "merged": len(twins),
                                               "failed": failed},
                                              ensure_ascii=False))

        if route == "/api/tags":
            ids = data.get("ids") or [data.get("id") or ""]
            ids = [str(i).strip() for i in ids if str(i).strip()]
            mode = data.get("mode", "set")
            if mode not in ("set", "add", "remove"):
                return self._send(400, "Unknown mode.", "text/plain")
            hit = change_tags(ids, data.get("tags", []), mode)
            if not hit:
                return self._send(404, "No phrase with that id.", "text/plain")
            return self._send(200, json.dumps({"ok": True, "ids": hit,
                                               "mode": mode}, ensure_ascii=False))

        if route == "/api/edit":
            pid = (data.get("id") or "").strip()
            item, why = edit_text(items, pid, data.get("text", ""))
            if why:
                return self._send(404 if "No phrase" in why else 400,
                                  why, "text/plain")
            failed = []
            try:
                rendered = render(item, cfg)     # right away, like adding does
            except Exception as e:
                rendered, failed = False, [f"{item['id']}: {e}"]
            save_phrases(items)                  # the new text is the point
            return self._send(200, json.dumps({"ok": True, "id": item["id"],
                                               "text": item["text"],
                                               "rendered": bool(rendered),
                                               "failed": failed},
                                              ensure_ascii=False))

        if route == "/api/voice":
            label = use_voice(cfg, (data.get("id") or "").strip())
            if label is None:
                return self._send(404, "That voice is not available here.",
                                  "text/plain")
            # Nothing is recorded and nothing turns stale: this only says what
            # the next recording should sound like.
            return self._send(200, json.dumps({"ok": True, "label": label},
                                              ensure_ascii=False))

        if route == "/api/setup":
            name = (data.get("backend") or "").strip()
            if name not in CLOUD:
                return self._send(400, "Unknown service.", "text/plain")
            opt = cfg.get(name) or {}
            var = opt.get("key_env")
            if not var:
                return self._send(400, "No key_env in config.json.", "text/plain")
            key = (data.get("key") or "").strip()
            if "\n" in key or "\r" in key:
                return self._send(400, "A key cannot contain a line break.",
                                  "text/plain")
            if not key:                       # empty field means: forget it
                set_env_var(var, "")
                return self._send(200, json.dumps({"ok": True, "set": False}))
            region = (data.get("region") or opt.get("region") or "").strip()
            if CLOUD[name]["region"]:
                if not region:
                    return self._send(400, "A region is required.", "text/plain")
                try:
                    azure_ok(region, key)     # say now, not at the first recording
                except Exception as e:
                    return self._send(400, f"{e}", "text/plain")
                if region != opt.get("region"):
                    raw = json.loads(CONFIG.read_text()) if CONFIG.exists() else {}
                    raw.setdefault(name, dict(opt))["region"] = region
                    write_atomic(CONFIG, json.dumps(raw, indent=2,
                                                    ensure_ascii=False) + "\n")
            set_env_var(var, key)
            (DATA / ".azure-voices.json").unlink(missing_ok=True)   # ask again
            return self._send(200, json.dumps(
                {"ok": True, "set": True,
                 "voices": len(available_voices(load_config()))}))

        if route == "/api/download":
            fmt = (data.get("format") or "").lower().lstrip(".")
            if fmt and fmt not in MIME:
                return self._send(400, "Unknown format.", "text/plain")
            blob, n = zip_phrases(data.get("ids", []), cfg, fmt)
            if not n:
                return self._send(404, "Nothing recorded to download.", "text/plain")
            return self._send(200, blob, "application/zip")

        if route == "/api/build":
            force = bool(data.get("force"))
            only = set(data.get("ids") or [])     # empty = everything
            vid = (data.get("voice") or "").strip() or None
            voices = available_voices(cfg)     # once for the whole request
            rendered = 0
            for item in items:
                if only and item["id"] not in only:
                    continue
                try:
                    rendered += 1 if render(item, cfg, force, vid, voices) else 0
                except Exception as e:
                    save_phrases(items)
                    return self._send(500, str(e), "text/plain")
            save_phrases(items)
            return self._send(200, json.dumps({"rendered": rendered}))

        if route == "/api/delete":
            ids = data.get("ids") or [data.get("id") or ""]
            ids = [str(i).strip() for i in ids if str(i).strip()]
            if not ids:
                return self._send(400, "No id provided.", "text/plain")
            gone, _ = delete_phrases(ids)
            if not gone:
                return self._send(404, "No phrase with that id.", "text/plain")
            return self._send(200, json.dumps({"ok": True, "ids": gone},
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
    load_env()
    args = sys.argv[1:]
    cmd = args[0] if args else "ui"

    if cmd == "ui":
        load_config()
        host, port, rest, i = "127.0.0.1", 8770, args[1:], 0
        while i < len(rest):
            a = rest[i]
            if a == "--host" and i + 1 < len(rest):
                i += 1
                host = rest[i]
            elif a.startswith("--host="):
                host = a.split("=", 1)[1]
            elif a == "--port" and i + 1 < len(rest):
                i += 1
                port = int(rest[i])
            elif a.startswith("--port="):
                port = int(a.split("=", 1)[1])
            i += 1
        # Localhost by default: the interface has no login, so it stays on this
        # machine unless you say otherwise. In a container --host 0.0.0.0 is
        # the only way the port forward reaches it.
        shown = "localhost" if host in ("127.0.0.1", "0.0.0.0") else host
        print(f"mitreden is running at http://{shown}:{port}  (Ctrl-C to stop)")
        if host == "0.0.0.0":
            print("Listening on every address — keep this off the open internet.")
        # Threading, because recording is slow: piper and ffmpeg run per
        # phrase, and `build --all` over a few hundred of them held the only
        # thread there was. The page went dead for minutes — no list, no
        # playing, nothing. Now only the recording waits for the recording.
        http.server.ThreadingHTTPServer((host, port), Handler).serve_forever()
    elif cmd == "add":
        text, tags, rest, i = None, [], args[1:], 0
        while i < len(rest):
            a = rest[i]
            if a in ("--tag", "--tags") and i + 1 < len(rest):
                i += 1
                tags = rest[i].split(",")
            elif a.startswith("--tag=") or a.startswith("--tags="):
                tags = a.split("=", 1)[1].split(",")
            elif a.startswith("-"):
                # Without this, `add --tag` with nothing after it fell through
                # and became a phrase that says "--tag", recorded and all.
                sys.exit(f"'{a}' is not an option here, or it is missing its "
                         f"value.\nUsage: mitreden.py add \"The phrase\" "
                         f"[--tags kindergarten,spiel]")
            elif text is None:
                text = a
            else:
                sys.exit(f"One phrase at a time — I do not know what to do "
                         f"with \"{a}\".\nFor several at once put them in "
                         f"phrases.json, or use the web interface.")
            i += 1
        if not text:
            sys.exit('Usage: mitreden.py add "The phrase" [--tags kindergarten,spiel]')
        items = load_phrases()
        fresh, twins = add_lines(items, [text], tags)
        save_phrases(items)
        for item in fresh:
            print(f"added: {item['id']}" +
                  (f"  [{', '.join(item['tags'])}]" if item["tags"] else ""))
        for item in twins:
            print(f"already there: {item['id']} — \"{item['text']}\"" +
                  (f"  [{', '.join(item['tags'])}]" if item.get("tags") else ""))
        build()
    elif cmd == "delete":
        if len(args) < 2:
            sys.exit("Usage: mitreden.py delete <id>")
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
            print(f"  removed    {f.relative_to(DATA)}")
        if not removed:
            print("  (no audio files present)")
    elif cmd == "edit":
        if len(args) < 3:
            sys.exit('Usage: mitreden.py edit <id> "The corrected text"')
        items = load_phrases()
        before = next((i["text"] for i in items if i.get("id") == args[1]), None)
        item, why = edit_text(items, args[1], args[2])
        if why:
            print(why, file=sys.stderr)
            sys.exit(1)
        if item["text"] == before:
            print(f"unchanged: {item['id']} — \"{item['text']}\"")
            return
        save_phrases(items)
        print(f"edited: {item['id']} — \"{item['text']}\"")
        build()
    elif cmd == "dedupe":
        apply = "--apply" in args
        keep, merges = dedupe(apply)
        if not merges:
            print(f"No duplicates. {len(keep)} phrases, all different.")
            return
        for dropped, twin in merges:
            print(f"  {dropped['id']} — \"{dropped['text']}\"")
            print(f"    joins {twin['id']}" +
                  (f"  [{', '.join(twin['tags'])}]" if twin.get("tags") else ""))
        if apply:
            print(f"\n{len(merges)} merged away, {len(keep)} phrases left.")
        else:
            print(f"\n{len(merges)} would be merged, {len(keep)} would remain. "
                  f"Nothing was changed.")
            print("Run `mitreden.py dedupe --apply` to actually do it.")
    elif cmd == "export":
        if len(args) < 3:
            sys.exit("Usage: mitreden.py export <group|all> <folder>")
        tag = "" if args[1] in ("all", "*") else args[1]
        copied, missing = export_group(tag, args[2], load_config())
        print(f"exported {len(copied)} files to {args[2]}")
        for pid in missing:
            print(f"  not recorded yet   {pid}", file=sys.stderr)
    elif cmd == "build":
        vid = None
        for i, a in enumerate(args):
            if a == "--voice" and i + 1 < len(args):
                vid = args[i + 1]
            elif a.startswith("--voice="):
                vid = a.split("=", 1)[1]
        build(force="--all" in args or vid is not None, voice_id=vid)
    elif cmd == "voices":
        cfg = load_config()
        found = available_voices(cfg)
        if not found:
            print("No usable voice here. Install piper, or set a key.")
            return
        for v in found:
            print(f"  {'*' if v['active'] else ' '} {v['id']:<28} {v['label']}")
        print("\nSwitch with: mitreden.py voice <id>")
    elif cmd == "voice":
        if len(args) < 2:
            sys.exit("Usage: mitreden.py voice <id>   (mitreden.py voices lists them)")
        cfg = load_config()
        label = use_voice(cfg, args[1])
        if label is None:
            print(f"'{args[1]}' is not available here.", file=sys.stderr)
            print("Available: " + ", ".join(v["id"] for v in available_voices(cfg)),
                  file=sys.stderr)
            sys.exit(1)
        print(f"voice: {label}")
        print("Everything recorded from now on uses it. Existing phrases keep "
              "theirs — move them over with:")
        print(f"  mitreden.py build --all --voice {args[1]}")
    elif cmd == "backends":
        check_backends()
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
