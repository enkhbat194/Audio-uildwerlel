#!/usr/bin/env python3
"""13 exact-source Czech context repairs, real Gemini 3.8, no retries.

Word-only short TTS sometimes elongates vowels or mispronounces Czech words.
Fallback uses a short natural Czech sentence CONTAINING the exact example word.
Only real audio with technical and independent exact Czech ASR may enter Preview.
Native/Curriculum release stays BLOCKED. All original WAVs preserved.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import time
from voice_quality_full_sentence import fetch_audio,access_token,MODEL,VOICE
from auto_audio_qa import inspect_wav,asr_engine,transcribe,score_text

def hash_text(t):return hashlib.sha256(t.encode("utf-8")).hexdigest()
def contains_word(sentence,word):
    return word.casefold() in re.split(r"[^\wáčďéěíňóřšťúůýž]+",sentence.casefold(),flags=re.I)

def main():
    source=Path("production/alphabet/context-fallback-20261120.json")
    data=json.loads(source.read_text(encoding="utf-8"))
    rows=data["rows"]
    assert data["sourceVersion"]=="cz-alphabet-pack-v1"
    assert data["model"]==MODEL=="gemini-3.8-flash-tts"
    assert data["voice"]==VOICE=="Achernar"
    assert data["scope"]=="PREVIEW_ONLY_NO_NATIVE_CERTIFICATION"
    assert data["maxBillableCalls"]==len(rows)==13 and data["noAutomaticRetries"] is True
    assert os.environ.get("GITHUB_ACTIONS")=="true" and os.environ.get("AHOJ_GCP_ACCESS_TOKEN")
    originals={}
    seen=set()
    for row in rows:
        key=(row["pack"],row["letterId"],row["kind"])
        assert key not in seen
        seen.add(key)
        pack=json.loads((Path("production/alphabet")/(row["pack"]+".json")).read_text(encoding="utf-8"))
        letter=next(x for x in pack["letters"] if x["id"]==row["letterId"])
        assert letter["slug"]==row["slug"] and letter["word"]==row["targetWord"]
        assert row["sourceId"]=="CZ-ALPHA-"+row["letterId"]
        if row["kind"]=="sound_in_word":
            assert contains_word(row["csExact"],row["targetWord"]),key
        else:
            assert key==("pack03","H","letter_name")
        path=Path("production/alphabet-preview")/row["pack"]/"manifest.json"
        if str(path) not in originals: originals[str(path)]=json.loads(path.read_text(encoding="utf-8"))
        current=originals[str(path)]
        assert current["publicationAllowed"] is False and current["nativeApproved"] is False
        prior=[x for x in current["rows"] if x["sourceId"]==row["sourceId"] and x["kind"]==row["kind"]]
        assert len(prior)==1 and not prior[0]["previewAllowed"],key
    out=Path(os.environ["AHOJ_CONTEXT_OUT"])
    assert not out.exists()
    out.mkdir(parents=True)
    (out/"quarantine").mkdir()
    token=access_token()
    small=asr_engine("small")
    medium=None
    receipt={"source":"context-fallback-20261120.json","model":MODEL,
             "maxBillableCalls":13,"attemptedCalls":0,
             "nativeApproved":False,"publicationAllowed":False,"rows":[]}
    consecutive_429=0
    for row in rows:
        if consecutive_429>=3:
            print("QUOTA_STOP_AFTER_THREE_429",flush=True)
            break
        exact=row["csExact"]
        kind=row["kind"]
        prompt=("Speak only the supplied exact Czech sentence, in fluent connected "
                "native Czech, with natural Czech stress and correct SHORT and LONG "
                "vowel lengths. No filler, no translation, no explanation. "
                "Do not stretch any vowel unnaturally. The example word is "
                +row["targetWord"]+"."
                if kind=="sound_in_word" else
                "Speak only the supplied exact Czech alphabet letter name phrase. "
                "Use natural Czech pronunciation of letter H (há), not English. "
                "No fillers or translations.")
        record={"sourceId":row["sourceId"],"pack":row["pack"],"kind":kind,
                "targetWord":row["targetWord"],"csExact":exact,
                "textSha256":hash_text(exact),"model":MODEL,"voice":VOICE,
                "nativeApproved":False,"publicationAllowed":False}
        receipt["attemptedCalls"]+=1
        print("CONTEXT_TTS",receipt["attemptedCalls"],row["pack"],row["letterId"],kind,flush=True)
        try:
            audio,info=fetch_audio("natural",prompt,token,text=exact,voice=VOICE)
            filename=row["slug"]+"__"+kind+".wav"
            candidate=out/(row["pack"]+"__"+filename)
            candidate.write_bytes(audio)
            technical=inspect_wav(candidate)
            record.update({"audioSha256":hashlib.sha256(audio).hexdigest(),
                           "durationMs":info["duration_ms"],"technical":technical})
            passed=technical["technical_pass"]
            if passed and kind=="sound_in_word":
                heard=transcribe(small,candidate)
                record["asrSmall"]=heard
                passed=score_text(exact,heard)["exact"]
                if not passed:
                    if medium is None:medium=asr_engine("medium")
                    heard2=transcribe(medium,candidate)
                    record["asrMedium"]=heard2
                    passed=score_text(exact,heard2)["exact"]
            record["decision"]=("TECHNICAL_PREVIEW_CONTEXT" if kind=="letter_name" else "AUTO_PASS_CONTEXT") if passed else "QUARANTINED_CONTEXT"
            manifest=originals[str(Path("production/alphabet-preview")/row["pack"]/"manifest.json")]
            original=next(x for x in manifest["rows"] if x["sourceId"]==row["sourceId"] and x["kind"]==kind)
            if passed:
                destination=Path("production/alphabet-preview")/row["pack"]/filename
                assert not destination.exists()
                candidate.replace(destination)
                original.update({"csExact":exact,"textSha256":record["textSha256"],
                                 "targetWord":row["targetWord"],"audioSha256":record["audioSha256"],
                                 "durationMs":record["durationMs"],"decision":record["decision"],
                                 "previewAllowed":True,"repoPath":str(destination),
                                 "contextFallback":True})
            else:
                candidate.replace(out/"quarantine"/candidate.name)
            consecutive_429=0
        except Exception as exc:
            record["decision"]="GENERATION_FAILED_CONTEXT"
            record["error"]=str(exc)[:350]
            if "HTTP 429" in str(exc) or "RESOURCE_EXHAUSTED" in str(exc):
                consecutive_429+=1
            else:
                consecutive_429=0
        record["previewAllowed"]=record["decision"] in ("TECHNICAL_PREVIEW_CONTEXT","AUTO_PASS_CONTEXT")
        manifest=originals[str(Path("production/alphabet-preview")/row["pack"]/"manifest.json")]
        original=next(x for x in manifest["rows"] if x["sourceId"]==row["sourceId"] and x["kind"]==kind)
        original.setdefault("contextFallbackAttempts",[]).append(record)
        receipt["rows"].append(record)
        (out/"context_receipt.json").write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        print("CONTEXT_QA",row["sourceId"],kind,record["decision"],flush=True)
        if consecutive_429:time.sleep(8*consecutive_429)
        else:time.sleep(1)
    for name,manifest in originals.items():
        manifest["contextFallbackAttempted"]=True
        Path(name).write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("CONTEXT_COMPLETE",json.dumps({
        "attempts":receipt["attemptedCalls"],
        "passed":sum(x["previewAllowed"] for x in receipt["rows"]),
        "failed":sum(x["decision"]=="GENERATION_FAILED_CONTEXT" for x in receipt["rows"])
    }),flush=True)

if __name__=="__main__":
    main()
