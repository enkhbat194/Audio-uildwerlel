#!/usr/bin/env python3
"""Recheck three original Gemini WAVs with independent Czech medium ASR.
No new TTS, no retries, no phonological equivalence guesswork.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
from auto_audio_qa import asr_engine,transcribe,score_text,inspect_wav

ORIGINAL_RUN=44747265771
EXPECTED={"B","C","Č"}
def main():
    pub=Path("production/alphabet-preview/pack01")
    manifest_path=pub/"manifest.json"
    data=json.loads(manifest_path.read_text(encoding="utf-8"))
    assert data["publicationAllowed"] is False and data["nativeApproved"] is False
    pending=[r for r in data["rows"] if r["kind"]=="sound_in_word" and not r["previewAllowed"]]
    assert {r["letterId"] for r in pending}==EXPECTED
    root=Path(os.environ["AHOJ_ORIGINAL_ALPHABET_ARTIFACT"])
    print("QA_MEDIUM_ORIGINAL_RUN",ORIGINAL_RUN,flush=True)
    files=list(root.rglob("*.wav"))
    print("ORIGINAL_WAV_COUNT",len(files),flush=True)
    assert len(files)>=10
    model=asr_engine("medium")
    promoted=0
    for row in pending:
        slug={"B":"B","C":"C","Č":"C_CARON"}[row["letterId"]]
        filename=slug+"__sound_in_word.wav"
        matches=[p for p in files if p.name==filename]
        assert len(matches)==1,filename
        path=matches[0]
        actual=hashlib.sha256(path.read_bytes()).hexdigest()
        assert actual==row["audioSha256"],filename+" SHA MISMATCH"
        technical=inspect_wav(path)
        assert technical["technical_pass"],filename
        heard=transcribe(model,path)
        qa=score_text(row["csExact"],heard)
        row["mediumAsrText"]=heard
        row["mediumAsrExact"]=qa["exact"]
        print("MEDIUM_CZECH_QA",row["letterId"],"expected",row["csExact"],"heard",heard,"exact",qa["exact"],flush=True)
        if qa["exact"]:
            target=pub/filename
            assert not target.exists()
            shutil.copyfile(path,target)
            row["decision"]="AUTO_PASS_MEDIUM"
            row["previewAllowed"]=True
            row["repoPath"]=str(target)
            promoted+=1
    data["mediumQaRecheckOriginalRun"]=ORIGINAL_RUN
    data["mediumQaPromoted"]=promoted
    manifest_path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("MEDIUM_QA_COMPLETE_PROMOTED",promoted,"STILL_QUARANTINED",len(pending)-promoted,flush=True)

if __name__=="__main__":
    main()
