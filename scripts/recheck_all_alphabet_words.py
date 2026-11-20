#!/usr/bin/env python3
"""Offline second Czech ASR pass on quarantined original Gemini alphabet WAVs.

Promote only exact medium-ASR matches to QA Preview. Never native-release,
change Czech text, synthesize new audio, or relax Czech vowel-length checks.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
from auto_audio_qa import asr_engine,transcribe,score_text,inspect_wav

ORIGINAL_RUN=44748388026
def main():
    root=Path(os.environ["AHOJ_PACK_ARTIFACT_ROOT"])
    model=None
    checked=0
    promoted=0
    unresolved=[]
    for index in range(2,10):
        pack=f"pack{index:02d}"
        public=Path("production/alphabet-preview")/pack
        file=public/"manifest.json"
        if not file.exists():
            unresolved.append({"pack":pack,"reason":"missing_manifest"})
            continue
        d=json.loads(file.read_text(encoding="utf-8"))
        assert d["packId"]==f"CZ-ALPHA-P{index:02d}"
        assert d["publicationAllowed"] is False and d["nativeApproved"] is False
        source=json.loads((Path("production/alphabet")/(pack+".json")).read_text(encoding="utf-8"))
        original=root/pack
        for row in d["rows"]:
            if row["kind"]!="sound_in_word" or row["previewAllowed"]:
                continue
            if row["decision"]=="GENERATION_FAILED" or not row.get("audioSha256"):
                unresolved.append({"pack":pack,"letter":row["letterId"],"reason":"no_original_wav"})
                continue
            letter=next((l for l in source["letters"] if l["id"]==row["letterId"]),None)
            assert letter and row["csExact"]==letter["word"]
            filename=letter["slug"]+"__sound_in_word.wav"
            matches=list(original.rglob(filename)) if original.exists() else []
            hashes={hashlib.sha256(p.read_bytes()).hexdigest():p for p in matches}
            if row["audioSha256"] not in hashes:
                unresolved.append({"pack":pack,"letter":row["letterId"],"reason":"sha_or_artifact_missing"})
                continue
            path=hashes[row["audioSha256"]]
            if not inspect_wav(path)["technical_pass"]:
                unresolved.append({"pack":pack,"letter":row["letterId"],"reason":"technical"})
                continue
            if model is None:model=asr_engine("medium")
            heard=transcribe(model,path)
            exact=score_text(row["csExact"],heard)["exact"]
            row["mediumAsrText"]=heard
            row["mediumAsrExact"]=exact
            checked+=1
            print("CZECH_MEDIUM_QA",pack,row["letterId"],"heard",heard,"exact",exact,flush=True)
            if exact:
                target=public/filename
                assert not target.exists()
                shutil.copyfile(path,target)
                row["decision"]="AUTO_PASS_MEDIUM"
                row["previewAllowed"]=True
                row["repoPath"]=str(target)
                promoted+=1
            else:
                unresolved.append({"pack":pack,"letter":row["letterId"],"reason":"medium_mismatch","heard":heard})
        d["mediumQaOriginalRun"]=ORIGINAL_RUN
        d["mediumQaPromoted"]=sum(1 for x in d["rows"] if x["decision"]=="AUTO_PASS_MEDIUM")
        file.write_text(json.dumps(d,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    result={"originalRun":ORIGINAL_RUN,"asrModel":"medium","additionalTtsCalls":0,
            "publicationAllowed":False,"checked":checked,"promoted":promoted,"unresolved":unresolved}
    Path("production/alphabet-preview/medium-qa-report.json").write_text(
        json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("ALPHABET_MEDIUM_QA_COMPLETE",json.dumps({
      "checked":checked,"promoted":promoted,"unresolved":len(unresolved)
    }),flush=True)

if __name__=="__main__":
    main()
