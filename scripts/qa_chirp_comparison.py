#!/usr/bin/env python3
"""Independent Czech ASR check on stored Chirp A/B outputs, never delete audio."""
import argparse
import json
from pathlib import Path

from auto_audio_qa import asr_engine, transcribe, score_text


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    src = args.out_dir / "chirp_comparison_report.json"
    data = json.loads(src.read_text(encoding="utf-8"))
    items = data["rows"]
    if not items:
        print("CHIRP_ASR_NO_AUDIO")
        return
    try:
        engine = asr_engine("small")
    except Exception as exc:
        # ASR unavailable must never be interpreted as a pass.
        for r in items:
            if r.get("storage_relative_path"):
                r["asr_result"] = {"decision": "ASR_UNAVAILABLE_REVIEW",
                                   "error": str(exc)[:180]}
        src.write_text(json.dumps(data, indent=2, ensure_ascii=False),
                       encoding="utf-8")
        return
    for r in items:
        rel = r.get("storage_relative_path")
        if not rel:
            continue
        wav = (args.out_dir / rel).resolve()
        if not wav.is_relative_to(args.out_dir.resolve()):
            raise SystemExit("PATH_TRAVERSAL")
        if not wav.is_file():
            r["asr_result"] = {"decision": "MISSING_AUDIO_REVIEW"}
            continue
        try:
            heard = transcribe(engine, wav)
            score = score_text(r["cs_exact"], heard)
            r["asr_result"] = {
                "decision": "ASR_MATCH_REVIEW" if score["exact"] else "ASR_MISMATCH_REVIEW",
                "recognized_text": heard, "scores": score,
            }
        except Exception as exc:
            r["asr_result"] = {"decision": "ASR_ERROR_REVIEW",
                               "error": str(exc)[:180]}
    # NEVER upgrades human review to release approval.
    data["publication_allowed"] = False
    data["owner_comparison_required"] = True
    src.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print("CHIRP_ASR_SCANNED", sum("asr_result" in x for x in items),
          "ORIGINAL_WAVS_PRESERVED")


if __name__ == "__main__":
    main()
