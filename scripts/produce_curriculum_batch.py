#!/usr/bin/env python3
"""Private Czech lesson-batch TTS with zero-touch, fail-closed automatic QA.
Run only with an explicit, bounded approved source manifest and --generate.
No Google Drive/GCS writes, no Curriculum publish, no service-account JSON keys.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import uuid
from voice_quality_full_sentence import fetch_audio, access_token, MODEL, VOICE
from auto_audio_qa import inspect_wav, score_text, asr_engine, transcribe
from polish_internal_pauses import optimize_silence

ALLOWED_EMOTIONS = {"neutral", "polite_warmth", "curious", "reassuring", "concerned", "happy", "urgent"}
ALLOWED_INTENTS = {"polite_greeting", "polite_question", "self_introduction", "request_clarification",
                   "offer_help", "thank_you", "ask_directions", "give_directions", "other"}
ALLOWED_STYLES = ("natural", "learning_slow")
MAX_ROWS = 8
MAX_REQUESTS = 16


def source_validate(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("dataset_version") != "v0.9.20":
        raise ValueError("Incorrect canonical source version")
    if data.get("scope") != "PRIVATE_INTERNAL_STAGING_ONLY" or data.get("publish_allowed") is not False:
        raise ValueError("Production release not authorized")
    if data.get("model") != MODEL or data.get("voice") != VOICE:
        raise ValueError("Model/voice mismatch; refused instead of guessing")
    variants = data.get("variants")
    if variants != list(ALLOWED_STYLES):
        raise ValueError("Expected Natural and Learning Slow, in that order")
    rows = data.get("rows")
    max_calls = data.get("max_billable_requests")
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_ROWS or len(rows)*len(variants) > MAX_REQUESTS:
        raise ValueError("Unbounded or empty batch")
    if type(max_calls) is not int or max_calls != len(rows) * len(variants):
        raise ValueError("Explicit billable call cap does not match batch")
    seen = set()
    for row in rows:
        uid = row.get("source_id")
        sentence = row.get("cs_exact")
        if not isinstance(uid, str) or not re.fullmatch(r"CZ-A0-M\d\d-L\d\d-PH\d\d\d", uid):
            raise ValueError("Invalid canonical source ID")
        if uid in seen:
            raise ValueError("Duplicate source ID")
        seen.add(uid)
        if not isinstance(sentence, str) or not sentence or len(sentence) > 380 or "…" in sentence:
            raise ValueError("Empty or unresolved template source")
        if row.get("text_sha256") != hashlib.sha256(sentence.encode("utf-8")).hexdigest():
            raise ValueError("Source text SHA256 mismatch " + uid)
        if row.get("source_gate") == "BLOCK_DOMAIN":
            raise ValueError("BLOCK_DOMAIN cannot enter production batch")
        if row.get("source_gate") != "language_prosody_review":
            raise ValueError("Unexpected source gate")
        if row.get("kind") not in ("phrase", "dialogue_turn"):
            raise ValueError("Unknown utterance kind")
        if row.get("intent") not in ALLOWED_INTENTS or row.get("emotion") not in ALLOWED_EMOTIONS:
            raise ValueError("Unverified intent or emotion classification")
        if row.get("kind") == "dialogue_turn" and not row.get("speaker_role"):
            raise ValueError("Dialogue requires a speaker role")
    return data


def voice_direction(row, style):
    # Czech text always remains isolated in the exact 'text' field.
    # Do not speak the prompt or invented explanations in the recording.
    base = (
        "Speak only the exact supplied Czech words. Fluent, coherent Czech speech; "
        "no filler words, hesitation, false starts or theatrical mid-sentence pauses. "
        "Respect Czech vowel lengths, consonants and natural stress. "
    )
    if row["kind"] == "dialogue_turn":
        role = re.sub(r"[^a-zA-Z0-9 _-]", "", row["speaker_role"])[:45]
        emotion = row["emotion"].replace("_", " ")
        return (
            base + f"You are speaking a real-life dialogue turn as {role}. "
            f"Convey only a subtle, context-appropriate {emotion} tone, not a dramatic performance. "
            + ("Use natural conversational flow." if style == "natural"
               else "Use a slightly slower but fluent teaching-friendly rhythm.")
        )
    if style == "natural":
        return (base + "A kind adult Czech language teacher demonstrates this utterance naturally: "
                "warm, calm and reassuring; moderate everyday pace, not childish or singsong.")
    return (base + "A kind adult Czech language teacher demonstrates this utterance slightly slower, "
            "clearly and warmly, while linking the syllables naturally without exaggerated gaps.")


def automated_quality(path, row, style, small_model, medium_state):
    # A machine PASS verifies audio integrity / transcript / basic pacing, not native phonology.
    technical = inspect_wav(path)
    gap_limit = 0.34 if style == "natural" else 0.38
    technical["project_internal_pause_limit_seconds"] = gap_limit
    if technical.get("max_internal_pause_seconds", 0) > gap_limit:
        technical["technical_pass"] = False
        technical["reasons"].append("UNNATURAL_MID_SENTENCE_PAUSE")
    if not technical["technical_pass"]:
        return {"decision": "QUARANTINED", "technical": technical, "recognized_text": "",
                "reason": "TECHNICAL_OR_PAUSE_GATE"}
    try:
        heard = transcribe(small_model, path)
        quality = score_text(row["cs_exact"], heard)
    except Exception as exc:
        return {"decision": "QUARANTINED", "technical": technical, "recognized_text": "",
                "reason": "ASR_ERROR", "detail": str(exc)[:200]}
    if quality["exact"]:
        return {"decision": "AUTO_PASS", "technical": technical, "recognized_text": heard,
                "asr_model": "small", "accuracy": quality}
    # Second ASR pass is automatic; no owner review.
    try:
        if medium_state["model"] is None:
            medium_state["model"] = asr_engine("medium")
        heard2 = transcribe(medium_state["model"], path)
        quality2 = score_text(row["cs_exact"], heard2)
        return {"decision": "AUTO_PASS" if quality2["exact"] else "QUARANTINED",
                "technical": technical, "recognized_text": heard2, "asr_model": "medium",
                "accuracy": quality2, "initial_asr": heard, "initial_accuracy": quality}
    except Exception as exc:
        return {"decision": "QUARANTINED", "technical": technical, "recognized_text": heard,
                "asr_model": "small", "accuracy": quality, "reason": "FALLBACK_ASR_ERROR",
                "detail": str(exc)[:200]}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--manifest", required=True)
    p.add_argument("--out-dir", default="/tmp/ahoj-curriculum-pilot")
    p.add_argument("--generate", action="store_true", help="Exactly capped, potentially billable Vertex TTS calls")
    p.add_argument("--only-source", help="Restrict a correction to one previously authorized source ID")
    p.add_argument("--only-style", choices=ALLOWED_STYLES,
                   help="Restrict a correction to one previously authorized voice style")
    p.add_argument("--repair-jm", action="store_true",
                   help="Correct the documented initial jm-cluster omission in PH003")
    args = p.parse_args()
    cfg = source_validate(args.manifest)
    if bool(args.only_source) != bool(args.only_style):
        p.error("--only-source and --only-style must both be specified")
    if args.only_source:
        cfg["rows"] = [r for r in cfg["rows"] if r["source_id"] == args.only_source]
        cfg["variants"] = [args.only_style]
        if len(cfg["rows"]) != 1:
            raise SystemExit("UNKNOWN_OR_UNAUTHORIZED_SOURCE")
    if args.repair_jm and (args.only_source != "CZ-A0-M01-L01-PH003" or args.only_style != "natural"):
        p.error("--repair-jm requires only PH003 Natural")
    count = len(cfg["rows"]) * len(cfg["variants"])
    print("AHOJ_FIRST_LESSON_BATCH_READY", cfg["batch_id"], "sources", len(cfg["rows"]),
          "TTS_calls", count, "private_only", True)
    if not args.generate:
        for r in cfg["rows"]:
            print("SOURCE", r["source_id"], r["cs_exact"])
        print("DRY_RUN_OK — no Google Cloud calls, no audio, no Drive writes")
        return
    if os.environ.get("GITHUB_ACTIONS") != "true" or not os.environ.get("AHOJ_GCP_ACCESS_TOKEN"):
        raise SystemExit("AUTH_FAILED_CLOSED: requires GitHub OIDC token")
    output = Path(args.out_dir)
    if output.exists() and any(output.iterdir()):
        raise SystemExit("REFUSE_OVERWRITE: output folder is not empty")
    output.mkdir(parents=True, exist_ok=True)
    token = access_token()
    model = asr_engine("small")
    medium = {"model": None}
    report = {
        "batch_id": cfg["batch_id"], "source_version": cfg["dataset_version"],
        "mode": "PRIVATE_INTERNAL_STAGING_ONLY", "release_allowed": False,
        "requested_calls": count, "attempted_calls": 0,
        "qa_policy": "automated WAV+ASR+pause: NO HUMAN PASS, NO STUDENT PUBLICATION",
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "rows": [], "counts": {"AUTO_PASS": 0, "QUARANTINED": 0, "GENERATION_FAILED": 0},
    }
    (output / "approved").mkdir(exist_ok=True)
    (output / "quarantine").mkdir(exist_ok=True)
    for source in cfg["rows"]:
        for style in cfg["variants"]:
            uid = source["source_id"]
            record = {"source_id": uid, "lesson_id": source["lesson_id"],
                      "source_sha256": source["text_sha256"], "text": source["cs_exact"],
                      "style": style, "intent": source["intent"], "emotion": source["emotion"],
                      "speaker_role": source["speaker_role"],
                      "source_gate": source["source_gate"], "publication_gate": "BLOCKED_FOR_RELEASE"}
            try:
                direction = voice_direction(source, style)
                if args.repair_jm:
                    direction += (" Pay attention to the distinct initial Czech consonant sequence "
                                  "j-m in the word jmenujete. Pronounce that word fully and naturally; "
                                  "do not omit its first consonant or add any explanatory words.")
                print("GENERATE", uid, style, flush=True)
                report["attempted_calls"] += 1
                audio, info = fetch_audio(style, direction, token, text=source["cs_exact"])
                original_audio_sha = info["audio_sha256"]
                filename = f"{uid}__{style}__teacher-v1__{original_audio_sha[:12]}.wav"
                tmp = output / filename
                tmp.write_bytes(audio)
                technical_preview = inspect_wav(tmp)
                gap_limit = 0.34 if style == "natural" else 0.38
                if technical_preview.get("technical_pass") and technical_preview.get("max_internal_pause_seconds", 0) > gap_limit:
                    # One bounded waveform adjustment, removing ONLY excessive silence.
                    repaired, edits = optimize_silence(audio)
                    if len(edits) <= 3 and sum(x["removed_seconds"] for x in edits) <= 1.2 and edits:
                        audio = repaired
                        tmp.write_bytes(audio)
                        record["silence_polish"] = edits
                quality = automated_quality(tmp, source, style, model, medium)
                destination = output / ("approved" if quality["decision"] == "AUTO_PASS" else "quarantine") / filename
                tmp.rename(destination)
                record.update({"decision": quality["decision"], "filename": destination.name,
                               "storage_relative_path": str(destination.relative_to(output)),
                               "audio_sha256": hashlib.sha256(audio).hexdigest(),
                               "original_audio_sha256": original_audio_sha,
                               "duration_ms": round(1000 * quality["technical"].get("duration_seconds", 0)),
                               "wav_bytes": len(audio), "model": MODEL, "voice": VOICE,
                               "voice_prompt": direction, "qa": quality})
                print("QA", uid, style, quality["decision"], "pause_seconds",
                      quality["technical"].get("max_internal_pause_seconds"), flush=True)
                report["counts"][quality["decision"]] += 1
            except Exception as exc:
                record.update({"decision": "GENERATION_FAILED",
                               "error": str(exc)[:400], "potentially_billed": True})
                report["counts"]["GENERATION_FAILED"] += 1
                print("FAIL", uid, style, str(exc)[:200], file=sys.stderr, flush=True)
            report["rows"].append(record)
            (output / "production_report.json").write_text(
                json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print("BATCH_DONE", json.dumps(report["counts"], sort_keys=True),
          "billed_requests_attempted", report["attempted_calls"])
    # No automatic upload, merge, or student-facing publishing.


if __name__ == "__main__":
    main()
