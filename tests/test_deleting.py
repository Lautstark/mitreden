#!/usr/bin/env python3
"""Checks that deleting says what it really did.

Deleting a selection used to be one request per phrase, in a loop that ignored
whether any of them worked:

    for(const id of ids) await post('/api/delete',{id});
    say(t('done_delete',{n:ids.length}));      // always the full number

So a failure half way through still reported every phrase as gone, and each of
those requests rewrote the whole of phrases.json — one more chance to be
interrupted per phrase. It is one request now, and the number that appears on
screen is the one the server sends back.

Checked here: unknown ids are not counted, all-unknown is a plain no, the
single-id form still works because the command line uses it, the audio goes
with the phrase, and the list is written before the files are removed — a file
with no phrase is clutter that build clears up by itself, while a phrase whose
file was removed before the save would ask to be recorded again for ever.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent

os.environ["MITREDEN_DIR"] = tempfile.mkdtemp(prefix="mitreden-deleting-")
sys.path.insert(0, str(ROOT))
import mitreden as m                                  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def seed(count: int) -> dict:
    """A handful of phrases that look recorded, with a file each."""
    cfg = m.load_config()
    items = [{"id": f"satz-{n}", "text": f"Satz {n}", "tags": ["test"],
              "fingerprint": "x" * 12, "backend": "say", "voice_id": "say"}
             for n in range(count)]
    m.save_phrases(items)
    m.OUT.mkdir(parents=True, exist_ok=True)
    m.RAW.mkdir(parents=True, exist_ok=True)
    for item in items:
        m.out_file(item["id"], cfg).write_bytes(b"pretend-audio")
        (m.RAW / f"{item['id']}.wav").write_bytes(b"pretend-raw")
    return cfg


def ids_now() -> list[str]:
    return [i["id"] for i in m.load_phrases()]


# --- The cases ---------------------------------------------------------------

def check_counts_only_what_went(cfg) -> None:
    seed(4)
    gone, removed = m.delete_phrases(["satz-0", "satz-1", "gibtsnicht"])
    check("only the ids that were there are reported",
          gone == ["satz-0", "satz-1"], str(gone))
    check("the rest of the phrases stay",
          ids_now() == ["satz-2", "satz-3"], str(ids_now()))
    check("their audio goes with them",
          not m.out_file("satz-0", cfg).exists()
          and not m.out_file("satz-1", cfg).exists())
    check("and the raw recordings too",
          not (m.RAW / "satz-0.wav").exists(), str(removed[:2]))
    check("what is left is untouched", m.out_file("satz-2", cfg).exists())


def check_nothing_matches() -> None:
    seed(2)
    gone, removed = m.delete_phrases(["nope", "also-nope"])
    check("all-unknown deletes nothing", gone == [] and removed == [])
    check("and leaves the file alone", ids_now() == ["satz-0", "satz-1"],
          str(ids_now()))


def check_single_id_still_works(cfg) -> None:
    """The command line calls delete_phrase, one id at a time."""
    seed(2)
    ok, removed = m.delete_phrase("satz-0")
    check("a single delete reports success", ok is True)
    check("and removes the file", removed and not m.out_file("satz-0", cfg).exists(),
          str([f.name for f in removed]))
    ok, removed = m.delete_phrase("satz-0")
    check("deleting it again is a plain no", ok is False and removed == [])


def check_blank_ids() -> None:
    seed(1)
    gone, _ = m.delete_phrases(["", "   ", None])
    check("empty ids match nothing", gone == [], str(gone))
    check("and nothing is lost", ids_now() == ["satz-0"], str(ids_now()))


def check_dedupe_keeps_the_oldest(cfg) -> None:
    """Merging duplicates is the other place that removes files."""
    m.save_phrases([
        {"id": "a", "text": "Nochmal!", "tags": ["spiel"]},
        {"id": "b", "text": "nochmal!", "tags": ["zuhause"]},   # the same phrase
        {"id": "c", "text": "Nochmal.", "tags": []},            # not the same
    ])
    m.OUT.mkdir(parents=True, exist_ok=True)
    for pid in ("a", "b", "c"):
        m.out_file(pid, cfg).write_bytes(b"pretend-audio")

    keep, merges = m.dedupe(apply=False)
    check("a dry run finds the duplicate", len(merges) == 1, str(len(merges)))
    check("and changes nothing on disk", len(m.load_phrases()) == 3)
    check("punctuation still makes two phrases", len(keep) == 2, str(len(keep)))

    m.dedupe(apply=True)
    check("applying keeps the oldest", ids_now() == ["a", "c"], str(ids_now()))
    check("the merged one takes over the groups",
          m.load_phrases()[0]["tags"] == ["spiel", "zuhause"],
          str(m.load_phrases()[0]["tags"]))
    check("and its file goes", not m.out_file("b", cfg).exists())


def main() -> int:
    cfg = m.load_config()
    check_counts_only_what_went(cfg)
    check_nothing_matches()
    check_single_id_still_works(cfg)
    check_blank_ids()
    check_dedupe_keeps_the_oldest(cfg)

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
