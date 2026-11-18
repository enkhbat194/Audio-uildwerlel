#!/usr/bin/env python3
"""Shorten only verified internal SILENCE, never Czech syllables or words.
Offline and deterministic. Every resulting WAV must pass automatic ASR+pause QA.
"""
import argparse
import array
import hashlib
import io
import json
from pathlib import Path
import sys
import wave
from auto_audio_qa import inspect_wav

TARGET_GAP_SECONDS = 0.18
MIN_GAP_TO_TRIM = 0.30

def optimize_silence(wav_bytes):
    wav = io.BytesIO(wav_bytes)
    with wave.open(wav, "rb") as f:
        if (f.getnchannels(), f.getsampwidth(), f.getframerate(), f.getcomptype()) != (1, 2, 24000, "NONE"):
            raise ValueError("Only PCM16 mono 24kHz WAV is supported")
        pcm = array.array("h")
        pcm.frombytes(f.readframes(f.getnframes()))
    if sys.byteorder != "little":
        pcm.byteswap()
    # Align exactly with the auto-QA silence detector: 20ms RMS windows.
    rate = 24000
    frame = round(rate * 0.02)
    import math
    energies = []
    for i in range(0, len(pcm), frame):
        part = pcm[i:i + frame]
        energies.append(math.sqrt(sum(int(x) * int(x) for x in part) / len(part)) / 32768)
    active = [i for i, value in enumerate(energies) if value >= 0.018]
    if not active:
        raise ValueError("No voiced signal; refusing polish")
    ranges = []
    start = None
    for i in range(active[0], active[-1] + 2):
        silent = (i <= active[-1] and energies[i] < 0.018)
        if silent and start is None:
            start = i
        elif not silent and start is not None:
            a, b = start * frame, min(i * frame, len(pcm))
            if (b - a) / rate >= MIN_GAP_TO_TRIM:
                half_keep = round(TARGET_GAP_SECONDS * rate / 2)
                cut_a, cut_b = a + half_keep, b - half_keep
                if cut_b > cut_a:
                    ranges.append((cut_a, cut_b, round((b - a) / rate, 3)))
            start = None
    # Work right-to-left; retained 0.09s silent padding on either side.
    for a, b, _ in reversed(ranges):
        del pcm[a:b]
    if sys.byteorder != "little":
        pcm.byteswap()
    result = io.BytesIO()
    with wave.open(result, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(pcm.tobytes())
    modifications = [{"cut_start_sample": a, "cut_end_sample": b,
                      "removed_seconds": round((b - a) / rate, 3),
                      "original_pause_seconds": length}
                     for a, b, length in ranges]
    return result.getvalue(), modifications

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input-dir", required=True)
    p.add_argument("--output-dir", required=True)
    args = p.parse_args()
    incoming = Path(args.input_dir)
    outgoing = Path(args.output_dir)
    outgoing.mkdir(parents=True, exist_ok=True)
    receipt = json.loads((incoming / "receipt.json").read_text(encoding="utf-8"))
    if receipt.get("purpose") != "VOICE_QUALITY_QA_ONLY_NOT_CANONICAL":
        raise SystemExit("Unexpected receipt purpose")
    if set(receipt.get("variants", {})) != {"natural", "learning_slow"}:
        raise SystemExit("Both variants required")
    if receipt.get("text_sha256") != hashlib.sha256(receipt["text"].encode("utf-8")).hexdigest():
        raise SystemExit("Text SHA mismatch")
    receipt["postprocess_version"] = "internal-silence-only-v1"
    for style, record in receipt["variants"].items():
        filename = f"QA_ONLY_FULL_SENTENCE_{style}.wav"
        original = (incoming / filename).read_bytes()
        original_sha = hashlib.sha256(original).hexdigest()
        if record.get("audio_sha256") != original_sha:
            raise SystemExit(f"Original WAV hash mismatch: {style}")
        if style == "learning_slow":
            result, modifications = optimize_silence(original)
        else:
            result, modifications = original, []
        with wave.open(io.BytesIO(result), "rb") as wf:
            duration_ms = round(1000 * wf.getnframes() / wf.getframerate())
        (outgoing / filename).write_bytes(result)
        record.update({
            "original_audio_sha256": original_sha,
            "audio_sha256": hashlib.sha256(result).hexdigest(),
            "duration_ms": duration_ms,
            "size_bytes": len(result),
            "local_file": str(outgoing / filename),
            "silence_edits": modifications,
        })
        print(style, "duration_ms", duration_ms, "edits", len(modifications))
    (outgoing / "receipt.json").write_text(json.dumps(receipt, indent=2, ensure_ascii=False), encoding="utf-8")
    print("SILENCE_POLISH_READY: auto ASR verification is still mandatory")

if __name__ == "__main__":
    main()
