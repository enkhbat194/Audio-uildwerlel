#!/usr/bin/env python3
"""One-shot, bounded retry of ONLY two original 429 alphabet letter-name misses.

No retry of quarantined audio, no source rewrites, no native certification.
"""
import hashlib,json,os
from pathlib import Path
from voice_quality_full_sentence import fetch_audio,access_token,MODEL,VOICE
from auto_audio_qa import inspect_wav

TARGETS=[("pack03","I"),("pack05","Ó")]
def main():
    if os.environ.get("GITHUB_ACTIONS")!="true" or not os.environ.get("AHOJ_GCP_ACCESS_TOKEN"):
        raise SystemExit("GITHUB_WIF_REQUIRED")
    out=Path(os.environ["AHOJ_429_OUT"])
    assert not out.exists()
    out.mkdir(parents=True)
    token=access_token()
    receipts=[]
    for pack,id in TARGETS:
        src=json.loads((Path("production/alphabet")/(pack+".json")).read_text(encoding="utf-8"))
        pub=Path("production/alphabet-preview")/pack
        path=pub/"manifest.json"
        data=json.loads(path.read_text(encoding="utf-8"))
        assert data["publicationAllowed"] is False and data["nativeApproved"] is False
        letter=next(x for x in src["letters"] if x["id"]==id)
        rows=[x for x in data["rows"] if x["letterId"]==id and x["kind"]=="letter_name"]
        assert len(rows)==1
        row=rows[0]
        assert row["decision"]=="GENERATION_FAILED" and not row["previewAllowed"]
        assert "HTTP 429" in row["error"] or "RESOURCE_EXHAUSTED" in row["error"]
        assert row["csExact"]==letter["name"]
        assert row["textSha256"]==hashlib.sha256(letter["name"].encode()).hexdigest()
        record={"pack":pack,"sourceId":row["sourceId"],"csExact":letter["name"],
                "model":MODEL,"nativeApproved":False,"publicationAllowed":False}
        print("RETRY_ONLY_429",pack,id,flush=True)
        try:
            prompt=("A calm native Czech language teacher. Speak only the exact Czech alphabet "
                    "letter name phrase; never spell it in English or add explanations. "
                    "Preserve all Czech diacritics, stress and vowel lengths.")
            audio,info=fetch_audio("natural",prompt,token,text=letter["name"],voice=VOICE)
            name=letter["slug"]+"__letter_name.wav"
            tmp=out/name
            tmp.write_bytes(audio)
            technical=inspect_wav(tmp)
            record["technical"]=technical
            record["audioSha256"]=hashlib.sha256(audio).hexdigest()
            record["durationMs"]=info["duration_ms"]
            if technical["technical_pass"]:
                target=pub/name
                assert not target.exists()
                tmp.replace(target)
                row.update({"decision":"TECHNICAL_PREVIEW","previewAllowed":True,
                            "repoPath":str(target),"audioSha256":record["audioSha256"],
                            "durationMs":record["durationMs"],
                            "retryOf429":True})
                record["decision"]="TECHNICAL_PREVIEW"
            else:
                record["decision"]="QUARANTINED_RETRY"
        except Exception as exc:
            record["decision"]="GENERATION_FAILED_RETRY"
            record["error"]=str(exc)[:300]
        row.setdefault("quota429Retry",[]).append(record)
        path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        receipts.append(record)
        (out/"quota429_receipt.json").write_text(json.dumps({
            "maxBillableCalls":2,"attemptedCalls":len(receipts),
            "publicationAllowed":False,"rows":receipts,
        },ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        print("RETRY_429_RESULT",id,record["decision"],flush=True)
    print("RETRY_429_COMPLETE",len(receipts),flush=True)

if __name__=="__main__":
    main()
