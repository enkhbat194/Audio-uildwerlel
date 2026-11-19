#!/usr/bin/env python3
"""One-shot automatic repair for the six *observed* failed A0 L02 clips.

Strictly bound to the original, already generated GitHub artifact. No generic
unbounded retries, no human QA buttons, no release or cloud storage writes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

from voice_quality_full_sentence import access_token, fetch_audio, MODEL
from produce_curriculum_batch import (
    source_validate, voice_direction, automated_quality, asr_engine
)

EXPECTED = {
    ("CZ-A0-M01-L02-PH003", "natural"),
    ("CZ-A0-M01-L02-PH003", "learning_slow"),
    ("CZ-A0-M01-L02-PH004", "natural"),
    ("CZ-A0-M01-L02-PH004", "learning_slow"),
    ("CZ-A0-M01-L02-B01-T03", "natural"),
    ("CZ-A0-M01-L02-B01-T05", "natural"),
}

def targeted_direction(source, style):
    prompt = voice_direction(source, style)
    cs = source["cs_exact"]
    if cs == "Odkud jsi?":
        return prompt + (
            " Speak the short question as one fluent Czech phrase. Clearly pronounce "
            "the final word JSI with a brief but distinct initial J and short I. "
            "Do not say SE or SI, do not replace or omit the question's words."
        )
    if cs == "A ty?":
        return prompt + (
            " Deliver this as a natural two-word Czech follow-up question meaning 'And you?'. "
            "The final word is TY, with short Czech y [ɪ], not TEĎ or TE. "
            "Complete the short vowel clearly, without singing, fillers or hesitations."
        )
    if cs == "Jsem z Česka.":
        return prompt + (
            " Articulate ČESKA with a SHORT unaccented final vowel A, not long Á. "
            "Finish the word cleanly without modifying its spelling or case ending."
        )
    raise ValueError("An unauthorized repair target was selected")

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--phrase-manifest", required=True)
    p.add_argument("--dialogue-manifest", required=True)
    p.add_argument("--existing-phrase-report", required=True)
    p.add_argument("--existing-dialogue-report", required=True)
    p.add_argument("--output-dir", required=True)
    p.add_argument("--generate", action="store_true")
    args=p.parse_args()
    source_rows={}
    for manifest in (args.phrase_manifest,args.dialogue_manifest):
        data=source_validate(manifest)
        for row in data["rows"]:
            source_rows[row["source_id"]]=row
    original={}
    for report_path in (args.existing_phrase_report,args.existing_dialogue_report):
        report=json.loads(Path(report_path).read_text(encoding="utf-8"))
        if report.get("release_allowed") is not False:
            raise SystemExit("ORIGINAL_NOT_PRIVATE")
        for record in report.get("rows",[]):
            key=(record["source_id"],record["style"])
            original[key]=record
    if not EXPECTED.issubset(original):
        raise SystemExit("MISSING_ORIGINAL_FAILURES")
    for uid,style in EXPECTED:
        r=original[(uid,style)]
        source=source_rows[uid]
        if (r.get("decision")!="QUARANTINED" or r.get("source_sha256")!=source.get("text_sha256")
            or r.get("text")!=source.get("cs_exact")):
            raise SystemExit("ORIGINAL_FAILURE_NOT_VERIFIED: "+uid+" "+style)
    print("L02_REPAIR_AUTHORIZED",len(EXPECTED),"single TTS attempts only",flush=True)
    if not args.generate:
        print("DRY_RUN_OK",flush=True)
        return
    if os.environ.get("GITHUB_ACTIONS")!="true" or not os.environ.get("AHOJ_GCP_ACCESS_TOKEN"):
        raise SystemExit("KEYLESS_GITHUB_AUTH_REQUIRED")
    out=Path(args.output_dir)
    if out.exists() and any(out.iterdir()):
        raise SystemExit("REFUSE_OVERWRITE")
    out.mkdir(parents=True,exist_ok=True)
    (out/"approved").mkdir()
    (out/"quarantine").mkdir()
    small=asr_engine("small")
    medium={"model":None}
    token=access_token()
    receipt={
        "batch_id":"AHOJ_L02_6_PRECISE_ONE_SHOT_CORRECTIONS",
        "release_allowed":False,
        "source_manifests":[args.phrase_manifest,args.dialogue_manifest],
        "original_git_run_id":44429237841,
        "max_tts_calls":6,
        "calls_attempted":0,
        "counts":{"AUTO_PASS":0,"QUARANTINED":0,"GENERATION_FAILED":0},
        "rows":[]
    }
    for uid,style in sorted(EXPECTED):
        row=source_rows[uid]
        record={"source_id":uid,"source_sha256":row["text_sha256"],
                "cs_exact":row["cs_exact"],"speech_style":style,
                "original_decision":"QUARANTINED","release_allowed":False}
        try:
            prompt=targeted_direction(row,style)
            print("REPAIR",uid,style,flush=True)
            receipt["calls_attempted"]+=1
            wav,info=fetch_audio(style,prompt,token,text=row["cs_exact"],voice=row.get("voice","Achernar"))
            sha=hashlib.sha256(wav).hexdigest()
            tmp=out/(uid+"__"+style+"__repair-"+sha[:12]+".wav")
            tmp.write_bytes(wav)
            quality=automated_quality(tmp,row,style,small,medium)
            decision=quality["decision"]
            dest=out/("approved" if decision=="AUTO_PASS" else "quarantine")/tmp.name
            tmp.rename(dest)
            record.update({
                "decision":decision,"audio_sha256":sha,
                "storage_relative_path":str(dest.relative_to(out)),
                "wav_bytes":len(wav),"duration_ms":info["duration_ms"],
                "voice":row.get("voice","Achernar"),
                "qa":quality,"voice_prompt":prompt
            })
        except Exception as exc:
            record.update({"decision":"GENERATION_FAILED","error":str(exc)[:250],
                           "may_have_been_billed":True})
        receipt["counts"][record["decision"]]+=1
        receipt["rows"].append(record)
        (out/"repair_report.json").write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding="utf-8")
        print("REPAIR_QA",uid,style,record["decision"],flush=True)
    print("REPAIR_COMPLETED",json.dumps(receipt["counts"],sort_keys=True),
          "billable_attempts",receipt["calls_attempted"],flush=True)

if __name__=="__main__":
    main()
