#!/usr/bin/env python3
"""PRIVATE ElevenLabs History recovery: never generates new TTS or publishes audio."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.elevenlabs.io/v1"
SAFE_MP3 = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{1,190}\.mp3$")


def exact(text):
    """Only NFC normalization; do not strip accents, punctuation, whitespace or change case."""
    return unicodedata.normalize("NFC", text)


def valid_manifest(path, expected=246):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    rows = data.get("records")
    if not isinstance(rows, list) or not rows or len(rows) != expected:
        raise ValueError(f"Invalid private manifest row count: expected {expected}")
    ids, names, pairs = set(), set(), set()
    for row in rows:
        for field in ("source_id", "cs_exact", "voice_id", "model", "output_file_expected_name"):
            if not isinstance(row.get(field), str) or not row[field]:
                raise ValueError(f"Missing {field} in manifest")
        sid, name = row["source_id"], row["output_file_expected_name"]
        pair = (exact(row["cs_exact"]), row["voice_id"], row["model"])
        if sid in ids or name in names or pair in pairs:
            raise ValueError("Duplicate source ID, filename or exact text+voice+model")
        if not SAFE_MP3.fullmatch(name) or Path(name).name != name:
            raise ValueError("Unsafe MP3 output filename")
        ids.add(sid)
        names.add(name)
        pairs.add(pair)
    return rows


def get(path, api_key, params=None, tries=4):
    url = BASE + path + (("?" + urllib.parse.urlencode(params)) if params else "")
    request = urllib.request.Request(url, headers={
        "xi-api-key": api_key,
        "Accept": "application/json, audio/mpeg, application/octet-stream",
        "User-Agent": "AhojPrivateAutoAudioG1/1.2",
    })
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(request, timeout=50) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise RuntimeError("History Read authentication / permission failure") from None
            if exc.code not in (429, 500, 502, 503, 504) or attempt == tries - 1:
                raise RuntimeError(f"History API HTTP {exc.code}") from None
            time.sleep(min(20, 2 ** attempt))
        except urllib.error.URLError:
            if attempt == tries - 1:
                raise RuntimeError("Network error during history retrieval") from None
            time.sleep(min(20, 2 ** attempt))
    raise RuntimeError("Retry limit exceeded")


def list_history(key, after="2026-11-20", page_limit=100):
    ts = int(dt.datetime.strptime(after, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc).timestamp())
    rows, seen, cursor = [], set(), None
    for _ in range(page_limit):
        params = {"page_size": 1000, "date_after_unix": ts, "sort_direction": "desc"}
        if cursor:
            params["start_after_history_item_id"] = cursor
        response = json.loads(get("/history", key, params))
        items = response.get("history")
        if not isinstance(items, list):
            raise RuntimeError("Invalid History API response")
        rows.extend(items)
        if not response.get("has_more"):
            return rows, True
        cursor = response.get("last_history_item_id")
        if not cursor or cursor in seen:
            raise RuntimeError("History pagination cursor did not advance")
        seen.add(cursor)
    return rows, False


def match_manifest(rows, history, scanned_all):
    by_key = {}
    for item in history:
        if item.get("history_item_id") and isinstance(item.get("text"), str):
            k = (exact(item["text"]), item.get("voice_id"), item.get("model_id"))
            by_key.setdefault(k, []).append(item)
    result = []
    for row in rows:
        pair = (exact(row["cs_exact"]), row["voice_id"], row["model"])
        matches = by_key.get(pair, [])
        # History source uses TTS/Projects/etc.; it does not reliably label
        # creative Flow node provenance. Never infer that 'source' must be 'Flows'.
        # If several exact text+voice+model candidates remain, block ambiguity.
        if row.get("history_item_id"):
            matches = [x for x in matches if x["history_item_id"] == row["history_item_id"]]
        if len(matches) == 1:
            result.append({"source_id": row["source_id"], "status": "matched", "history_item_id": matches[0]["history_item_id"], "file_name": row["output_file_expected_name"], "origin": matches[0].get("source", "unknown")})
        elif len(matches) > 1:
            result.append({"source_id": row["source_id"], "status": "ambiguous", "candidate_history_ids": [x["history_item_id"] for x in matches]})
        else:
            result.append({"source_id": row["source_id"], "status": "missing" if scanned_all else "not_found_in_partial_history"})
    return result


def looks_like_mp3(data):
    return len(data) > 200 and (data[:3] == b"ID3" or (data[0] == 0xFF and (data[1] & 0xE0) == 0xE0))


def audio_duration_ms(path):
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    run = subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
                         capture_output=True, text=True, timeout=30)
    if run.returncode != 0:
        return None
    try:
        sec = float(run.stdout.strip())
        return round(sec * 1000) if 0 < sec < 3600 else None
    except (ValueError, OverflowError):
        return None


def save_report(path, data):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def export(rows, matched, key, outdir, *, download=False, max_files=0):
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    path = outdir / ("EXPORT_RECEIPT.json" if download else "HISTORY_MATCH_REPORT.json")
    receipt = json.loads(path.read_text(encoding="utf-8")) if download and path.exists() else {
        "mode": "PRIVATE_HISTORY_RECOVERY", "published": False, "drive_uploads": 0,
        "records": {}
    }
    row_index = {r["source_id"]: r for r in rows}
    attempted = 0
    for m in matched:
        sid = m["source_id"]
        if m["status"] != "matched" or not download:
            receipt["records"][sid] = dict(m)
            continue
        if max_files and attempted >= max_files:
            receipt["records"][sid] = {**m, "status": "matched_not_downloaded_limit"}
            continue
        attempted += 1
        target = outdir / row_index[sid]["output_file_expected_name"]
        old = receipt["records"].get(sid, {})
        if target.exists():
            content = target.read_bytes()
            digest = hashlib.sha256(content).hexdigest()
            if (old.get("status") in ("archived_local", "qa_pending_duration")
                and old.get("history_item_id") == m["history_item_id"]
                and old.get("sha256") == digest and looks_like_mp3(content)):
                receipt["records"][sid] = {**old, "resume_verified": True}
                save_report(path, receipt)
                continue
            receipt["records"][sid] = {**m, "status": "blocked_existing_unverified_file"}
            save_report(path, receipt)
            continue
        try:
            media = get("/history/" + urllib.parse.quote(m["history_item_id"], safe="") + "/audio", key)
            if not looks_like_mp3(media):
                receipt["records"][sid] = {**m, "status": "invalid_mp3"}
                save_report(path, receipt)
                continue
            temp = target.with_suffix(target.suffix + ".download")
            with temp.open("xb") as handle:
                handle.write(media)
                handle.flush()
                os.fsync(handle.fileno())
            temp.replace(target)
            duration = audio_duration_ms(target)
            receipt["records"][sid] = {
                **m, "status": "archived_local" if duration else "qa_pending_duration",
                "sha256": hashlib.sha256(media).hexdigest(), "size_bytes": len(media),
                "duration_ms": duration, "drive_file_id": None, "published": False,
            }
        except Exception as exc:
            # Never include request body, API key, or private text in error records.
            receipt["records"][sid] = {**m, "status": "download_error", "exception": type(exc).__name__}
        save_report(path, receipt)
    if not download:
        save_report(path, receipt)
    counts = {}
    for item in receipt["records"].values():
        counts[item["status"]] = counts.get(item["status"], 0) + 1
    return counts


def main():
    p = argparse.ArgumentParser(description="Recover existing ElevenLabs Flow audio privately; NEVER generate new TTS")
    p.add_argument("--manifest", required=True, type=Path, help="private JSON file; never commit to public repository")
    p.add_argument("--outdir", type=Path, default=Path("private_recovery"))
    p.add_argument("--after", default="2026-11-20")
    p.add_argument("--page-limit", type=int, default=100)
    p.add_argument("--expected", type=int, default=246)
    p.add_argument("--download", action="store_true", help="explicitly download previously-generated History audio")
    p.add_argument("--max-files", type=int, default=0, help="pilot: 1 or 5; 0 means no limit")
    args = p.parse_args()
    if args.page_limit < 1 or args.max_files < 0 or args.expected < 1:
        p.error("Invalid numeric argument")
    rows = valid_manifest(args.manifest, args.expected)
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key:
        print("ELEVENLABS_API_KEY not found; set it only in private runtime secrets.", file=sys.stderr)
        return 2
    history, complete = list_history(key, args.after, args.page_limit)
    matches = match_manifest(rows, history, complete)
    counts = export(rows, matches, key, args.outdir, download=args.download, max_files=args.max_files)
    print(json.dumps({"history_scanned": len(history), "scanned_entire_history": complete,
                      "expected": len(rows), "statuses": counts,
                      "download_existing": args.download, "published": False}, ensure_ascii=False, indent=2))
    return 0 if complete and all(x["status"] == "matched" for x in matches) else 3


if __name__ == "__main__":
    raise SystemExit(main())
