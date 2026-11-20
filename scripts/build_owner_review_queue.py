#!/usr/bin/env python3
"""Build a read-only owner listening/review queue from an Ahoj production report.

Never deletes, moves, regenerates or approves audio. Existing quarantined WAVs
are retained even if a later reviewer chooses to regenerate them.
"""
import argparse
import hashlib
import json
from pathlib import Path


def build_queue(report_file: Path, audio_dir: Path):
    report = json.loads(report_file.read_text(encoding="utf-8"))
    queue = []
    for row in report.get("rows", []):
        if row.get("decision") != "QUARANTINED":
            continue
        options = []
        for label, key, hash_key in (
            ("original", "raw_storage_relative_path", "raw_audio_sha256"),
            ("processed", "storage_relative_path", "audio_sha256"),
        ):
            relative = row.get(key)
            if not relative:
                continue
            path = (audio_dir / relative).resolve()
            if not path.is_relative_to(audio_dir.resolve()):
                raise ValueError("PATH_TRAVERSAL_REFUSED")
            exists = path.is_file()
            observed = hashlib.sha256(path.read_bytes()).hexdigest() if exists else None
            expected = row.get(hash_key)
            options.append({
                "kind": label, "relative_path": relative, "exists": exists,
                "sha256": observed, "hash_verified": bool(expected and expected == observed),
            })
        queue.append({
            "source_id": row["source_id"], "style": row["style"],
            "cs_text": row["text"], "machine_decision": "QUARANTINED",
            "machine_reason": row.get("qa_pipeline_error") or row.get("qa", {}).get("reason")
                              or row.get("qa", {}).get("technical", {}).get("reasons", []),
            "owner_decision": "PENDING", "publication_allowed": False,
            "variants_for_listening": options,
        })
    return {
        "batch_id": report.get("batch_id"),
        "owner_review_required": len(queue),
        "auto_delete": False, "auto_regeneration": False,
        "publication_allowed": False,
        "items": queue,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--audio-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    a = parser.parse_args()
    result = build_queue(a.report, a.audio_dir)
    if a.output.exists():
        raise SystemExit("REFUSE_OVERWRITE_REVIEW_QUEUE")
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("OWNER_REVIEW_QUEUE", result["owner_review_required"], "audio untouched")


if __name__ == "__main__":
    main()
