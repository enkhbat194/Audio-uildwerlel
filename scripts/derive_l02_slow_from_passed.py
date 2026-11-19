#!/usr/bin/env python3
"""Derive a slower teaching clip from an independently verified Natural WAV.

Only allowed for L02 PH004 'A ty?' with an exact matching approved Natural
receipt. Never blindly approve the result; run the same Czech ASR/technical QA.
Uses FFmpeg atempo to preserve pitch and no billed TTS.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

from produce_curriculum_batch import (
    automated_quality, asr_engine
)

SOURCE_ID = "CZ-A0-M01-L02-PH004"
EXPECTED_CS = "A ty?"
TEMPO = 0.86

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--repair-dir",required=True)
    p.add_argument("--out-dir",required=True)
    args=p.parse_args()
    root=Path(args.repair_dir)
    d=json.loads((root/"repair_report.json").read_text(encoding="utf-8"))
    candidates=[r for r in d.get("rows",[]) if
                r.get("source_id")==SOURCE_ID and r.get("speech_style")=="natural"
                and r.get("decision")=="AUTO_PASS" and r.get("cs_exact")==EXPECTED_CS]
    if len(candidates)!=1:
        raise SystemExit("NO_SINGLE_APPROVED_NATURAL_SOURCE")
    r=candidates[0]
    if r.get("source_sha256")!=hashlib.sha256(EXPECTED_CS.encode("utf-8")).hexdigest():
        raise SystemExit("SOURCE_TEXT_SHA_MISMATCH")
    source=root/r["storage_relative_path"]
    if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest()!=r["audio_sha256"]:
        raise SystemExit("SOURCE_AUDIO_SHA_MISMATCH")
    out=Path(args.out_dir)
    if out.exists() and any(out.iterdir()):
        raise SystemExit("REFUSE_OVERWRITE")
    out.mkdir(parents=True,exist_ok=True)
    target=out/(SOURCE_ID+"__learning_slow__derived-tempo086.wav")
    subprocess.run([
        "ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y","-i",str(source),
        "-af",f"atempo={TEMPO}","-ar","24000","-ac","1",
        "-c:a","pcm_s16le",str(target)
    ],check=True,timeout=90)
    row={"source_id":SOURCE_ID,"cs_exact":EXPECTED_CS,"text_sha256":r["source_sha256"],
         "kind":"phrase","source_gate":"draft_phrase_not_native_reviewed"}
    quality=automated_quality(target,row,"learning_slow",asr_engine("small"),{"model":None})
    if quality["decision"]=="AUTO_PASS":
        import wave
        with wave.open(str(target),"rb") as f:
            duration_ms=round(f.getnframes()/f.getframerate()*1000)
        if duration_ms < r["duration_ms"]*1.08:
            quality["decision"]="QUARANTINED"
            quality["reason"]="NO_MEASURABLE_LEARNING_SLOW_DELIVERY"
    sha=hashlib.sha256(target.read_bytes()).hexdigest()
    report={
        "source_id":SOURCE_ID,"text":EXPECTED_CS,"speech_style":"learning_slow",
        "source_natural_sha256":r["audio_sha256"],
        "source_text_sha256":r["source_sha256"],"tempo_factor":TEMPO,
        "derived_no_new_tts":True,"human_review_not_required":True,
        "release_allowed":False,"filename":target.name,"audio_sha256":sha,
        "decision":quality["decision"],"qa":quality
    }
    (out/"derived_report.json").write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding="utf-8")
    if quality["decision"]!="AUTO_PASS":
        (out/"quarantine").mkdir(exist_ok=True)
        target.rename(out/"quarantine"/target.name)
    print("DERIVED_SLOW_QA",report["decision"],"recognized",repr(quality.get("recognized_text")),
          "duration_ms",quality["technical"].get("duration_seconds",0)*1000,flush=True)

if __name__=="__main__":
    main()
