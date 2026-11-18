#!/usr/bin/env python3
"""One-time, owner-run 2-variant Czech full-sentence voice QA via Vertex AI.

Default is --dry-run: NO Google API calls. --generate performs exactly two
TTS POST attempts (no retries), then writes WAV and immutable QA metadata to
a new private GCS prefix. This is NOT canonical course material.
"""
import argparse
import base64
import datetime as dt
import hashlib
import io
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave

PROJECT = "project-a699c3ff-995a-4b88-add"
BUCKET = "ahoj-cesko-audio-814331085807"
MODEL = "gemini-3.8-flash-tts"
VOICE = "Achernar"
LOCATION = "global"
URL = (
    "https://aiplatform.googleapis.com/v1/projects/"
    + PROJECT + "/locations/" + LOCATION
    + "/publishers/google/models/" + MODEL + ":generateContent"
)
TEXT = "Můžete mi prosím říct, kde je nejbližší autobusová zastávka a jak se tam dostanu?"
SOURCE_ID = "QA-ONLY-FULL-SENTENCE-001"
STYLES = {
    "natural": (
        "Warm, relaxed, authentic conversational Czech. Human-like intonation, "
        "natural rhythm, unhurried delivery, clear but not exaggerated articulation."
    ),
    "learning_slow": (
        "Calm, clearly articulated Czech for an adult beginner. Moderately slower "
        "than natural speech, smooth connected pronunciation, natural vowel lengths, "
        "no robotic pauses."
    ),
}


def print_plan():
    print("AHOJ FULL SENTENCE VOICE QA — two variants, canonical source unchanged")
    print("Czech text:", TEXT)
    print("Model:", MODEL, "| Voice:", VOICE)
    print("QA only — NOT part of v0.9.20 canonical lessons")
    print("Variants:", ", ".join(STYLES))
    print("Private bucket:", BUCKET)
    print("No automatic retries, no Drive sync, no publish.")


def access_token():
    # GitHub Actions supplies this token through a temporary masked output.
    # Never print it, write it to files, or place it in the GitHub artifact.
    from_env = os.environ.get("AHOJ_GCP_ACCESS_TOKEN", "").strip()
    if from_env:
        return from_env
    result = subprocess.run(
        ["gcloud", "auth", "print-access-token"],
        check=True, capture_output=True, text=True,
    )
    token = result.stdout.strip()
    if not token:
        raise RuntimeError("gcloud access token was empty")
    return token


def post_json(url, body, token, content_type="application/json", method="POST"):
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Authorization": "Bearer " + token, "Content-Type": content_type},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=150) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        message = exc.read(600).decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {message}") from exc


def fetch_audio(style_name, style_prompt, token, text=TEXT):
    request_body = {
        "contents": [{
            "role": "user",
            "parts": [{
                "text": text,
                "speechMetadata": {"style": style_prompt}
            }],
        }],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"voice": VOICE}}
        },
    }
    response = post_json(
        URL,
        json.dumps(request_body, ensure_ascii=False).encode("utf-8"),
        token
    )
    parts = response.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    inline = next(
        (p["inlineData"] for p in parts
         if isinstance(p, dict) and isinstance(p.get("inlineData"), dict)
         and p["inlineData"].get("data")),
        None,
    )
    if inline is None:
        raise ValueError("No inline audio in TTS response")
    mime = (inline.get("mimeType") or "").lower()
    raw = base64.b64decode(inline["data"], validate=True)
    if len(raw) > 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WAVE":
        wav_bytes = raw
    elif "pcm" in mime or "l16" in mime:
        match = re.search(r"rate=(\d+)", mime)
        sample_rate = int(match.group(1)) if match else 24000
        if len(raw) % 2:
            raise ValueError("Invalid PCM16 byte count")
        writer = io.BytesIO()
        with wave.open(writer, "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(sample_rate)
            output.writeframes(raw)
        wav_bytes = writer.getvalue()
    else:
        raise ValueError("Unsupported returned audio type: " + mime)
    with wave.open(io.BytesIO(wav_bytes), "rb") as file:
        sample_rate = file.getframerate()
        channels = file.getnchannels()
        bit_depth = file.getsampwidth() * 8
        duration_ms = round(1000 * file.getnframes() / sample_rate)
    if sample_rate <= 0 or channels != 1 or bit_depth != 16 or duration_ms < 500:
        raise ValueError("Invalid WAV format or duration")
    return wav_bytes, {
        "status": "QA_PENDING",
        "style": style_name,
        "sample_rate": sample_rate,
        "channels": channels,
        "bit_depth": bit_depth,
        "duration_ms": duration_ms,
        "size_bytes": len(wav_bytes),
        "audio_sha256": hashlib.sha256(wav_bytes).hexdigest(),
        "response_id": response.get("responseId"),
    }


def upload_private(bucket, name, content, token, mime):
    args = urllib.parse.urlencode({
        "uploadType": "media",
        "name": name,
        "ifGenerationMatch": "0",
    })
    url = "https://storage.googleapis.com/upload/storage/v1/b/" + bucket + "/o?" + args
    return post_json(url, content, token, content_type=mime)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--generate", action="store_true",
                        help="Perform TWO real, potentially billable Vertex TTS calls")
    parser.add_argument("--artifact-only", action="store_true",
                        help="Save local WAV+receipt only; no Cloud Storage operations")
    parser.add_argument("--only-style", choices=["natural", "learning_slow"],
                        help="One-time bounded retry: synthesize only one style.")
    parser.add_argument("--natural-repair", action="store_true",
                        help="Keep exact text but request clearer Czech morphological endings.")
    parser.add_argument("--fluent-v2", action="store_true",
                        help="Use fluent, non-hesitant delivery for both exact-text variants.")
    args = parser.parse_args()
    if args.natural_repair and args.only_style != "natural":
        parser.error("--natural-repair requires --only-style natural")
    print_plan()
    if not args.generate:
        print("DRY_RUN_OK — no TTS, no GCS writes.")
        return
    if os.environ.get("GITHUB_ACTIONS") == "true" and not args.artifact_only:
        raise SystemExit("GitHub Actions TTS must use --artifact-only (GCS prohibited)")
    run_id = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    prefix = "qa-only/full-sentence/" + run_id
    out_dir = pathlib.Path(os.environ.get("AHOJ_VOICE_QA_OUTPUT_DIR",
                                         str(pathlib.Path.home() / "ahoj-full-sentence-qa" / run_id)))
    out_dir.mkdir(parents=True, exist_ok=False)
    token = access_token()
    receipt = {
        "purpose": "VOICE_QUALITY_QA_ONLY_NOT_CANONICAL",
        "source_id": SOURCE_ID,
        "text": TEXT,
        "text_sha256": hashlib.sha256(TEXT.encode("utf-8")).hexdigest(),
        "model": MODEL,
        "voice": VOICE,
        "location": LOCATION,
        "created_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "run_id": run_id,
        "qa_status": "REVIEW",
        "no_drive_sync": True,
        "delivery_prompt_version": "fluent-v2" if args.fluent_v2 else "legacy",
        "variants": {},
    }
    print("Creating exactly one or two separate full-sentence WAVs; NO automatic repeats.")
    wanted_styles = [args.only_style] if args.only_style else list(STYLES)
    for name in wanted_styles:
        prompt = STYLES[name]
        if args.fluent_v2:
            prompt = (
                "Fluent, connected Czech spoken as one coherent question, with "
                "steady natural rhythm. No hesitation, filler sounds, false starts, "
                "or dramatic breaks. Only a light, short pause at the comma. "
                "Clear Czech vowel lengths and consonants; do not change any words."
                if name == "natural" else
                "Clear, fluent Czech for an adult beginner at a slightly slower "
                "teaching pace, with connected words and smooth natural intonation. "
                "No hesitation, filler sounds, false starts, or drawn-out pauses. "
                "Only a light, short pause at the comma; preserve each exact word."
            )
        if args.natural_repair and name == "natural":
            prompt = (
                "Authentic warm conversational Czech, measured and clear. "
                "Speak the provided Czech sentence exactly, without word substitution. "
                "Articulate first-person verb endings distinctly (not as third-person plural); "
                "preserve natural prosody, vowel lengths and interrogative intonation."
            )
        print("TTS request:", name, "(one request)")
        try:
            wav_bytes, metadata = fetch_audio(name, prompt, token)
        except Exception as exc:
            print("ERROR during", name, ":", str(exc), file=sys.stderr)
            print("Do NOT rerun automatically: a network error may be ambiguously billed.", file=sys.stderr)
            raise SystemExit(1)
        filename = "QA_ONLY_FULL_SENTENCE_" + name + ".wav"
        local_file = out_dir / filename
        local_file.write_bytes(wav_bytes)
        cloud_path = prefix + "/" + filename
        metadata["style_prompt"] = prompt
        metadata["local_file"] = str(local_file)
        metadata["gcs_path"] = None if args.artifact_only else "gs://" + BUCKET + "/" + cloud_path
        receipt["variants"][name] = metadata
        (out_dir / "receipt.json").write_text(
            json.dumps(receipt, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        if args.artifact_only:
            print(name, "saved as private GitHub Actions artifact:", local_file)
            print("duration_ms:", metadata["duration_ms"], "sha256:", metadata["audio_sha256"])
            continue
        try:
            upload_private(BUCKET, cloud_path, wav_bytes, token, "audio/wav")
        except Exception as exc:
            print("GCS UPLOAD ERROR (WAV is saved locally):", str(exc), file=sys.stderr)
            print("No TTS retry needed. Existing local WAV can be uploaded separately.", file=sys.stderr)
            raise SystemExit(2)
        print(name, "saved:", metadata["gcs_path"])
        print("duration_ms:", metadata["duration_ms"], "sha256:", metadata["audio_sha256"])
    receipt_file = out_dir / "receipt.json"
    receipt_bytes = json.dumps(receipt, indent=2, ensure_ascii=False).encode("utf-8")
    receipt_file.write_bytes(receipt_bytes)
    if args.artifact_only:
        print("FULL_SENTENCE_QA_READY — selected WAV(s) saved for private GitHub artifact; QA REVIEW.")
        print("LOCAL:", out_dir)
        return
    try:
        upload_private(BUCKET, prefix + "/receipt.json", receipt_bytes, token, "application/json")
    except Exception as exc:
        print("Receipt upload failed; local copy remains:", str(exc), file=sys.stderr)
        raise SystemExit(2)
    print("FULL_SENTENCE_QA_READY — files stored in private GCS; QA status REVIEW.")
    print("LOCAL:", out_dir)
    print("GCS:", "gs://" + BUCKET + "/" + prefix)
    print("Download both WAVs from Google Cloud Storage to compare them on iPhone.")


if __name__ == "__main__":
    main()
