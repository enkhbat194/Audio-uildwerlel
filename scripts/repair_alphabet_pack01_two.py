#!/usr/bin/env python3
"""Two and ONLY two targeted Gemini 3.8 Czech word repairs (cena, čaj).

Existing original WAVs, text hashes, release blocks and approved Preview
files stay unchanged. Failed retries remain quarantined. No further retries.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
from voice_quality_full_sentence import fetch_audio,access_token,MODEL,VOICE
from auto_audio_qa import inspect_wav,asr_engine,transcribe,score_text

PROMPTS={
 "C":("The exact Czech word is cena, IPA /ˈt͡sɛna/. "
      "The initial Czech letter c is pronounced /ts/, NEVER English /s/. "
      "Both vowels are short, not long. Speak only the word cena."),
 "Č":("The exact Czech word is čaj, IPA /t͡ʃaj/. "
      "Initial Czech č is /tʃ/ and the vowel a is SHORT, not long á. "
      "Speak only the word čaj, no filler or English accent."),
}
def main():
    if os.environ.get("GITHUB_ACTIONS")!="true" or not os.environ.get("AHOJ_GCP_ACCESS_TOKEN"):
        raise SystemExit("BRANCH_RESTRICTED_WIF_REQUIRED")
    pub=Path("production/alphabet-preview/pack01")
    path=pub/"manifest.json"
    data=json.loads(path.read_text(encoding="utf-8"))
    source=json.loads(Path("production/alphabet/pack01.json").read_text(encoding="utf-8"))
    assert data["publicationAllowed"] is False and data["nativeApproved"] is False
    assert data["model"]==MODEL=="gemini-3.8-flash-tts"
    targets=[r for r in data["rows"] if r["kind"]=="sound_in_word" and r["letterId"] in PROMPTS]
    assert len(targets)==2 and all(not r["previewAllowed"] for r in targets)
    assert {r["letterId"] for r in targets}=={"C","Č"}
    for row in targets:
        letter=next(x for x in source["letters"] if x["id"]==row["letterId"])
        assert row["csExact"]==letter["word"]
        assert row["textSha256"]==hashlib.sha256(row["csExact"].encode()).hexdigest()
    token=access_token()
    model=asr_engine("small")
    fallback=None
    out=Path(os.environ["AHOJ_ALPHABET_REPAIR_OUT"])
    assert not out.exists()
    out.mkdir(parents=True)
    (out/"quarantine").mkdir()
    attempts=0
    for row in targets:
        uid=row["letterId"]
        exact=row["csExact"]
        attempts+=1
        result={"attempt":attempts,"sourceId":row["sourceId"],"csExact":exact,
                "textSha256":row["textSha256"],"model":MODEL,"voice":VOICE,
                "nativeApproved":False,"publicationAllowed":False}
        print("TARGETED_TTS_REPAIR",uid,flush=True)
        try:
            audio,info=fetch_audio("natural",PROMPTS[uid],token,text=exact,voice=VOICE)
            filename={"C":"C","Č":"C_CARON"}[uid]+"__sound_in_word.wav"
            tmp=out/filename
            tmp.write_bytes(audio)
            technical=inspect_wav(tmp)
            result.update({"audioSha256":hashlib.sha256(audio).hexdigest(),
                           "durationMs":info["duration_ms"],"technical":technical})
            exact_match=False
            if technical["technical_pass"]:
                heard=transcribe(model,tmp)
                result["asrSmall"]=heard
                exact_match=score_text(exact,heard)["exact"]
                if not exact_match:
                    if fallback is None:fallback=asr_engine("medium")
                    heard2=transcribe(fallback,tmp)
                    result["asrMedium"]=heard2
                    exact_match=score_text(exact,heard2)["exact"]
            result["decision"]="AUTO_PASS_REPAIR" if exact_match else "QUARANTINED_REPAIR"
            if exact_match:
                target=pub/filename
                assert not target.exists()
                tmp.replace(target)
                row.update({"decision":"AUTO_PASS_REPAIR","previewAllowed":True,
                            "repoPath":str(target),"audioSha256":result["audioSha256"],
                            "durationMs":result["durationMs"],"repairSource":"gemini-3.8-flash-tts",
                            "repairQa":result})
            else:
                tmp.replace(out/"quarantine"/filename)
            print("REPAIR_QA",uid,result["decision"],flush=True)
        except Exception as exc:
            result["decision"]="GENERATION_FAILED_REPAIR"
            result["error"]=str(exc)[:300]
            print("REPAIR_FAILED",uid,result["error"],flush=True)
        row.setdefault("repairAttempts",[]).append(result)
        (out/"repair_receipt.json").write_text(json.dumps({
          "originalPack":"CZ-ALPHA-P01","maxBillableCalls":2,
          "attemptedCalls":attempts,"publicationAllowed":False,"rows":targets,
        },ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    data["repairAttemptedCalls"]=attempts
    data["repairAtUtc"]=datetime.datetime.now(datetime.timezone.utc).isoformat()
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("REPAIR_COMPLETE",attempts,"preview",sum(r["previewAllowed"] for r in targets),flush=True)

if __name__=="__main__":
    main()
