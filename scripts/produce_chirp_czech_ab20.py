#!/usr/bin/env python3
"""20 source-verified Czech Chirp 3 HD AB clips, private, non-destructive.

Dry-run unless --generate. Billed calls strictly capped. No retries.
Every successful response is saved as immutable raw bytes before QA.
Human review is required for all model comparisons; failed clips stay saved.
"""
import argparse
import base64
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request
import wave

DEFAULT_MANIFEST = "production/ab_comparison/2026-11-21-gemini38-vs-chirp3hd-20.json"
PROJECT = "project-a699c3ff-995a-4b88-add"
URL = "https://texttospeech.googleapis.com/v1/text:synthesize"
EXPECTED_VOICE = "cs-CZ-Chirp3-HD-Achernar"
MAX_REQUESTS = 20


def validate_manifest(path):
    m = json.loads(Path(path).read_text(encoding="utf-8"))
    if (m.get("comparison_id") != "AHOJ_GEMINI38_VS_CHIRP3HD_CS_20_20261121"
            or m.get("publication_allowed") is not False
            or m.get("auto_delete") is not False
            or m.get("auto_retry") is not False
            or m.get("language_code") != "cs-CZ"
            or m.get("voice") != EXPECTED_VOICE
            or m.get("max_billable_requests") != MAX_REQUESTS):
        raise ValueError("UNAUTHORIZED_OR_CHANGED_MANIFEST")
    rows = m.get("rows")
    if not isinstance(rows, list) or len(rows) != MAX_REQUESTS:
        raise ValueError("EXPECTED_EXACTLY_20_TEST_ROWS")
    seen = set()
    for position, r in enumerate(rows, 1):
        if (r.get("index") != position or not isinstance(r.get("source_id"), str)
                or r["source_id"] in seen or r.get("gemini_style") != "natural"
                or r.get("gemini_voice") != "Achernar"
                or r.get("chirp_voice") != EXPECTED_VOICE):
            raise ValueError("INVALID_COMPARE_PAIR")
        seen.add(r["source_id"])
        cs = r.get("cs_exact")
        if not isinstance(cs, str) or not cs or len(cs) > 350 or "…" in cs:
            raise ValueError("UNRESOLVED_CZECH_TEXT")
        if hashlib.sha256(cs.encode("utf-8")).hexdigest() != r.get("text_sha256"):
            raise ValueError("SOURCE_TEXT_SHA256_MISMATCH:" + r["source_id"])
        if not isinstance(r.get("gemini_wav_sha256"), str) or len(r["gemini_wav_sha256"]) != 64:
            raise ValueError("MISSING_VERIFIED_GEMINI_BASELINE")
    return m


def chirp_request(text, bearer_token, voice=EXPECTED_VOICE):
    payload = {
        "input": {"text": text},
        "voice": {"languageCode": "cs-CZ", "name": voice},
        "audioConfig": {"audioEncoding": "LINEAR16"},
    }
    req = urllib.request.Request(
        URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + bearer_token,
            "Content-Type": "application/json; charset=utf-8",
            "x-goog-user-project": PROJECT,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=110) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # Never log a raw access token or API credentials.
        raise RuntimeError("CHIRP_HTTP_" + str(exc.code)) from exc
    audio = data.get("audioContent")
    if not isinstance(audio, str) or not audio:
        raise ValueError("EMPTY_CHIRP_AUDIO")
    return base64.b64decode(audio, validate=True)


def wav_diagnostic(raw):
    try:
        with wave.open(io.BytesIO(raw), "rb") as wav:
            sample_rate = wav.getframerate()
            duration = wav.getnframes() / max(1, sample_rate)
            channels, width = wav.getnchannels(), wav.getsampwidth()
        ok = 16000 <= sample_rate <= 96000 and channels == 1 and width == 2 and 0.35 <= duration <= 120
        return {
            "technical_pass": ok, "sample_rate": sample_rate, "channels": channels,
            "bit_depth": width * 8, "duration_seconds": round(duration, 3),
            "reason": None if ok else "UNEXPECTED_WAV_TECHNICAL_PROPERTIES",
        }
    except (EOFError, wave.Error, ValueError):
        return {"technical_pass": False, "reason": "INVALID_OR_INCOMPLETE_WAV"}


def persist_report(root, report):
    target = root / "chirp_comparison_report.json"
    staging = root / ".chirp_comparison_report.tmp"
    staging.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    staging.replace(target)


def run(manifest, output, count, token, synth=chirp_request):
    if output.exists() and any(output.iterdir()):
        raise ValueError("REFUSE_OVERWRITE_EXISTING_ARCHIVE")
    output.mkdir(parents=True, exist_ok=True)
    (output / "raw").mkdir(exist_ok=True)
    report = {
        "comparison_id": manifest["comparison_id"],
        "created_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "engine": "Google Cloud Text-to-Speech Chirp 3 HD",
        "voice": EXPECTED_VOICE,
        "publication_allowed": False,
        "auto_delete": False,
        "owner_comparison_required": True,
        "requested_max_billable_calls": count,
        "attempted_billable_calls": 0,
        "rows": [],
    }
    for item in manifest["rows"][:count]:
        receipt = {
            "index": item["index"], "source_id": item["source_id"],
            "cs_exact": item["cs_exact"], "source_sha256": item["text_sha256"],
            "existing_gemini38_wav_sha256": item["gemini_wav_sha256"],
            "voice": EXPECTED_VOICE, "owner_review_status": "PENDING",
            "publish_allowed": False,
        }
        report["attempted_billable_calls"] += 1
        raw_path = None
        try:
            raw = synth(item["cs_exact"], token)
            wav_sha = hashlib.sha256(raw).hexdigest()
            raw_path = output / "raw" / (f'{item["index"]:02d}_{item["source_id"]}'
                                         f'__Chirp3HD_Achernar__{wav_sha[:12]}.wav')
            with raw_path.open("xb") as file:
                file.write(raw)
            technical = wav_diagnostic(raw)
            receipt.update({
                "decision": "OWNER_REVIEW_PENDING" if technical["technical_pass"] else "QUARANTINED",
                "storage_relative_path": str(raw_path.relative_to(output)),
                "wav_sha256": wav_sha, "wav_bytes": len(raw), "technical": technical,
            })
        except Exception as exc:
            # A generated file is never deleted, even if later validation fails.
            receipt.update({"decision": "QUARANTINED" if raw_path and raw_path.exists()
                            else "GENERATION_FAILED",
                            "error": str(exc)[:200], "possible_billing": True})
        report["rows"].append(receipt)
        persist_report(output, report)
        print("CHIRP_RESULT", receipt["index"], receipt["decision"], flush=True)
        # Stop on rate limiting, permission denial or malformed responses.
        # No blind retries of potentially billed requests.
        if receipt["decision"] == "GENERATION_FAILED":
            report["stopped_after_error"] = True
            persist_report(output, report)
            break
    report["unattempted_indices"] = [
        x["index"] for x in manifest["rows"] if x["index"] not in
        {r["index"] for r in report["rows"]}
    ]
    persist_report(output, report)
    return report


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--manifest", default=DEFAULT_MANIFEST)
    p.add_argument("--out-dir", default="/tmp/ahoj-chirp-ab20")
    p.add_argument("--max-requests", type=int, default=MAX_REQUESTS)
    p.add_argument("--generate", action="store_true")
    args = p.parse_args()
    manifest = validate_manifest(args.manifest)
    if not 1 <= args.max_requests <= MAX_REQUESTS:
        p.error("max-requests must be 1..20")
    print("AB_TEST", manifest["comparison_id"], "CHIRP_UPPER_BOUND",
          args.max_requests, "VOICE", EXPECTED_VOICE, "PRIVATE_ONLY", True)
    if not args.generate:
        print("DRY_RUN_OK; NO API CALLS, NO CHARGES")
        return
    if (os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("AHOJ_CHIRP_AB_AUTHORIZED") != "YES_20_MAX"
            or not os.environ.get("AHOJ_GCP_ACCESS_TOKEN")):
        raise SystemExit("KEYLESS_AUTH_OR_EXPLICIT_CAP_MISSING")
    report = run(manifest, Path(args.out_dir), args.max_requests,
                 os.environ["AHOJ_GCP_ACCESS_TOKEN"])
    print("AB_TEST_GENERATED",
          sum(x["decision"] in ("OWNER_REVIEW_PENDING", "QUARANTINED")
              for x in report["rows"]),
          "REQUESTS_ATTEMPTED", report["attempted_billable_calls"],
          "UNATTEMPTED", len(report["unattempted_indices"]))
    if any(x["decision"] == "GENERATION_FAILED" for x in report["rows"]):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
