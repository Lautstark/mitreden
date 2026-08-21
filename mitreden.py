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

Note: everything a person reads is German — the web interface, the README and
the spoken content itself (phrases.json, the voice settings in config.json).
English is for the code only: identifiers, comments, docstrings, CLI output.
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


def load_config():
    if not CONFIG.exists():
        DATA.mkdir(parents=True, exist_ok=True)   # a fresh mount is empty
        CONFIG.write_text(json.dumps(first_config(), indent=2,
                                     ensure_ascii=False) + "\n")
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

def render(item, cfg, force=False, voice_id=None, voices=None):
    """One phrase -> raw file -> one output file. Returns True if it worked.

    voice_id records it with that voice and gives it to the phrase for good.
    Without it, a phrase keeps the voice it already has — catching up on what
    is missing must not quietly repaint the rest."""
    voices = available_voices(cfg) if voices is None else voices
    vid = voice_id or phrase_voice(item, cfg)
    vcfg = voice_config(cfg, vid, voices) or cfg   # the voice may be gone here
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
    BACKENDS[backend](item["text"], raw, opt)

    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw),
                    "-af", FILTERS, *output_args(cfg), str(dest)], check=True)

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
    env_file().write_text("\n".join(lines) + ("\n" if lines else ""))
    try:
        env_file().chmod(0o600)
    except OSError:
        pass                    # some mounted filesystems do not allow it


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
    CONFIG.write_text(json.dumps(raw, indent=2, ensure_ascii=False) + "\n")
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


def delete_phrase(pid):
    """Drop a phrase from phrases.json and delete every WAV it produced.

    Returns (True, deleted_files), or (False, []) if the id does not exist."""
    items = load_phrases()
    rest = [i for i in items if i.get("id") != pid]
    if len(rest) == len(items):
        return False, []
    removed = remove_files(pid)
    save_phrases(rest)
    return True, removed


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
        for dropped, _ in merges:
            remove_files(dropped["id"])
        save_phrases(keep)
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
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(f),
                        *args, str(conv)], check=True)
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

PAGE = """<!doctype html><html lang="de"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>mitreden</title>
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<style>
:root{
  color-scheme:dark;               /* so the OS draws its own widgets dark too */
  --ink:#0e1014; --panel:#161920; --line:#242833; --line-soft:#1c202a;
  --text:#f2efea; --muted:#7c8496; --accent:#ff8bc7; --accent-ink:#14161c;
  --ok:#3fb96b; --warn:#f0a202; --miss:#5b6377; --danger:#e5484d;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ink);color:var(--text);
  font:16px/1.55 ui-sans-serif,system-ui,"Segoe UI",sans-serif;
  padding:clamp(20px,5vw,64px);-webkit-font-smoothing:antialiased}
main{max-width:720px;margin:0 auto}
h1{font-size:clamp(30px,6vw,46px);font-weight:800;letter-spacing:-.035em;margin:0;
  display:flex;align-items:center;gap:12px}
.logo{width:clamp(34px,7vw,52px);height:auto;flex:none}
.sub{color:var(--muted);margin:6px 0 36px;font-size:15px}
.hero{background:var(--panel);border:1px solid var(--line);border-radius:16px;
  padding:22px 22px 16px}
label{display:block;font-size:13px;color:var(--muted);margin-bottom:10px}
label.tight{margin-top:14px}
textarea{width:100%;min-height:132px;resize:vertical;background:var(--ink);
  color:var(--text);border:1px solid var(--line);border-radius:11px;padding:14px;
  font:inherit;font-size:19px}
textarea::placeholder,input::placeholder{color:#4d5464}
textarea:focus,input:focus,button:focus-visible{
  outline:2px solid var(--accent);outline-offset:2px}
input[type=text],input[type=search],input[type=password]{width:100%;background:var(--ink);color:var(--text);
  border:1px solid var(--line);border-radius:10px;padding:11px 13px;font:inherit;font-size:15px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px}
button{font:inherit;font-weight:600;border-radius:10px;padding:11px 18px;
  border:1px solid var(--line);background:transparent;color:var(--text);cursor:pointer}
button:hover{background:#1e222c}
button:disabled{opacity:.4;cursor:default}
button:disabled:hover{background:transparent}
button.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
button.primary:hover{background:#ffa3d2}
button.quiet{border-color:transparent;color:var(--muted);padding:11px 12px}
button.quiet:hover{color:var(--text)}
/* No placeholder line: an empty status reserves a gap for nothing. */
.status{color:var(--muted);font-size:14px;margin:12px 2px 0}
.status[hidden]{display:none}
.bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  margin:40px 2px 4px;padding-bottom:14px;border-bottom:1px solid var(--line)}
.bar .count{font-weight:650;font-size:15px}
/* Beside the title, where a page-wide setting belongs — not down at the list,
   which would suggest it changes something about the list. */
.top{display:flex;align-items:center;gap:10px}
.gear{font-size:17px;line-height:1;padding:7px 11px;border-radius:999px;
  color:var(--muted);border-color:var(--line)}
.gear:hover{color:var(--text)}
/* A sheet, not a wizard: a fresh install already speaks, so this is somewhere
   you go when you want more — never something standing in the way. */
.sheet{background:var(--panel);color:var(--text);border:1px solid var(--line);
  border-radius:16px;padding:24px;max-width:520px;width:calc(100% - 40px)}
.sheet::backdrop{background:rgba(0,0,0,.6)}
.sheet h2{margin:0 0 6px;font-size:20px;letter-spacing:-.02em}
.sheet .sub{margin:0 0 14px}
.sheet .warn{color:var(--warn);font-size:13px;line-height:1.5;margin:0 0 18px}
.svc{border-top:1px solid var(--line-soft);padding:16px 0}
.svc h3{margin:0 0 2px;font-size:15px}
.svc .state{font-size:13px;color:var(--muted);margin-bottom:10px}
.svc .state.on{color:var(--ok)}
.svc label{margin:10px 0 6px}
.svc .hint{color:var(--muted);font-size:12px;margin:8px 0 0}
.langpick{margin-left:auto;align-self:center;font:inherit;font-size:13px;font-weight:600;
  color:var(--muted);background:transparent;border:1px solid var(--line);
  border-radius:999px;padding:5px 26px 5px 11px;cursor:pointer;
  appearance:none;-webkit-appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='7'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%237c8496' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 10px center}
.langpick:hover{color:var(--text);background-color:#1e222c}
.langpick:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
/* Shaped like the group chips, so the header reads as one row of controls
   instead of one control and one browser default. */
.tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:16px 2px 0}
.tools input[type=search]{flex:1;min-width:200px}
.tools button{padding:11px 15px;font-size:14px;white-space:nowrap}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:16px 2px 0}
.chip{font:inherit;font-size:13px;font-weight:500;padding:6px 13px;border-radius:999px;
  border:1px solid var(--line);background:transparent;color:var(--muted);cursor:pointer}
.chip:hover{background:#1e222c;color:var(--text)}
.chip.on{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);
  font-weight:650}
.chip.on:hover{background:#ffa3d2}
.chip .n{opacity:.55;margin-left:6px;font-variant-numeric:tabular-nums}
.chip.fold{border-style:dashed;opacity:.8}
/* The box belongs to the phrase, so it sits with the phrase — not in the
   middle of a row that a second line of groups can make twice as tall, where
   it ends up next to the small print instead. */
.item{display:flex;gap:14px;align-items:flex-start;padding:15px 2px;
  border-bottom:1px solid var(--line-soft)}
.item input[type=checkbox],.selall input[type=checkbox]{
  width:17px;height:17px;flex:none;accent-color:var(--accent);cursor:pointer;margin:0}
/* After the shared rule above, not before it — that one resets the margin. */
.item input[type=checkbox]{margin-top:6px}
/* margin-bottom comes from the label rule for the form above; here it would
   push the box 5px off centre against the button beside it. */
.selall{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px;
  cursor:pointer;user-select:none;white-space:nowrap;margin-bottom:0}
/* Both bulk actions live here, next to the selection they act on. Each sits
   against its own knob: the format belongs to the download, the voice to the
   recording. */
/* Only visible when something really is missing — a recording that failed,
   or a format that changed under the existing files. Each phrase keeps its
   own voice here; this repairs, it does not repaint. */
/* Filters are pills, actions are boxes — the two zones must never be mistaken
   for each other. The labels say which axis a row narrows. */
.filters{margin:14px 2px 0}
.frow{display:flex;align-items:baseline;gap:10px;margin-top:10px}
/* display:flex beats the browser's own rule for [hidden], so both of these
   would stay on screen while claiming to be hidden. */
.frow[hidden],.split[hidden]{display:none}
.flabel{color:var(--muted);font-size:12px;letter-spacing:.04em;text-transform:uppercase;
  flex:none;width:64px;padding-top:6px}
.frow .chips{margin:0}

.acts{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  margin:18px 2px 4px;padding-bottom:14px;border-bottom:1px solid var(--line)}
/* The same drawn chevron as the selects use. The character U+2304 sits on the
   baseline and reads as a typo next to the text. */
/* The everyday action is a button you press, not an entry you go looking for.
   Everything rarer sits behind the chevron next to it. */
.split{display:flex}
.split #dlmp3{border-top-right-radius:0;border-bottom-right-radius:0;
  border-right-color:transparent;padding:9px 14px;font-size:14px}
.acts #bulk{border-top-left-radius:0;border-bottom-left-radius:0;
  padding:9px 26px 9px 12px;font-size:14px;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='7'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%237c8496' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 10px center}
.acts #bulk:hover,.split #dlmp3:hover{background-color:#1e222c}
/* The two pairs travel together: wrapping them apart would put a lone voice
   picker under the selection and read as if it belonged to it. */
.acts .doing{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-left:auto}
/* Same box as the button beside it: same font, same vertical padding, so the
   two do not sit at different heights. */
.asbutton{padding:11px 34px 11px 16px !important;font-size:16px !important}
.asbutton,.acts select{font:inherit;font-size:14px;font-weight:600;color:var(--text);
  background:var(--line-soft);border:1px solid var(--line);border-radius:10px;
  padding:11px 30px 11px 13px;cursor:pointer;appearance:none;-webkit-appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='7'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%237c8496' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 11px center;max-width:230px}
.asbutton:hover,.acts select:hover{background-color:#1e222c}
.asbutton:focus-visible,.acts select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
/* The lamp sits with the words it belongs to instead of starting the row —
   one marker at the left edge (the checkbox) is enough. */
.item .st{display:inline-flex;align-items:center;gap:6px}
.item .dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--miss)}
.item.ok .dot{background:var(--ok)}
.item.stale .dot{background:var(--warn)}
.item .txt{flex:1;min-width:0}
.item .line{font-size:18px;letter-spacing:-.01em}
.item .meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px}
.item .state{font-size:12px;color:var(--muted)}
.item.stale .state{color:var(--warn)}
.item .tag{font:inherit;font-size:12px;font-weight:500;color:var(--muted);
  background:var(--line-soft);border:1px solid var(--line);border-radius:999px;
  padding:2px 10px;cursor:pointer}
.item .tag:hover{background:#1e222c;color:var(--text)}
.item audio{height:32px;flex:0 1 auto;width:clamp(170px,30%,280px);min-width:0;
  filter:invert(.92) hue-rotate(180deg);opacity:.85}
.menuwrap{position:relative;flex:none}
.dots{background:transparent;border:1px solid transparent;border-radius:9px;
  padding:6px 10px;font-size:18px;line-height:1.2;color:var(--muted);cursor:pointer}
.dots:hover,.dots[aria-expanded=true]{background:#1e222c;color:var(--text)}
.menu{position:absolute;right:0;top:calc(100% + 6px);z-index:10;min-width:200px;
  display:flex;flex-direction:column;padding:6px;background:var(--panel);
  border:1px solid var(--line);border-radius:11px;box-shadow:0 14px 34px rgba(0,0,0,.5)}
.menu button{font:inherit;font-size:14px;font-weight:500;text-align:left;
  white-space:nowrap;background:transparent;border:0;border-radius:7px;
  padding:9px 11px;color:var(--text);cursor:pointer}
.menu button:hover{background:#1e222c}
.menu button.danger{color:var(--danger)}
.menu button.danger:hover{background:rgba(229,72,77,.12)}
.empty{color:var(--muted);padding:32px 2px;font-size:15px}
.more{width:100%;margin-top:18px;color:var(--muted);font-size:14px}
/* On a phone the player is wider than the room left over, and it used to push
   the delete button off the screen. Give it a line of its own instead. */
/* Below this the player and the text fight over the same room, long before
   the layout actually breaks — so the player moves to its own line early. */
@media (max-width:720px){
  .item{flex-wrap:wrap;gap:10px}
  .item .txt{order:2}          /* keeps flex:1;min-width:0 so it can shrink */
  .menuwrap{order:3}
  .item audio{order:4;flex:1 1 100%;width:100%}
}
@media (max-width:560px){
  .hero{padding:16px 16px 12px}
  textarea{font-size:17px;min-height:112px}
  .item .line{font-size:17px}
  .bar{gap:8px}
  .tools{gap:8px}
  /* Three controls in one row leaves the search box a stub — it gets its own
     line, the format and the button share the next one. */
  .tools input[type=search]{flex:1 1 100%;min-width:0}
  .tools button{flex:1}
}
</style>
<main>
<div class="top">
  <h1><img class="logo" src="/icon.svg" alt="" width="44" height="44">mitreden</h1>
  <select id="lang" class="langpick" aria-label="Sprache / Language"></select>
  <button id="gear" class="gear" data-i18n-title="settings"
    data-i18n-aria="settings">\u2699</button>
</div>

<dialog id="setup" class="sheet">
  <h2 data-i18n="settings"></h2>
  <p class="sub" data-i18n="settings_intro"></p>
  <p class="warn" data-i18n="settings_warning"></p>
  <div id="cloud"></div>
  <div class="row"><button id="setupclose" data-i18n="close"></button></div>
</dialog>
<p class="sub" data-i18n="tagline"></p>

<div class="hero">
  <label for="t" data-i18n="new_phrases"></label>
  <textarea id="t" data-i18n-ph="new_phrases_hint"></textarea>
  <label class="tight" for="nt" data-i18n="groups_label"></label>
  <input id="nt" type="text" data-i18n-ph="groups_hint" autocomplete="off">
  <div class="row">
    <button class="primary" id="add" data-i18n="add_phrase"></button>
    <select id="voice" class="asbutton" data-i18n-aria="voice_label"
      data-i18n-title="voice_title"></select>
  </div>
  <p class="status" id="s" hidden></p>
</div>

<div class="bar">
  <span class="count" id="count">&nbsp;</span>
</div>

<div class="tools">
  <input id="q" type="search" data-i18n-ph="search_hint" autocomplete="off">
</div>

<div class="filters">
  <div class="frow"><span class="flabel" data-i18n="filter_groups"></span><span class="chips" id="chips"></span></div>
  <div class="frow" id="vrow" hidden><span class="flabel" data-i18n="filter_voices"></span><span class="chips" id="vchips"></span></div>
</div>

<div class="acts">
  <label class="selall"><input type="checkbox" id="selall"><span id="selalltxt"></span></label>
  <span class="split menuwrap" id="doing" hidden>
    <button id="dlmp3" data-i18n="download_mp3"></button>
    <button id="bulk" aria-haspopup="true" aria-expanded="false"
      data-i18n-title="more_actions" data-i18n-aria="more_actions"></button>
  </span>
</div>

<div id="list"></div>
</main>
<script>
const $=id=>document.getElementById(id);

// --- Sprachen ---------------------------------------------------------
// The strings come from lang/*.json so that translating means editing a file,
// not hunting through the program. Keys are English; a key that is missing in
// one language falls back to English, and then to the key itself, so a gap is
// visible instead of blank.
let STR={}, LANG='de';
const NAMES={de:'Deutsch',en:'English'};

function t(key,vars){
  const set=STR[LANG]||{}, fallback=STR.en||{};
  let s=set[key]!==undefined?set[key]:(fallback[key]!==undefined?fallback[key]:key);
  if(vars)for(const k in vars)s=s.split('{'+k+'}').join(vars[k]);
  return s;
}
// Singular and plural are separate keys — languages disagree about where the
// line falls, and "1 Sätze" is the kind of thing you stop seeing yourself.
const tn=(key,n,vars)=>t(key+(n===1?'_one':'_other'),Object.assign({n},vars));

function applyLang(){
  document.documentElement.lang=LANG;
  for(const el of document.querySelectorAll('[data-i18n]'))
    el.textContent=t(el.dataset.i18n);
  for(const el of document.querySelectorAll('[data-i18n-ph]'))
    el.placeholder=t(el.dataset.i18nPh);
  for(const el of document.querySelectorAll('[data-i18n-title]'))
    el.title=t(el.dataset.i18nTitle);
  for(const el of document.querySelectorAll('[data-i18n-aria]'))
    el.setAttribute('aria-label',t(el.dataset.i18nAria));
  draw();
}

// --- Einstellungen ----------------------------------------------------
async function drawSetup(){
  const st=await (await fetch('/api/setup')).json();
  const box=$('cloud');box.innerHTML='';
  for(const c of st.cloud){
    const d=document.createElement('div');d.className='svc';
    d.innerHTML='<h3></h3><p class="state"></p>'+
      '<label></label><input type="password" autocomplete="off">'+
      (c.needs_region?'<label class="region"></label><input class="region" type="text">':'')+
      '<div class="row"><button class="primary save"></button>'+
      '<button class="quiet forget"></button></div>'+
      '<p class="hint"></p>';
    d.querySelector('h3').textContent=c.label;
    const state=d.querySelector('.state');
    state.textContent=c.set?t('key_set'):t('key_unset');
    state.className='state'+(c.set?' on':'');
    d.querySelector('label').textContent=t('key_field');
    const key=d.querySelector('input[type=password]');
    const reg=d.querySelector('input.region');
    if(reg){d.querySelector('label.region').textContent=t('region_field');
            reg.value=c.region||''}
    d.querySelector('.save').textContent=t('key_save');
    const forget=d.querySelector('.forget');
    forget.textContent=t('key_forget');forget.hidden=!c.set;
    d.querySelector('.hint').textContent=t('key_hint');
    d.querySelector('.save').onclick=()=>saveKey(c,key.value,reg?reg.value:'');
    forget.onclick=()=>saveKey(c,'','');
    box.appendChild(d);
  }
}

async function saveKey(c,key,region){
  const r=await fetch('/api/setup',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({backend:c.id,key,region})});
  if(!r.ok){say(t('key_failed',{error:await r.text()}));return}
  const d=await r.json();
  say(d.set?t('key_saved',{label:c.label,n:d.voices})
           :t('key_removed',{label:c.label}));
  drawSetup();loadVoices();load();
}

$('gear').onclick=()=>{drawSetup();$('setup').showModal()};
$('setupclose').onclick=()=>$('setup').close();

async function loadStrings(){
  STR=await (await fetch('/api/strings')).json();
  const codes=Object.keys(STR);
  // What you picked last, else what the browser asks for, else English.
  // A German browser says de, de-AT or de-CH — the first two letters are
  // enough. Anything we do not have falls back to English, because that is
  // the language most likely to be understood by someone who is neither.
  const wanted=new URLSearchParams(location.search).get('lang')
    ||localStorage.getItem('mitreden.lang')
    ||(navigator.language||'').slice(0,2).toLowerCase();
  LANG=codes.includes(wanted)?wanted:(codes.includes('en')?'en':codes[0]);
  const sel=$('lang');
  sel.innerHTML='';
  for(const c of codes){
    const o=new Option(NAMES[c]||c,c);
    if(c===LANG)o.selected=true;
    sel.appendChild(o);
  }
  sel.onchange=e=>{
    LANG=e.target.value;
    localStorage.setItem('mitreden.lang',LANG);
    const u=new URL(location);u.searchParams.set('lang',LANG);
    history.replaceState(null,'',u);      // reload and sharing keep it
    applyLang();
    if($('setup').open)drawSetup();
  };
}
const say=m=>{const e=$('s');e.textContent=m||'';e.hidden=!m};
// Every row names its own voice now: they can differ from each other, so the
// header no longer answers the question for the whole list.
// Either it is not recorded, or you get the voice it is recorded in. Saying
// "recorded" as well would be a word that is true of every row.
const stateText=it=>it.state==='missing'?t('state_missing')
                  :it.state==='stale'?t('state_stale')
                  :(it.voice||t('state_recorded'));
let ALL=[], SHOW_ALL=false, ALL_TAGS=false;
// Which rows are ticked. Kept across redraws, so filtering or searching does
// not quietly drop what you picked; ids that vanish are pruned on load.
const SEL=new Set();
// Several groups can be picked at once and they combine with OR: pick two books
// and you get the phrases of both. The free text search narrows that further,
// so the two mechanisms are ANDed with each other.
const TAGS=new Set();
// One group per picture book adds up fast. Only the most used ones are on
// screen; the rest is one click away, and the search finds group names too.
const CHIP_CAP=12;

// Rendering thousands of rows makes the page crawl, and nobody reads that far
// anyway — search and groups are the real answer to a big phrase set. So the
// list stops here and offers the rest on request. Counts and downloads always
// cover everything that matches, not just what is drawn.
const CAP=200;

// Searching German without a German keyboard: "hor auf", "hoer auf" and
// "Hör auf" all have to find the same phrase. So every phrase is indexed in
// both spellings and the query is tried in both, too.
const bare=s=>s.toLowerCase().replace(/ß/g,'ss')
  .normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');
const umlaut=s=>s.toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe')
  .replace(/ü/g,'ue').replace(/ß/g,'ss');
const hay=i=>bare(i.text)+' | '+umlaut(i.text)+' | '+(i.tags||[]).join(' ');

function found(){
  const q=$('q').value.trim();
  if(!q)return ALL;
  const a=bare(q), b=umlaut(q);
  return ALL.filter(i=>{const h=hay(i);return h.includes(a)||h.includes(b)});
}
// What the list shows: search first, then the group filter, then the voice
// filter. Every axis narrows; none of them changes anything.
const voiceOf=i=>i.state==='missing'?NOCHNICHT:(i.voice||NOCHNICHT);
const shown=()=>{
  let f=found();
  if(TAGS.size)f=f.filter(i=>(i.tags||[]).some(x=>TAGS.has(x)));
  if(VOICES.size)f=f.filter(i=>VOICES.has(voiceOf(i)));
  return f;
};

function chip(label,n,tag,set,where){
  const b=document.createElement('button');
  b.className='chip'+((tag===null?!set.size:set.has(tag))?' on':'');
  b.textContent=label;
  const s=document.createElement('span');s.className='n';s.textContent=n;
  b.appendChild(s);
  b.onclick=()=>{
    if(tag===null)set.clear();
    else if(set.has(tag))set.delete(tag);
    else set.add(tag);
    draw();
  };
  $(where).appendChild(b);
}

// Which voices are picked. NOCHNICHT stands for "not recorded at all" — the
// same question ("what does this sound like?") with the answer "nothing yet".
const VOICES=new Set(), NOCHNICHT='\\u2205';
let ALL_VOICES=false;

function drawVoiceChips(hits){
  const counts={};
  for(const i of hits){
    const key=i.state==='missing'?NOCHNICHT:(i.voice||NOCHNICHT);
    counts[key]=(counts[key]||0)+1;
  }
  for(const v of VOICES)if(!(v in counts))counts[v]=0;
  const names=Object.keys(counts).sort((a,b)=>
    a===NOCHNICHT?1:b===NOCHNICHT?-1:a.localeCompare(b,'de'));
  $('vchips').innerHTML='';
  // One voice and nothing missing is no choice at all — the row stays away.
  $('vrow').hidden=names.length<2&&!VOICES.size;
  if($('vrow').hidden)return;
  chip(t('chip_all'),hits.length,null,VOICES,'vchips');
  // Same cap as the groups: a wall of pills is not a filter any more.
  let vis=names;
  if(!ALL_VOICES&&names.length>CHIP_CAP){
    const top=names.slice(0,CHIP_CAP);
    vis=top.concat([...VOICES].filter(v=>!top.includes(v)));
  }
  for(const n of vis)
    chip(n===NOCHNICHT?t('chip_not_recorded'):n,counts[n],n,VOICES,'vchips');
  if(names.length>vis.length||ALL_VOICES&&names.length>CHIP_CAP){
    const b=document.createElement('button');
    b.className='chip fold';
    b.textContent=ALL_VOICES?t('chip_less'):t('chip_more',{n:names.length-vis.length});
    b.onclick=()=>{ALL_VOICES=!ALL_VOICES;draw()};
    $('vchips').appendChild(b);
  }
}

function drawChips(hits){
  const counts={};
  for(const i of hits)for(const x of (i.tags||[]))counts[x]=(counts[x]||0)+1;
  for(const x of TAGS)if(!(x in counts))counts[x]=0;   // a pick never vanishes
  // Most used first — those are the everyday ones. Alphabetical within a tie.
  const names=Object.keys(counts)
    .sort((a,b)=>counts[b]-counts[a]||a.localeCompare(b,'de'));
  $('chips').innerHTML='';
  if(!names.length)return;
  chip(t('chip_all'),hits.length,null,TAGS,'chips');
  let vis=names;
  if(!ALL_TAGS&&names.length>CHIP_CAP){
    const top=names.slice(0,CHIP_CAP);
    vis=top.concat([...TAGS].filter(x=>!top.includes(x)));
  }
  for(const n of vis)chip(n,counts[n],n,TAGS,'chips');
  if(names.length>vis.length||ALL_TAGS&&names.length>CHIP_CAP){
    const b=document.createElement('button');
    b.className='chip fold';
    b.textContent=ALL_TAGS?t('chip_less'):t('chip_more',{n:names.length-vis.length});
    b.onclick=()=>{ALL_TAGS=!ALL_TAGS;draw()};
    $('chips').appendChild(b);
  }
}

function draw(){
  const hits=found(), items=shown().slice().reverse();  // newest first

  // Chips count within the current search, so they stay useful while typing.
  drawChips(hits);
  drawVoiceChips(hits);

  const pending=items.filter(i=>i.state!=='ok').length;
  $('count').textContent = !ALL.length ? t('count_none')
    : items.length===ALL.length
      ? tn('count',ALL.length)+
        (pending?t('count_open',{n:pending}):t('count_all_recorded'))
      : t('count_filtered',{n:items.length,all:ALL.length})+
        (pending?t('count_open',{n:pending}):'');


  $('list').innerHTML='';
  if(!items.length){
    const p=document.createElement('p');p.className='empty';
    p.textContent=ALL.length?t('empty_no_match'):t('empty_start');
    $('list').appendChild(p);
    refreshSel();
    return;
  }
  for(const it of (SHOW_ALL?items:items.slice(0,CAP))){
    const d=document.createElement('div');d.className='item '+it.state;
    d.innerHTML='<input type="checkbox" aria-label="'+t('select_one')+'">'+
      '<div class="txt"><div class="line"></div>'+
      '<div class="meta">'+
      '<span class="st"><span class="dot"></span><span class="state"></span></span>'+
      '</div></div>'+
      // The player's own \u22ee menu offers a playback speed that only affects
      // listening here, never the rendered file — and a download of the preview
      // rather than the device files. Both mislead, so both are switched off.
      (it.state==='missing'?'':'<audio controls controlsList="nodownload noplaybackrate" '+
        'disableRemotePlayback preload="none" src="/audio/'+it.id+'"></audio>')+
      '<div class="menuwrap"><button class="dots" aria-haspopup="true" '+
      'aria-expanded="false" title="Mehr" aria-label="Mehr">\\u22ee</button></div>';
    const box=d.querySelector('input[type=checkbox]');
    box.checked=SEL.has(it.id);
    box.onchange=()=>{box.checked?SEL.add(it.id):SEL.delete(it.id);refreshSel()};
    d.querySelector('.line').textContent=it.text;
    d.querySelector('.state').textContent=stateText(it);
    const meta=d.querySelector('.meta');
    for(const tag of (it.tags||[])){
      const b=document.createElement('button');
      b.className='tag';b.textContent=tag;b.title=t('tag_title');
      b.onclick=()=>{TAGS.clear();TAGS.add(tag);draw()};
      meta.appendChild(b);
    }
    d.querySelector('.dots').onclick=ev=>openMenu(ev.currentTarget,it);
    $('list').appendChild(d);
  }
  if(!SHOW_ALL&&items.length>CAP){
    const b=document.createElement('button');
    b.className='more';b.textContent=t('show_all',{n:items.length});
    b.onclick=()=>{SHOW_ALL=true;draw()};
    $('list').appendChild(b);
  }
  refreshSel();
}

// The row menu answers "what can I do with this phrase". This is the same
// question for several of them, so it is the same menu — not a bar that grows
// another control for every new action.
function menuOn(btn,build){
  const open=btn.getAttribute('aria-expanded')==='true';
  closeMenus();
  if(open)return;
  btn.setAttribute('aria-expanded','true');
  const m=document.createElement('div');m.className='menu';
  build(m,(label,danger,fn)=>{
    const b=document.createElement('button');
    b.textContent=label;
    if(danger)b.className='danger';
    b.onclick=e=>{e.stopPropagation();fn(m)};
    m.appendChild(b);
  });
  btn.parentNode.appendChild(m);
}

// Second level in the same popup: seventeen voices have no place in a bar,
// but they are fine in a list you opened on purpose.
async function voiceMenu(m,apply){
  m.innerHTML='';
  for(const v of await (await fetch('/api/voices')).json()){
    const b=document.createElement('button');
    b.textContent=t('switch_to',{voice:v.label});
    b.onclick=()=>{closeMenus();apply(v.id,v.label)};
    m.appendChild(b);
  }
}

async function switchTo(ids,id,label){
  if(!ids.length)return;
  if(!confirm(tn('ask_switch',ids.length,{voice:label})))return;
  say(t('busy_switch',{voice:label}));
  const r=await post('/api/build',{force:true,ids,voice:id});
  if(r){say(t('done_switch',{n:r.rendered,voice:label}));load()}
}

async function grabMany(ids,fmt){
  if(!ids.length){say(t('nothing_recorded'));return}
  say(t('busy_pack',{n:ids.length}));
  const r=await fetch('/api/download',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({ids,format:fmt})});
  if(!r.ok){say(t('failed',{error:await r.text()}));return}
  const url=URL.createObjectURL(await r.blob());
  const a=document.createElement('a');
  a.href=url;a.download='mitreden-'+ids.length+'-'+fmt+'.zip';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  say(t('done_pack',{n:ids.length,format:fmt.toUpperCase()}));
}

async function tagsMany(ids,mode){
  const rein=mode==='add';
  const v=prompt(t(rein?'ask_groups_add':'ask_groups_remove',{n:ids.length}),'');
  if(v===null)return;
  const tags=v.split(',').map(t=>t.trim()).filter(Boolean);
  if(!tags.length){say(t('no_group_named'));return}
  say(t(rein?'busy_group_add':'busy_group_remove'));
  const r=await post('/api/tags',{ids,tags,mode});
  if(r){say(t(rein?'done_group_add':'done_group_remove',
                {n:r.ids.length,groups:tags.join(', ')}));load()}
}

async function delMany(ids){
  if(!confirm(tn('ask_delete',ids.length)))return;
  say(t('busy_delete'));
  for(const id of ids)await post('/api/delete',{id});
  SEL.clear();
  say(t('done_delete',{n:ids.length}));load();
}

$('dlmp3').onclick=()=>grabMany(
  ALL.filter(i=>SEL.has(i.id)&&i.state!=='missing').map(i=>i.id),'mp3');
$('bulk').onclick=e=>menuOn(e.currentTarget,(m,add)=>{
  const ids=[...SEL];
  const fertig=ALL.filter(i=>SEL.has(i.id)&&i.state!=='missing').map(i=>i.id);
  if(fertig.length)
    add(t('download_wav'),false,()=>{closeMenus();grabMany(fertig,'wav')});
  add(t('menu_change_voice'),false,
      mm=>voiceMenu(mm,(id,label)=>switchTo(ids,id,label)));
  add(t('menu_add_group'),false,()=>{closeMenus();tagsMany(ids,'add')});
  add(t('menu_remove_group'),false,()=>{closeMenus();tagsMany(ids,'remove')});
  add(tn('menu_delete',ids.length),true,()=>{closeMenus();delMany(ids)});
});

function closeMenus(){
  for(const m of document.querySelectorAll('.menu'))m.remove();
  // Every button that opens one, not just the row's — the one in the action
  // bar kept saying "open" after the first click and refused to open again.
  for(const b of document.querySelectorAll('[aria-haspopup="true"]'))
    b.setAttribute('aria-expanded','false');
}
function openMenu(btn,it){
  menuOn(btn,(m,add)=>{
    add(t('menu_edit_text'),false,()=>{closeMenus();editText(it)});
    if(it.state!=='missing'){
      add(t('download_mp3'),false,()=>{closeMenus();grab(it,'mp3')});
      add(t('download_wav'),false,()=>{closeMenus();grab(it,'wav')});
    }
    add(t('menu_change_voice'),false,
        mm=>voiceMenu(mm,(id,label)=>switchTo([it.id],id,label)));
    add((it.tags||[]).length?t('menu_change_groups'):t('menu_add_to_group'),
        false,()=>{closeMenus();editTags(it)});
    add(t('menu_delete_one'),true,()=>{closeMenus();del(it)});
  });
}
addEventListener('click',e=>{if(!e.target.closest('.menuwrap'))closeMenus()});
addEventListener('keydown',e=>{if(e.key==='Escape')closeMenus()});

async function load(){
  const data=await (await fetch('/api/phrases')).json();
  ALL=data.items||[];
  await loadVoices(data.voice);
  const live=new Set();
  for(const i of ALL)for(const x of (i.tags||[]))live.add(x);
  for(const x of [...TAGS])if(!live.has(x))TAGS.delete(x);   // group is gone
  const alive=new Set(ALL.map(i=>i.id));
  for(const id of [...SEL])if(!alive.has(id))SEL.delete(id);  // phrase is gone
  draw();
}
async function loadVoices(current){
  const list=await (await fetch('/api/voices')).json();
  for(const id of ['voice']){
    const sel=$(id), keep=sel.value;
    sel.innerHTML='';
    if(!list.length){                    // nothing usable: just show it
      sel.appendChild(new Option(current||'\\u2014',''));
      sel.disabled=true;continue;
    }
    sel.disabled=false;
    for(const v of list){
      const o=new Option(v.label,v.id);
      if(v.id===keep||(!keep&&v.active))o.selected=true;
      sel.appendChild(o);
    }
  }
  $('voice').dataset.was=$('voice').value;
}
// Picking a voice records nothing. It is the voice the next recording gets —
// existing phrases keep theirs until you record them again.
$('voice').onchange=async e=>{
  const sel=e.target, id=sel.value, was=sel.dataset.was;
  const r=await post('/api/voice',{id});
  if(!r){sel.value=was;return}
  sel.dataset.was=id;
  say(t('voice_now',{voice:r.label}));
  draw();                                 // labels name the voice
};
function grab(it,fmt){
  const a=document.createElement('a');
  a.href='/audio/'+it.id+'?dl=1&format='+encodeURIComponent(fmt);
  document.body.appendChild(a);a.click();a.remove();
}
async function editText(it){
  const v=prompt(t('ask_edit_text',{text:'\\u201E'+it.text+'\\u201C',id:it.id}),it.text);
  if(v===null)return;
  if(v.trim()===it.text)return;                 // nichts angefasst
  say(t('busy_record'));
  const r=await post('/api/edit',{id:it.id,text:v});
  if(r){say(t('done_edit',{text:'\\u201E'+r.text+'\\u201C'}));load()}
}
async function editTags(it){
  const v=prompt(t('ask_groups_one',{text:'\\u201E'+it.text+'\\u201C'}),
                 (it.tags||[]).join(', '));
  if(v===null)return;
  const tags=v.split(',');
  const r=await post('/api/tags',{ids:[it.id],tags,mode:'set'});
  if(r){const rest=tags.map(t=>t.trim()).filter(Boolean);
        say(rest.length?t('done_groups_one',{groups:rest.join(', ')})
                       :t('done_groups_none'));load()}
}
async function del(it){
  if(!confirm(t('ask_delete_this',{text:'\\u201E'+it.text+'\\u201C'})))return;
  say(t('busy_delete'));
  const r=await post('/api/delete',{id:it.id});
  if(r){say(t('done_delete_one',{text:it.text}));load()}
}
async function post(url,body){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body||{})});
  if(!r.ok){say(t('failed',{error:await r.text()}));return null}
  return r.json();
}
$('q').oninput=draw;
$('add').onclick=async()=>{
  const lines=$('t').value.split('\\n').map(s=>s.trim()).filter(Boolean);
  if(!lines.length){say(t('type_first'));return}
  // Only what stands in the field. A filter further down is a way of looking
  // at the list, not a hidden instruction about the phrase you are typing.
  const tags=$('nt').value.split(',').map(s=>s.trim()).filter(Boolean);
  say(t('busy_add'));
  const res=await post('/api/phrases',{lines,tags});
  if(res){
    $('t').value='';
    say(t('done_add',{added:res.added,rendered:res.rendered})+
        (res.merged?t('done_add_twins',{n:res.merged}):'')+'.');
    load();
  }
};
function refreshSel(){
  const vis=shown(), ids=vis.map(i=>i.id);
  const picked=ids.filter(i=>SEL.has(i)).length;
  const all=$('selall');
  all.checked=ids.length>0&&picked===ids.length;
  all.indeterminate=picked>0&&picked<ids.length;
  // The button acts on the whole selection, so the label has to name it —
  // including what a filter is currently hiding, or you press a button that
  // touches a phrase you cannot see.
  const versteckt=SEL.size-picked;
  $('selalltxt').textContent=!SEL.size?t('select_all')
    :versteckt?t('selected_hidden',{n:SEL.size,hidden:versteckt})
    :t('selected',{n:SEL.size});
  // Everything you can do with a selection lives behind one button. What the
  // search and the pills do is filter, nothing else.
  $('doing').hidden=!SEL.size;
}
$('selall').onchange=e=>{
  for(const i of shown()) e.target.checked?SEL.add(i.id):SEL.delete(i.id);
  draw();
};
loadStrings().then(()=>{applyLang();load()});
</script>
</html>"""


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

    def log_message(self, *a):
        pass

    def do_GET(self):
        # The path, without whatever the page appended for its own state. A
        # link with ?lang=de is still the page, not a different one.
        route = urllib.parse.urlsplit(self.path).path
        if route == "/":
            return self._send(200, PAGE, "text/html; charset=utf-8")
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

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        data = json.loads(self.rfile.read(n) or "{}")
        route = urllib.parse.urlsplit(self.path).path   # same rule as do_GET
        cfg = load_config()
        items = load_phrases()

        if route == "/api/phrases":
            fresh, twins = add_lines(items, data.get("lines", []),
                                     data.get("tags", []))
            rendered = 0
            for item in fresh:
                try:
                    rendered += 1 if render(item, cfg) else 0
                except Exception as e:
                    save_phrases(items)          # keep what already worked
                    return self._send(500, str(e), "text/plain")
            save_phrases(items)
            return self._send(200, json.dumps({"added": len(fresh),
                                               "rendered": rendered,
                                               "merged": len(twins)}))

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
            try:
                rendered = render(item, cfg)     # right away, like adding does
            except Exception as e:
                save_phrases(items)
                return self._send(500, str(e), "text/plain")
            save_phrases(items)
            return self._send(200, json.dumps({"ok": True, "id": item["id"],
                                               "text": item["text"],
                                               "rendered": bool(rendered)},
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
                    CONFIG.write_text(json.dumps(raw, indent=2,
                                                 ensure_ascii=False) + "\n")
            set_env_var(var, key)
            (DATA / ".azure-voices.json").unlink(missing_ok=True)   # ask again
            return self._send(200, json.dumps(
                {"ok": True, "set": True,
                 "voices": len(available_voices(load_config()))}))

        if route == "/api/download":
            blob, n = zip_phrases(data.get("ids", []), cfg, data.get("format"))
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
        http.server.HTTPServer((host, port), Handler).serve_forever()
    elif cmd == "add":
        text, tags, rest, i = None, [], args[1:], 0
        while i < len(rest):
            a = rest[i]
            if a in ("--tag", "--tags") and i + 1 < len(rest):
                i += 1
                tags = rest[i].split(",")
            elif a.startswith("--tag=") or a.startswith("--tags="):
                tags = a.split("=", 1)[1].split(",")
            elif text is None:
                text = a
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
