#!/usr/bin/env python3
"""Ahoj Česko automatic audio QA, independent of Vertex TTS.

Fail-closed auto QA:
* Verify WAV/PCM16 format, duration, amplitude, silence, clipping and SHA-256.
* Transcribe *each WAV independently* with offline Czech Whisper ASR.
* Compare normalized transcription to the immutable exact Czech source text.
* Mark AUTO_PASS or QUARANTINED; NEVER grant Curriculum publish permission.
* Produce an auditable JSON report; no human approval step or paid API.
"""
from __future__ import annotations

import argparse
import array
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import unicodedata
import wave


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFC", s).casefold()
    s = "".join(c if (c.isalpha() or c.isdigit()) else " " for c in s)
    return re.sub(r"\s+", " ", s).strip()


def edit_distance(a, b) -> int:
    # Two-row Levenshtein, fast for a sentence and independent of pip modules.
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(cur[-1] + 1, prev[j] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def score_text(ref: str, hyp: str) -> dict:
    expected, heard = normalize(ref), normalize(hyp)
    words_a, words_b = expected.split(), heard.split()
    return {
        "expected_normalized": expected,
        "asr_normalized": heard,
        "wer": round(edit_distance(words_a, words_b) / max(1, len(words_a)), 4),
        "cer": round(edit_distance(expected, heard) / max(1, len(expected)), 4),
        "exact": expected == heard,
    }


def inspect_wav(path: Path) -> dict:
    try:
        with wave.open(str(path), "rb") as wf:
            channels, width = wf.getnchannels(), wf.getsampwidth()
            rate, total = wf.getframerate(), wf.getnframes()
            frames = wf.readframes(total)
    except (EOFError, wave.Error, OSError, ValueError) as exc:
        return {"technical_pass": False, "reasons": ["WAV_PARSE_ERROR:" + str(exc)]}
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    duration = round(total / rate, 4) if rate else 0
    reasons = []
    if channels != 1 or width != 2 or rate != 24000:
        reasons.append("EXPECTED_PCM16_MONO_24KHZ")
    if not (0.55 <= duration <= 180):
        reasons.append("DURATION_OUT_OF_RANGE")
    if not frames:
        reasons.append("EMPTY_WAV")
    pcm = array.array("h")
    pcm.frombytes(frames)
    if sys.byteorder != "little":
        pcm.byteswap()
    n = len(pcm)
    if not n:
        reasons.append("NO_SAMPLES")
    sum_sq = sum(int(v) * int(v) for v in pcm)
    rms = math.sqrt(sum_sq / n) / 32768 if n else 0
    peak = max((abs(v) for v in pcm), default=0) / 32768
    clipped = sum(1 for v in pcm if abs(v) >= 32760) / n if n else 0
    # 30 ms analysis windows. Normal breaths/pauses are allowed.
    window = max(1, int(rate * 0.03))
    windows = (n + window - 1) // window
    quiet = 0
    for i in range(windows):
        chunk = pcm[i * window : (i + 1) * window]
        if not chunk or (math.sqrt(sum(int(v) * int(v) for v in chunk) / len(chunk)) / 32768) < 0.003:
            quiet += 1
    silent_ratio = quiet / max(1, windows)
    # Detect perceptually disruptive silence INSIDE the spoken utterance.
    # Leading/trailing encoder padding is ignored. This checks pacing independently
    # of ASR, which can transcribe every word while missing awkward breaks.
    pause_window = max(1, int(rate * 0.02))
    pause_energies = []
    for i in range(0, n, pause_window):
        samples = pcm[i:i + pause_window]
        pause_energies.append(math.sqrt(sum(int(v) * int(v) for v in samples) / max(1, len(samples))) / 32768)
    active = [i for i, value in enumerate(pause_energies) if value >= 0.018]
    internal_pauses = []
    if active:
        start, finish = active[0], active[-1]
        gap_start = None
        for i in range(start, finish + 2):
            silent = i <= finish and pause_energies[i] < 0.018
            if silent and gap_start is None:
                gap_start = i
            elif not silent and gap_start is not None:
                gap_duration = (i - gap_start) * 0.02
                if gap_duration >= 0.16:
                    internal_pauses.append({
                        "from_seconds": round(gap_start * 0.02, 3),
                        "to_seconds": round(i * 0.02, 3),
                        "duration_seconds": round(gap_duration, 3),
                    })
                gap_start = None
    max_internal_pause = max((p["duration_seconds"] for p in internal_pauses), default=0)
    if rms < 0.005:
        reasons.append("SILENCE_OR_VERY_LOW_VOLUME")
    if clipped > 0.002:
        reasons.append("HEAVY_CLIPPING")
    if silent_ratio > 0.60:
        reasons.append("EXCESSIVE_SILENCE")
    return {
        "technical_pass": not reasons,
        "reasons": reasons,
        "sha256": sha,
        "duration_seconds": duration,
        "sample_rate": rate,
        "channels": channels,
        "bit_depth": width * 8,
        "rms_dbfs": round(20 * math.log10(max(rms, 1e-10)), 2),
        "peak_dbfs": round(20 * math.log10(max(peak, 1e-10)), 2),
        "clipped_fraction": round(clipped, 6),
        "silent_window_fraction": round(silent_ratio, 4),
        "internal_pauses": internal_pauses,
        "max_internal_pause_seconds": max_internal_pause,
    }


def asr_engine(model_size: str):
    from faster_whisper import WhisperModel
    return WhisperModel(model_size, device="cpu", compute_type="int8", cpu_threads=4)


def transcribe(model, path: Path) -> str:
    segments, info = model.transcribe(
        str(path),
        language="cs",
        beam_size=5,
        condition_on_previous_text=False,
        vad_filter=False,
        temperature=0,
    )
    return " ".join(seg.text.strip() for seg in segments).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--fallback-model", default="medium",
                        help="Use a stronger independent offline ASR if initial transcript differs")
    parser.add_argument("--technical-only", action="store_true", help="Diagnostic only. NEVER AUTO_PASS.")
    args = parser.parse_args()
    input_dir = Path(args.input_dir)
    metadata_path = input_dir / "receipt.json"
    receipt = json.loads(metadata_path.read_text(encoding="utf-8"))
    exact_text = receipt["text"]
    text_hash = hashlib.sha256(exact_text.encode("utf-8")).hexdigest()
    if receipt.get("text_sha256") != text_hash:
        raise SystemExit("SOURCE_TEXT_SHA256_MISMATCH: refusing QA")
    if receipt.get("purpose") != "VOICE_QUALITY_QA_ONLY_NOT_CANONICAL":
        raise SystemExit("UNEXPECTED_SOURCE_PURPOSE: refusing QA")
    try:
        model = None if args.technical_only else asr_engine(args.model)
    except Exception as exc:
        # Do NOT convert a missing recognizer or failed model download into PASS.
        print("ASR_UNAVAILABLE:", str(exc), file=sys.stderr)
        model = None
    reports = {}
    styles_in_receipt = [s for s in ("natural", "learning_slow") if s in receipt.get("variants", {})]
    if not styles_in_receipt:
        raise SystemExit("NO_AUDIO_VARIANTS_IN_RECEIPT")
    for style in styles_in_receipt:
        path = input_dir / f"QA_ONLY_FULL_SENTENCE_{style}.wav"
        technical = inspect_wav(path)
        record = receipt.get("variants", {}).get(style) or {}
        # Project QA threshold (not a CEFR numerical rule).
        # Natural speech should flow; learner audio may be slightly more spaced
        # but must not sound like the voice is searching for words.
        max_allowed_pause = 0.34 if style == "natural" else 0.38
        technical["max_allowed_internal_pause_seconds"] = max_allowed_pause
        if technical.get("max_internal_pause_seconds", 0) > max_allowed_pause:
            technical["technical_pass"] = False
            technical["reasons"].append("UNNATURAL_MID_SENTENCE_PAUSE")
        expected_sha = record.get("audio_sha256")
        if expected_sha != technical.get("sha256"):
            technical["technical_pass"] = False
            technical["reasons"].append("RECEIPT_AUDIO_SHA256_MISMATCH")
        expected_duration = record.get("duration_ms")
        if isinstance(expected_duration, int) and abs(expected_duration - round(1000 * technical.get("duration_seconds", 0))) > 20:
            technical["technical_pass"] = False
            technical["reasons"].append("RECEIPT_DURATION_MISMATCH")
        if model and technical["technical_pass"]:
            try:
                heard = transcribe(model, path)
                accuracy = score_text(exact_text, heard)
                # Speech mismatches can change Czech morphology and meaning.
                # A near match is NOT an automatic PASS. A second, stronger ASR
                # pass attempts to distinguish Whisper errors from TTS errors.
                match = accuracy["exact"]
                if not match and args.fallback_model and args.fallback_model != args.model:
                    try:
                        fallback = asr_engine(args.fallback_model)
                        fallback_heard = transcribe(fallback, path)
                        fallback_accuracy = score_text(exact_text, fallback_heard)
                        accuracy["fallback_model"] = args.fallback_model
                        accuracy["fallback_transcript"] = fallback_heard
                        accuracy["fallback_exact"] = fallback_accuracy["exact"]
                        match = fallback_accuracy["exact"]
                    except Exception as fallback_error:
                        accuracy["fallback_error"] = str(fallback_error)
                decision = "AUTO_PASS" if match else "QUARANTINED"
            except Exception as exc:
                heard = ""
                accuracy = {"asr_error": str(exc)}
                decision = "QUARANTINED"
        else:
            heard = ""
            accuracy = {}
            decision = "TECH_ONLY_NOT_APPROVED" if args.technical_only else "QUARANTINED"
        if not technical["technical_pass"]:
            decision = "QUARANTINED"
        reports[style] = {
            "decision": decision,
            "wav": path.name,
            "technical": technical,
            "asr_transcript": heard,
            "accuracy": accuracy,
        }
    if ("natural" in reports and "learning_slow" in reports and
        reports["natural"]["technical"]["technical_pass"] and
        reports["learning_slow"]["technical"]["technical_pass"] and
        reports["learning_slow"]["technical"]["duration_seconds"] <
        reports["natural"]["technical"]["duration_seconds"] * 1.03):
        reports["learning_slow"]["decision"] = "QUARANTINED"
        reports["learning_slow"]["technical"]["reasons"].append("SLOW_NOT_MEASURABLY_SLOWER")
    result = {
        "qa_engine": "ahoj-offline-asr-v1",
        "source_id": receipt.get("source_id"),
        "exact_text_sha256": text_hash,
        "source_text": exact_text,
        "mode": "diagnostic" if args.technical_only else "auto",
        "requires_manual_qa": False,
        "curriculum_publication_approval": False,
        "no_google_drive_upload": True,
        "no_tts_calls": True,
        "variants": reports,
    }
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    for style, report in reports.items():
        accuracy = report.get("accuracy", {})
        print(style, report["decision"], "WER:", accuracy.get("wer"), "CER:", accuracy.get("cer"),
              "sha256:", report["technical"].get("sha256"))
    print("AUTO_QA_REPORT_READY:", args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
