#!/usr/bin/env python3
"""Bounded, sequential recovery of ONLY HTTP-429 failed A0 audio.

Never re-generates AUTO_PASS or QUARANTINED files. Automatically verifies the
immutable source/lesson, voice, style, model, and original receipt before call.
Preserves each result immediately. No Drive/GCS writes and no student release.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time

from voice_quality_full_sentence import access_token, fetch_audio, MODEL
from produce_curriculum_batch import source_validate, voice_direction, automated_quality, asr_engine

MAX_CALLS=96
SEQUENTIAL_DELAY_SECONDS=12
THROTTLE_DELAY_SECONDS=35
STOP_AFTER_CONSECUTIVE_429=3

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--source-dir",required=True)
    p.add_argument("--out-dir",required=True)
    p.add_argument("--generate",action="store_true")
    args=p.parse_args()
    src=Path(args.source_dir)
    manifests={}
    original={}
    for number in range(1,7):
        n=f"{number:02d}"
        manifest=source_validate(f"production/manifest/2026-11-19-A0-private-bulk-{n}.json")
        folder=src/f"ahoj-a0-private-bulk-{n}-44436670518"
        receipt_path=folder/"production_report.json"
        receipt=json.loads(receipt_path.read_text(encoding="utf-8"))
        if receipt.get("batch_id")!=manifest["batch_id"] or receipt.get("release_allowed") is not False:
            raise SystemExit("ORIGINAL_BATCH_ID_OR_RELEASE_INVALID:"+n)
        for row in manifest["rows"]:
            uid=row["source_id"]
            if uid in manifests:
                raise SystemExit("DUPLICATE_SOURCE_ID: "+uid)
            manifests[uid]=row
        for row in receipt["rows"]:
            key=(row.get("source_id"),row.get("style"))
            if key in original: raise SystemExit("DUPLICATE_RECEIPT")
            original[key]=row

    to_retry=[]
    all_failed=[]
    for (uid,style),record in sorted(original.items()):
        srcrow=manifests.get(uid)
        if srcrow is None:raise SystemExit("UNKNOWN_SOURCE")
        if style not in ("natural","learning_slow"):raise SystemExit("UNKNOWN_STYLE")
        if record.get("source_sha256") != srcrow["text_sha256"] or record.get("text") != srcrow["cs_exact"]:
            raise SystemExit("SOURCE_FINGERPRINT_MISMATCH:"+uid)
        if record.get("decision") != "GENERATION_FAILED":
            continue
        all_failed.append((uid,style))
        error=record.get("error") or ""
        if not re.search(r"HTTP 429|RESOURCE_EXHAUSTED", error, flags=re.I):
            raise SystemExit("UNEXPECTED_FAILURE_NOT_SAFE_TO_RETRY:"+uid)
        to_retry.append((uid,style,srcrow))
    if not to_retry or len(to_retry)>MAX_CALLS:
        raise SystemExit("INVALID_RETRY_COUNT")
    print("RECOVERY_PRECHECK_OK: failed-only",len(to_retry),"TTS calls upper bound",len(to_retry))
    if not args.generate:
        print("DRY_RUN_OK - no TTS attempted")
        return
    if os.environ.get("GITHUB_ACTIONS")!="true" or not os.environ.get("AHOJ_GCP_ACCESS_TOKEN"):
        raise SystemExit("KEYLESS_AUTH_REQUIRED")
    out=Path(args.out_dir)
    if out.exists() and any(out.iterdir()):raise SystemExit("REFUSE_OVERWRITE")
    out.mkdir(parents=True)
    (out/"approved").mkdir()
    (out/"quarantine").mkdir()
    token=access_token()
    small=asr_engine("small")
    medium={"model":None}
    r={"batch_id":"A0_48_PHRASES_QUOTA_RECOVERY_20261119",
       "original_run_id":44436670518,
       "original_failed_count":len(all_failed),
       "model":"gemini-3.8-flash-tts",
       "max_additional_calls":len(to_retry),
       "calls_attempted":0,"release_allowed":False,
       "mode":"private-quota-throttled",
       "remaining_unattempted":len(to_retry),
       "counts":{"AUTO_PASS":0,"QUARANTINED":0,"GENERATION_FAILED":0},
       "rows":[]}
    consecutive_429=0
    for uid,style,source in to_retry:
        if consecutive_429>=STOP_AFTER_CONSECUTIVE_429:
            print("QUOTA_BACKOFF_STOP: 3 consecutive 429; preserving remaining tasks without attempting them",flush=True)
            break
        record={"source_id":uid,"lesson_id":source["lesson_id"],
                "source_sha256":source["text_sha256"],"text":source["cs_exact"],
                "style":style,"model":MODEL,"voice":"Achernar",
                "release_allowed":False}
        try:
            if r["calls_attempted"]:
                time.sleep(SEQUENTIAL_DELAY_SECONDS)
            prompt=voice_direction(source,style)
            r["calls_attempted"]+=1
            print("QUOTA_RECOVERY_TTS",uid,style,"attempt",r["calls_attempted"],flush=True)
            wav,info=fetch_audio(style,prompt,token,text=source["cs_exact"],voice="Achernar")
            sha=hashlib.sha256(wav).hexdigest()
            tmp=out/f"{uid}__{style}__quota-recovery-{sha[:12]}.wav"
            tmp.write_bytes(wav)
            qa=automated_quality(tmp,source,style,small,medium)
            status=qa["decision"]
            dest=out/("approved" if status=="AUTO_PASS" else "quarantine")/tmp.name
            tmp.rename(dest)
            record.update({"decision":status,"storage_relative_path":str(dest.relative_to(out)),
                           "audio_sha256":sha,"duration_ms":info.get("duration_ms"),
                           "wav_bytes":len(wav),"qa":qa})
            consecutive_429=0
        except Exception as exc:
            err=str(exc)
            record.update({"decision":"GENERATION_FAILED","error":err[:400]})
            if "HTTP 429" in err or "RESOURCE_EXHAUSTED" in err:
                consecutive_429+=1
                print("BACKOFF_429",consecutive_429,uid,flush=True)
                time.sleep(THROTTLE_DELAY_SECONDS*consecutive_429)
            else:
                consecutive_429=0
        r["rows"].append(record)
        r["remaining_unattempted"]=len(to_retry)-len(r["rows"])
        r["counts"][record["decision"]]+=1
        (out/"recovery_report.json").write_text(json.dumps(r,indent=2,ensure_ascii=False),encoding="utf-8")
        print("QUOTA_RECOVERY_RESULT",uid,style,record["decision"],flush=True)
    print("QUOTA_RECOVERY_COMPLETE",json.dumps(r["counts"],sort_keys=True),
          "unattempted",r["remaining_unattempted"],flush=True)

if __name__=="__main__":
    main()
