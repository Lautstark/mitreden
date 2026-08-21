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
                   "key_env": "AZURE_SPEECH_KEY", "rate": "-5%", "pitch": "0%"},
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
        CONFIG.write_text(json.dumps(first_config(), indent=2, ensure_ascii=False))
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


def slug(text, fallback="phrase"):
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
    return s[:40] or fallback


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


def set_tags(pid, tags):
    """Replace the groups of one phrase. Returns the new list, or None if the
    id does not exist."""
    items = load_phrases()
    for i in items:
        if i.get("id") == pid:
            clean = [t for t in dict.fromkeys(norm_tag(x) for x in tags) if t]
            i["tags"] = clean
            save_phrases(items)
            return clean
    return None


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

def render(item, cfg, force=False):
    """One phrase -> raw file -> one output file. Returns True if it worked."""
    fp = fingerprint(item["text"], cfg)
    dest = out_file(item["id"], cfg)
    if not force and item.get("fingerprint") == fp and dest.exists():
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
                           f"`mitreden.py backends` shows what is available.")
    BACKENDS[backend](item["text"], raw, opt)

    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw),
                    "-af", FILTERS, *output_args(cfg), str(dest)], check=True)

    item["fingerprint"] = fp
    item["backend"] = cfg["backend"]
    item["voice"] = voice_label(cfg)     # which voice you are hearing, by name
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


def build(force=False):
    cfg = load_config()
    items = load_phrases()
    if not items:
        print("phrases.json is empty. Add phrases first: mitreden.py add \"Text\"")
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
    gone = prune_out(cfg)
    print(f"\nRe-rendered {done} of {len(items)} phrases. Voice: {cfg['backend']}")
    if gone:
        print(f"Cleaned up {len(gone)} leftover file(s) in {OUT.name}/:")
        for f in gone[:5]:
            print(f"  removed    {f.name}")
        if len(gone) > 5:
            print(f"  ... and {len(gone) - 5} more")
    print(f"Files are in {OUT} as .{out_format(cfg)}")


def phrase_state(item, cfg):
    """ok = current, missing = never rendered, stale = other voice or other text."""
    if not out_file(item["id"], cfg).exists():
        return "missing"
    if item.get("fingerprint") != fingerprint(item["text"], cfg):
        return "stale"
    return "ok"


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
    """de_DE-thorsten-medium -> Thorsten (piper, medium)"""
    rest = stem.split("-", 1)[1] if "-" in stem else stem
    name, _, quality = rest.partition("-")
    return f"{name.replace('_', ' ').title()} (piper{', ' + quality if quality else ''})"


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
    locale = "-".join(mine.split("-")[:2])
    cache = DATA / ".azure-voices.json"
    try:
        age = time.time() - cache.stat().st_mtime
        if age < AZURE_CACHE_DAYS * 86400:
            known = json.loads(cache.read_text())
            if known.get("locale") == locale:
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
                           if v.get("Locale", "").startswith(locale))
        if mine and mine not in names:
            names.append(mine)          # configured by hand, keep it usable
        DATA.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({"locale": locale, "voices": names}))
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
        out.append({"id": f"piper:{stem}", "label": pretty_piper(stem),
                    "backend": "piper", "model": str(path)})
    opt = cfg.get("azure") or {}
    if os.environ.get(opt.get("key_env", "")):
        for name in azure_voices(cfg):
            out.append({"id": f"azure:{name}", "label": f"{short_voice(name)} (azure)",
                        "backend": "azure", "voice": name})
    opt = cfg.get("elevenlabs") or {}
    if os.environ.get(opt.get("key_env", "")):
        out.append({"id": "elevenlabs", "label": "ElevenLabs", "backend": "elevenlabs"})
    for backend in ("say", "espeak"):
        opt = cfg.get(backend) or {}
        binary = opt.get("binary") or backend
        if shutil.which(binary):
            out.append({"id": backend, "label": f"{opt.get('voice', backend)} ({backend})",
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


def use_voice(cfg, vid):
    """Point the config at one voice from the catalogue and write it down.

    Returns the new label, or None if that voice is not on offer. Everything
    else follows by itself: the voice is part of the fingerprint, so every
    phrase turns stale and asks to be recorded again."""
    chosen = next((v for v in available_voices(cfg) if v["id"] == vid), None)
    if chosen is None:
        return None
    cfg["backend"] = chosen["backend"]
    if chosen["backend"] == "piper":
        cfg.setdefault("piper", {})["model"] = chosen["model"]
    if chosen["backend"] == "azure":
        cfg.setdefault("azure", {})["voice"] = chosen["voice"]
    CONFIG.write_text(json.dumps(cfg, indent=2, ensure_ascii=False))
    return chosen["label"]


def voice_label(cfg):
    """Voice name for the interface, e.g. de-DE-GiselaNeural -> Gisela."""
    mine = active_voice(cfg)
    for v in available_voices(cfg):
        if v["id"] == mine:
            return v["label"]
    opt = cfg.get(cfg["backend"], {})       # configured, but not usable here
    name = opt.get("voice") or cfg["backend"]
    return name.split("-")[-1].replace("Neural", "") if name.count("-") >= 2 else name


def phrases_with_state():
    cfg = load_config()
    items = [dict(i, tags=i.get("tags") or [], state=phrase_state(i, cfg))
             for i in load_phrases()]
    return {"items": items, "voice": voice_label(cfg), "format": out_format(cfg)}


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
input[type=text],input[type=search]{width:100%;background:var(--ink);color:var(--text);
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
.status{color:var(--muted);font-size:14px;min-height:20px;margin:12px 2px 0}
.bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  margin:40px 2px 4px;padding-bottom:14px;border-bottom:1px solid var(--line)}
.bar .count{font-weight:650;font-size:15px}
.bar .spacer{flex:1}
.voice{color:var(--muted);font-size:13px;white-space:nowrap;
  display:flex;align-items:center;gap:8px}
/* Shaped like the group chips, so the header reads as one row of controls
   instead of one control and one browser default. */
.voice select{font:inherit;font-size:13px;font-weight:600;color:var(--text);
  background:var(--line-soft);border:1px solid var(--line);border-radius:999px;
  padding:6px 30px 6px 13px;cursor:pointer;appearance:none;-webkit-appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='7'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%237c8496' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 12px center}
.voice select:hover{background-color:#1e222c}
.voice select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.voice select:disabled{color:var(--muted);cursor:default;opacity:1}
.tools select{font:inherit;font-size:14px;font-weight:600;color:var(--text);
  background:var(--line-soft);border:1px solid var(--line);border-radius:10px;
  padding:11px 32px 11px 14px;cursor:pointer;appearance:none;-webkit-appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='7'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%237c8496' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 13px center}
.tools select:hover{background-color:#1e222c}
.tools select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
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
.item{display:flex;gap:14px;align-items:center;padding:15px 2px;
  border-bottom:1px solid var(--line-soft)}
.item input[type=checkbox],.selall input[type=checkbox]{
  width:17px;height:17px;flex:none;accent-color:var(--accent);cursor:pointer;margin:0}
.selall{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px;
  cursor:pointer;user-select:none;margin:16px 2px 0}
.item .dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--miss)}
.item.ok .dot{background:var(--ok)}
.item.stale .dot{background:var(--warn)}
.item .txt{flex:1;min-width:0}
.item .line{font-size:18px;letter-spacing:-.01em}
.item .meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px}
.item .id{font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;
  color:var(--muted);word-break:break-all}
.item .state{font-size:12px;color:var(--muted)}
.item.stale .state{color:var(--warn)}
.item .tag{font:inherit;font-size:12px;font-weight:500;color:var(--muted);
  background:var(--line-soft);border:1px solid var(--line);border-radius:999px;
  padding:2px 10px;cursor:pointer}
.item .tag:hover{background:#1e222c;color:var(--text)}
.item audio{height:32px;flex:none;filter:invert(.92) hue-rotate(180deg);opacity:.85}
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
.foot{margin-top:28px;color:var(--muted);font-size:13px}
/* On a phone the player is wider than the room left over, and it used to push
   the delete button off the screen. Give it a line of its own instead. */
@media (max-width:560px){
  .item{flex-wrap:wrap;gap:10px}
  .item .dot{order:1}
  .item .txt{order:2}          /* keeps flex:1;min-width:0 so it can shrink */
  .menuwrap{order:3}
  .item audio{order:4;flex:1 1 100%;width:100%}
}
</style>
<main>
<h1><img class="logo" src="/icon.svg" alt="" width="44" height="44">mitreden</h1>
<p class="sub">Ein Satz, eine Stimme, eine Audiodatei.</p>

<div class="hero">
  <label for="t">Was soll sie sagen können?</label>
  <textarea id="t" placeholder="Nochmal!&#10;Ich bin dran.&#10;Lass mich in Ruhe."></textarea>
  <label class="tight" for="nt">Gruppen — optional, mit Komma getrennt</label>
  <input id="nt" type="text" placeholder="kindergarten, spiel" autocomplete="off">
  <div class="row">
    <button class="primary" id="add">Satz hinzufügen</button>
    <button class="quiet" id="build">Fehlende aufnehmen</button>
  </div>
  <p class="status" id="s">&nbsp;</p>
</div>

<div class="bar">
  <span class="count" id="count">&nbsp;</span>
  <span class="spacer"></span>
  <span class="voice">Stimme <select id="voice" title="Gilt f\u00fcr alle S\u00e4tze"></select></span>
</div>

<div class="tools">
  <input id="q" type="search" placeholder="Sätze und Gruppen durchsuchen…" autocomplete="off">
  <select id="dlfmt" title="In welchem Format das ZIP gepackt wird"></select>
  <button id="dl" title="Alles, was die Liste gerade zeigt, als ZIP">Herunterladen</button>
</div>

<div class="chips" id="chips"></div>

<label class="selall"><input type="checkbox" id="selall"><span id="selalltxt">Alle ausw\u00e4hlen</span></label>

<div id="list"></div>

<div class="foot">
  <button class="quiet" id="rebuild">Alle Sätze neu aufnehmen</button>
</div>
</main>
<script>
const $=id=>document.getElementById(id);
const say=m=>$('s').textContent=m||'\\u00a0';
const LABEL={ok:'aufgenommen',missing:'noch nicht aufgenommen',
             stale:'noch in der alten Stimme'};
// Naming the old voice beats "old": you can see at a glance whether the row
// is left over from Gisela or from a piper voice. A current recording is
// by definition in the voice named in the header, so repeating it is noise.
const stateText=it=>it.state==='stale'&&it.voice?'noch in '+it.voice
                  :LABEL[it.state];
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
// What the list shows: search first, then the group filter on top.
const shown=()=>{const f=found();
  return TAGS.size?f.filter(i=>(i.tags||[]).some(t=>TAGS.has(t))):f};
// The one group we are "in" — only unambiguous while exactly one is picked.
const soleTag=()=>TAGS.size===1?[...TAGS][0]:'';

function chip(label,n,tag){
  const b=document.createElement('button');
  b.className='chip'+((tag===null?!TAGS.size:TAGS.has(tag))?' on':'');
  b.textContent=label;
  const s=document.createElement('span');s.className='n';s.textContent=n;
  b.appendChild(s);
  b.onclick=()=>{
    if(tag===null)TAGS.clear();
    else if(TAGS.has(tag))TAGS.delete(tag);
    else TAGS.add(tag);
    draw();
  };
  $('chips').appendChild(b);
}

function drawChips(hits){
  const counts={};
  for(const i of hits)for(const t of (i.tags||[]))counts[t]=(counts[t]||0)+1;
  for(const t of TAGS)if(!(t in counts))counts[t]=0;   // a pick never vanishes
  // Most used first — those are the everyday ones. Alphabetical within a tie.
  const names=Object.keys(counts)
    .sort((a,b)=>counts[b]-counts[a]||a.localeCompare(b,'de'));
  $('chips').innerHTML='';
  if(!names.length)return;
  chip('Alle',hits.length,null);
  let vis=names;
  if(!ALL_TAGS&&names.length>CHIP_CAP){
    const top=names.slice(0,CHIP_CAP);
    vis=top.concat([...TAGS].filter(t=>!top.includes(t)));
  }
  for(const n of vis)chip(n,counts[n],n);
  if(names.length>vis.length||ALL_TAGS&&names.length>CHIP_CAP){
    const b=document.createElement('button');
    b.className='chip fold';
    b.textContent=ALL_TAGS?'weniger':'+ '+(names.length-vis.length)+' weitere';
    b.onclick=()=>{ALL_TAGS=!ALL_TAGS;draw()};
    $('chips').appendChild(b);
  }
}

function draw(){
  const hits=found(), items=shown().slice().reverse();  // newest first

  // Chips count within the current search, so they stay useful while typing.
  drawChips(hits);

  const pending=items.filter(i=>i.state!=='ok').length;
  $('count').textContent = !ALL.length ? 'Noch keine S\\u00e4tze'
    : items.length===ALL.length
      ? ALL.length+(ALL.length===1?' Satz':' S\\u00e4tze')+
        (pending?', '+pending+' offen':', alle aufgenommen')
      : items.length+' von '+ALL.length+' S\\u00e4tzen'+(pending?', '+pending+' offen':'');

  const ready=items.filter(i=>i.state!=='missing').length;
  $('dl').textContent=ready?ready+' herunterladen':'Herunterladen';
  $('dl').disabled=!ready;
  $('nt').placeholder=soleTag()?soleTag()+' \\u2014 die Gruppe, in der du bist'
                               :'kindergarten, spiel';

  $('list').innerHTML='';
  if(!items.length){
    const p=document.createElement('p');p.className='empty';
    p.textContent=ALL.length?'Kein Satz passt.'
      :'Noch nichts da. Mehrere Zeilen auf einmal gehen auch \\u2014 '+
       'jede Zeile wird ein eigener Satz.';
    $('list').appendChild(p);
    refreshSel();
    return;
  }
  for(const it of (SHOW_ALL?items:items.slice(0,CAP))){
    const d=document.createElement('div');d.className='item '+it.state;
    d.innerHTML='<input type="checkbox" aria-label="Ausw\\u00e4hlen">'+
      '<span class="dot"></span>'+
      '<div class="txt"><div class="line"></div>'+
      '<div class="meta"><span class="id"></span><span class="state"></span></div></div>'+
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
    d.querySelector('.id').textContent=it.id;
    d.querySelector('.state').textContent=stateText(it);
    const meta=d.querySelector('.meta');
    for(const t of (it.tags||[])){
      const b=document.createElement('button');
      b.className='tag';b.textContent=t;b.title='Nur diese Gruppe zeigen';
      b.onclick=()=>{TAGS.clear();TAGS.add(t);draw()};
      meta.appendChild(b);
    }
    d.querySelector('.dots').onclick=ev=>openMenu(ev.currentTarget,it);
    $('list').appendChild(d);
  }
  if(!SHOW_ALL&&items.length>CAP){
    const b=document.createElement('button');
    b.className='more';b.textContent='Alle '+items.length+' S\\u00e4tze zeigen';
    b.onclick=()=>{SHOW_ALL=true;draw()};
    $('list').appendChild(b);
  }
  refreshSel();
}

function closeMenus(){
  for(const m of document.querySelectorAll('.menu'))m.remove();
  for(const b of document.querySelectorAll('.dots'))b.setAttribute('aria-expanded','false');
}
function openMenu(btn,it){
  const open=btn.getAttribute('aria-expanded')==='true';
  closeMenus();
  if(open)return;                       // a second click closes it again
  btn.setAttribute('aria-expanded','true');
  const m=document.createElement('div');m.className='menu';
  const add=(label,danger,fn)=>{
    const b=document.createElement('button');
    b.textContent=label;
    if(danger)b.className='danger';
    b.onclick=()=>{closeMenus();fn()};
    m.appendChild(b);
  };
  add('Text \\u00e4ndern',false,()=>editText(it));
  if(it.state!=='missing')
    add('Datei herunterladen ('+$('dlfmt').value.toUpperCase()+')',false,()=>grab(it));
  add(it.state==='missing'?'Aufnehmen':'Neu aufnehmen',false,()=>redo(it));
  add((it.tags||[]).length?'Gruppen \\u00e4ndern':'Zu einer Gruppe hinzuf\\u00fcgen',
      false,()=>editTags(it));
  add('Satz l\\u00f6schen',true,()=>del(it));
  btn.parentNode.appendChild(m);
}
addEventListener('click',e=>{if(!e.target.closest('.menuwrap'))closeMenus()});
addEventListener('keydown',e=>{if(e.key==='Escape')closeMenus()});

async function load(){
  const data=await (await fetch('/api/phrases')).json();
  ALL=data.items||[];
  await loadVoices(data.voice);
  loadFormats(data.format||'mp3');
  const live=new Set();
  for(const i of ALL)for(const t of (i.tags||[]))live.add(t);
  for(const t of [...TAGS])if(!live.has(t))TAGS.delete(t);   // group is gone
  const alive=new Set(ALL.map(i=>i.id));
  for(const id of [...SEL])if(!alive.has(id))SEL.delete(id);  // phrase is gone
  draw();
}
const voiceNow=()=>{
  const o=$('voice').selectedOptions[0];
  return o&&o.text?o.text:'der aktuellen Stimme';
};
function loadFormats(current){
  const sel=$('dlfmt');
  if(sel.dataset.ready&&sel.dataset.ready===current)return;
  sel.innerHTML='';
  for(const f of [current,...['mp3','wav'].filter(x=>x!==current)])
    sel.appendChild(new Option(f.toUpperCase(),f));
  sel.dataset.ready=current;               // the recorded format goes first
}
async function loadVoices(current){
  const sel=$('voice');
  const list=await (await fetch('/api/voices')).json();
  sel.innerHTML='';
  if(!list.length){                      // nothing usable: just show it
    sel.appendChild(new Option(current||'\\u2014',''));
    sel.disabled=true;return;
  }
  sel.disabled=false;
  for(const v of list){
    const o=new Option(v.label,v.id);
    if(v.active)o.selected=true;
    sel.appendChild(o);
  }
  sel.dataset.was=sel.value;
}
$('voice').onchange=async e=>{
  const sel=e.target, id=sel.value, was=sel.dataset.was;
  const r=await post('/api/voice',{id});
  if(!r){sel.value=was;return}
  if(r.stale&&!confirm('Stimme: '+r.label+'\\n\\n'+r.stale+' S\\u00e4tze klingen jetzt '+
       'nach der alten Stimme und werden neu aufgenommen. Das dauert einen Moment.')){
    await post('/api/voice',{id:was});    // put it back, nothing happened
    sel.value=was;say('Stimme unver\\u00e4ndert.');return;
  }
  sel.dataset.was=id;
  say('Wird mit '+r.label+' neu aufgenommen \\u2026');
  const b=await post('/api/build',{force:true});
  if(b)say(b.rendered+' S\\u00e4tze mit '+r.label+' aufgenommen.');
  load();
};
function grab(it){
  const a=document.createElement('a');
  a.href='/audio/'+it.id+'?dl=1&format='+encodeURIComponent($('dlfmt').value);
  document.body.appendChild(a);a.click();a.remove();
}
async function redo(it){
  say('\\u201E'+it.text+'\\u201C wird mit '+voiceNow()+' aufgenommen \\u2026');
  const r=await post('/api/build',{ids:[it.id],force:true});
  if(r){say(r.rendered?'Aufgenommen: '+it.id:'Nichts zu tun.');load()}
}
async function editText(it){
  const v=prompt('Text f\\u00fcr \\u201E'+it.text+'\\u201C\\n\\n'+
                 'Der Satz wird sofort neu aufgenommen. '+
                 'Der Dateiname bleibt \\u201E'+it.id+'\\u201C.',it.text);
  if(v===null)return;
  if(v.trim()===it.text)return;                 // nichts angefasst
  say('Wird neu aufgenommen \\u2026');
  const r=await post('/api/edit',{id:it.id,text:v});
  if(r){say('Ge\\u00e4ndert: \\u201E'+r.text+'\\u201C');load()}
}
async function editTags(it){
  const v=prompt('Gruppen f\\u00fcr \\u201E'+it.text+'\\u201C\\n\\nMit Komma getrennt. '+
                 'Leer entfernt alle Gruppen.',(it.tags||[]).join(', '));
  if(v===null)return;
  const r=await post('/api/tags',{id:it.id,tags:v.split(',')});
  if(r){say(r.tags.length?'Jetzt in: '+r.tags.join(', '):'Keine Gruppen mehr.');load()}
}
async function del(it){
  if(!confirm('\\u201E'+it.text+'\\u201C wirklich l\\u00f6schen?\\n\\nDer Satz und seine '+
              'Audiodateien werden entfernt. Das l\\u00e4sst sich nicht r\\u00fcckg\\u00e4ngig machen.'))return;
  say('Wird gel\\u00f6scht \\u2026');
  const r=await post('/api/delete',{id:it.id});
  if(r){say('Gel\\u00f6scht: '+r.id);load()}
}
async function post(url,body){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body||{})});
  if(!r.ok){say('Fehlgeschlagen: '+await r.text());return null}
  return r.json();
}
$('q').oninput=draw;
$('add').onclick=async()=>{
  const lines=$('t').value.split('\\n').map(s=>s.trim()).filter(Boolean);
  if(!lines.length){say('Erst etwas eintippen.');return}
  let tags=$('nt').value.split(',').map(s=>s.trim()).filter(Boolean);
  if(!tags.length&&soleTag())tags=[soleTag()];   // adding inside a group stays in it
  say('Wird aufgenommen \\u2026');
  const res=await post('/api/phrases',{lines,tags});
  if(res){
    $('t').value='';
    say(res.added+' hinzugef\\u00fcgt, '+res.rendered+' aufgenommen'+
        (res.merged?', '+res.merged+' gab es schon':'')+'.');
    load();
  }
};
$('dl').onclick=async()=>{
  const vis=shown(), ids=vis.filter(i=>i.state!=='missing').map(i=>i.id);
  if(!ids.length){say('Es ist noch nichts aufgenommen.');return}
  say(ids.length+' S\\u00e4tze werden gepackt \\u2026');
  const r=await fetch('/api/download',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ids,format:$('dlfmt').value})});
  if(!r.ok){say('Fehlgeschlagen: '+await r.text());return}
  const url=URL.createObjectURL(await r.blob());
  const a=document.createElement('a');
  a.href=url;a.download='mitreden-'+(soleTag()||(TAGS.size?'auswahl':'alle'))+
    '-'+$('dlfmt').value+'.zip';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  const skipped=vis.length-ids.length;
  say(ids.length+' S\\u00e4tze heruntergeladen'+
      (skipped?'. '+skipped+' noch nicht aufgenommen':'')+'.');
};
$('build').onclick=async()=>{say('Fehlende werden aufgenommen \\u2026');
  const r=await post('/api/build',{force:false});
  if(r){say(r.rendered?r.rendered+' aufgenommen.':'Es fehlte nichts.');load()}};
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
  $('selalltxt').textContent=SEL.size
    ? SEL.size+' ausgew\\u00e4hlt'+(versteckt?', '+versteckt+' davon ausgeblendet':'')
    : 'Alle ausw\\u00e4hlen';
  const b=$('rebuild');
  b.disabled=!SEL.size;
  b.textContent=SEL.size===ALL.length?'Alle S\\u00e4tze neu aufnehmen'
    :SEL.size?SEL.size+(SEL.size===1?' Satz':' S\\u00e4tze')+' neu aufnehmen'
    :'Nichts ausgew\\u00e4hlt';
}
$('selall').onchange=e=>{
  for(const i of shown()) e.target.checked?SEL.add(i.id):SEL.delete(i.id);
  draw();
};
$('rebuild').onclick=async()=>{
  const ids=[...SEL];
  if(!ids.length)return;
  const wieviele=ids.length===ALL.length?'Alle S\\u00e4tze'
    :ids.length+(ids.length===1?' Satz':' S\\u00e4tze');
  if(!confirm(wieviele+' mit '+voiceNow()+' neu aufnehmen?\\n\\n'+
              'Was schon in dieser Stimme aufgenommen ist, wird ebenfalls '+
              'ersetzt.'))return;
  say(wieviele+' mit '+voiceNow()+' neu aufnehmen \\u2026');
  const r=await post('/api/build',{force:true,ids});
  if(r){say(r.rendered+' neu aufgenommen.');load()}};
load();
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
        if self.path == "/":
            return self._send(200, PAGE, "text/html; charset=utf-8")
        if self.path == "/icon.svg":
            if not ICON.exists():
                return self._send(404, b"", "text/plain")
            return self._send(200, ICON.read_bytes(), "image/svg+xml")
        if self.path.startswith("/audio/"):
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
        if self.path == "/api/phrases":
            return self._send(200, json.dumps(phrases_with_state(),
                                              ensure_ascii=False))
        if self.path == "/api/voices":
            return self._send(200, json.dumps(available_voices(load_config()),
                                              ensure_ascii=False))
        self._send(404, b"", "text/plain")

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        data = json.loads(self.rfile.read(n) or "{}")
        cfg = load_config()
        items = load_phrases()

        if self.path == "/api/phrases":
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

        if self.path == "/api/tags":
            pid = (data.get("id") or "").strip()
            tags = set_tags(pid, data.get("tags", []))
            if tags is None:
                return self._send(404, f"No phrase with the id '{pid}'.", "text/plain")
            return self._send(200, json.dumps({"ok": True, "id": pid, "tags": tags},
                                              ensure_ascii=False))

        if self.path == "/api/edit":
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

        if self.path == "/api/voice":
            label = use_voice(cfg, (data.get("id") or "").strip())
            if label is None:
                return self._send(404, "That voice is not available here.",
                                  "text/plain")
            # Nothing is re-recorded here. The phrases have just turned stale,
            # and the page asks before putting the machine to work.
            stale = sum(1 for i in items if phrase_state(i, cfg) != "ok")
            return self._send(200, json.dumps({"ok": True, "label": label,
                                               "stale": stale},
                                              ensure_ascii=False))

        if self.path == "/api/download":
            blob, n = zip_phrases(data.get("ids", []), cfg, data.get("format"))
            if not n:
                return self._send(404, "Nothing recorded to download.", "text/plain")
            return self._send(200, blob, "application/zip")

        if self.path == "/api/build":
            force = bool(data.get("force"))
            only = set(data.get("ids") or [])     # empty = everything
            rendered = 0
            for item in items:
                if only and item["id"] not in only:
                    continue
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
        build(force="--all" in args)
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
        build(force=True)          # everything sounded like the old one
    elif cmd == "backends":
        check_backends()
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
