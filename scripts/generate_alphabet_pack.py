#!/usr/bin/env python3
"""Bounded Gemini 3.8 Czech alphabet TTS for iPhone PREVIEW only.

Source frozen per pack; no invented speech, no retries, no native-approval claims.
Audio output + exact SHA receipts; fail-closed technical and Czech ASR QA.
"""
from __future__ import annotations
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from voice_quality_full_sentence import fetch_audio, access_token, MODEL, VOICE
from auto_audio_qa import inspect_wav, asr_engine, transcribe, score_text

VALID_KINDS = ("letter_name", "sound_in_word")
ALLOWED_PACKS = {f"pack{i:02d}" for i in range(1, 10)}

def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def validate(path, expected_pack):
    data=json.loads(path.read_text(encoding="utf-8"))
    assert data.get("version")=="cz-alphabet-pack-v1"
    assert data.get("model")==MODEL=="gemini-3.8-flash-tts"
    assert data.get("voice")==VOICE=="Achernar"
    assert data.get("scope")=="PREVIEW_ONLY_NO_NATIVE_CERTIFICATION"
    assert data.get("packId")==f"CZ-ALPHA-P{expected_pack[-2:]}"
    letters=data.get("letters")
    assert isinstance(letters,list) and 4<=len(letters)<=5
    assert data.get("max_billable_calls")==2*len(letters)
    assert data.get("no_automatic_retry") is True
    seen=set()
    for letter in letters:
        assert isinstance(letter,dict)
        assert isinstance(letter.get("id"),str) and 1<=len(letter["id"])<=2
        assert isinstance(letter.get("slug"),str) and letter["slug"].replace("_","").isascii()
        assert letter["slug"].replace("_","").isalnum()
        assert letter["id"] not in seen
        seen.add(letter["id"])
        for key in ("name","word"):
            text=letter.get(key)
            assert isinstance(text,str) and 1<=len(text)<=100 and text==text.strip()
    return data

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--pack",choices=sorted(ALLOWED_PACKS),required=True)
    p.add_argument("--generate",action="store_true")
    args=p.parse_args()
    src=Path("production/alphabet")/(args.pack+".json")
    data=validate(src,args.pack)
    print("PACK_SOURCE_VALIDATED",args.pack,"max_calls",data["max_billable_calls"],flush=True)
    if not args.generate:
        print("DRY_RUN_NO_VERTEX_CALLS")
        return
    if os.getenv("GITHUB_ACTIONS")!="true" or not os.getenv("AHOJ_GCP_ACCESS_TOKEN"):
        raise SystemExit("REFUSE_NO_BRANCH_BOUND_GITHUB_WIF_TOKEN")
    out=Path(os.getenv("AHOJ_ALPHABET_OUT","/tmp/ahoj-alphabet"))/args.pack
    if out.exists() and any(out.iterdir()):
        raise SystemExit("REFUSE_OVERWRITE_NONEMPTY_OUTPUT")
    out.mkdir(parents=True)
    (out/"quarantine").mkdir()
    pub=Path("production/alphabet-preview")/args.pack
    if pub.exists():
        raise SystemExit("REFUSE_OVERWRITE_EXISTING_AUDIO_PACK")
    pub.mkdir(parents=True)
    token=access_token()
    # Offline Czech ASR is useful for words; short letter names are NOT
    # reliably recognizable, so those clips are TECHNICAL_PREVIEW only.
    asr=None
    try:
        asr=asr_engine("small")
    except Exception as exc:
        print("ASR_UNAVAILABLE_WORDS_QUARANTINED",str(exc)[:200],flush=True)
    rows=[]
    attempts=0
    consecutive_429=0
    for letter in data["letters"]:
        if consecutive_429>=3:
            print("QUOTA_STOP_AFTER_3_429",flush=True)
            break
        for kind in VALID_KINDS:
            if consecutive_429>=3:break
            exact=letter["name"] if kind=="letter_name" else letter["word"]
            uid=f"CZ-ALPHA-{letter['id']}"
            record={"sourceId":uid,"letterId":letter["id"],"kind":kind,
                    "csExact":exact,"textSha256":sha256(exact),
                    "sourceVersion":data["version"],"packId":data["packId"],
                    "model":MODEL,"voice":VOICE,
                    "nativeApproved":False,"publishAllowed":False,
                    "previewAllowed":False,"decision":"NOT_ATTEMPTED"}
            prompt=("Native Czech language teacher: say ONLY the exact supplied Czech phrase, "
                    "natural clear Czech pronunciation and Czech vowel length. "
                    "It names a letter of the Czech alphabet. Do not spell in English, "
                    "do not read punctuation, do not explain or add words."
                    if kind=="letter_name" else
                    "Native Czech language teacher: say ONLY the exact supplied Czech example word, "
                    "with natural Czech stress, vowel lengths, correct consonants. "
                    "Do not add any other words, translations, or explanations.")
            attempts+=1
            print("TTS_ATTEMPT",attempts,uid,kind,flush=True)
            try:
                audio,info=fetch_audio("natural",prompt,token,text=exact,voice=VOICE)
                filename=f"{letter['slug']}__{kind}.wav"
                candidate=out/filename
                candidate.write_bytes(audio)
                technical=inspect_wav(candidate)
                record["audioSha256"]=hashlib.sha256(audio).hexdigest()
                record["durationMs"]=info["duration_ms"]
                record["bytes"]=len(audio)
                record["technical"]=technical
                if not technical["technical_pass"]:
                    record["decision"]="QUARANTINED_TECHNICAL"
                elif kind=="letter_name":
                    # An isolated letter name cannot be accurately certified
                    # by Whisper; this remains a visible preview, not release.
                    record["decision"]="TECHNICAL_PREVIEW"
                    record["previewAllowed"]=True
                elif asr is None:
                    record["decision"]="QUARANTINED_ASR_UNAVAILABLE"
                else:
                    try:
                        heard=transcribe(asr,candidate)
                        comparison=score_text(exact,heard)
                        record["asrText"]=heard
                        record["asrExact"]=comparison["exact"]
                        record["decision"]="AUTO_PASS" if comparison["exact"] else "QUARANTINED_ASR"
                        record["previewAllowed"]=bool(comparison["exact"])
                    except Exception as exc:
                        record["decision"]="QUARANTINED_ASR_ERROR"
                        record["asrError"]=str(exc)[:200]
                if record["previewAllowed"]:
                    destination=pub/filename
                else:
                    destination=out/"quarantine"/filename
                candidate.replace(destination)
                if record["previewAllowed"]:
                    record["repoPath"]=str(destination)
                consecutive_429=0
            except Exception as exc:
                err=str(exc)
                record["decision"]="GENERATION_FAILED"
                record["error"]=err[:350]
                if "HTTP 429" in err or "RESOURCE_EXHAUSTED" in err:
                    consecutive_429+=1
                else:
                    consecutive_429=0
                print("TTS_FAILED",uid,kind,err[:180],flush=True)
            rows.append(record)
            report={"packId":data["packId"],"sourceVersion":data["version"],
                    "model":MODEL,"voice":VOICE,
                    "generatedAtUtc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    "maxBillableCalls":data["max_billable_calls"],"attemptedCalls":attempts,
                    "nativeApproved":False,"publicationAllowed":False,
                    "rows":rows}
            (out/"receipt.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
            if consecutive_429:
                time.sleep(8*consecutive_429)
            else:
                time.sleep(1)
    final={"packId":data["packId"],"sourceVersion":data["version"],
           "model":MODEL,"voice":VOICE,"nativeApproved":False,"publicationAllowed":False,
           "attemptedCalls":attempts,"maxBillableCalls":data["max_billable_calls"],
           "rows":rows}
    (pub/"manifest.json").write_text(json.dumps(final,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("PACK_COMPLETE",json.dumps({
      "attempted":attempts,
      "preview":sum(1 for r in rows if r["previewAllowed"]),
      "quarantined":sum(1 for r in rows if r["decision"].startswith("QUARANTINED")),
      "failed":sum(1 for r in rows if r["decision"]=="GENERATION_FAILED")
    }),flush=True)

if __name__=="__main__":
    main()
