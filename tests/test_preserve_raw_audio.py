import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

# Stub paid API and heavy ASR: these are pure, no-network integration tests.
v = types.ModuleType("voice_quality_full_sentence")
v.MODEL = "gemini-3.8-flash-tts"
v.VOICE = "Achernar"
v.access_token = lambda: "LOCAL_TEST_TOKEN"
RAW = b"RIFF ORIGINAL AUDIO WAVE UNTOUCHED"
POLISHED = b"RIFF POLISHED AUDIO WAVE"
v.fetch_audio = lambda *args, **kwargs: (RAW, {"audio_sha256": hashlib.sha256(RAW).hexdigest()})
a = types.ModuleType("auto_audio_qa")
a.inspect_wav = lambda *args: {"technical_pass": True, "max_internal_pause_seconds": 0.5}
a.score_text = lambda *args: {}
a.asr_engine = lambda *args: object()
a.transcribe = lambda *args: ""
p = types.ModuleType("polish_internal_pauses")
p.optimize_silence = lambda wav: (POLISHED, [{"removed_seconds": 0.2}])
sys.modules.update({
    "voice_quality_full_sentence": v,
    "auto_audio_qa": a,
    "polish_internal_pauses": p,
})
spec = importlib.util.spec_from_file_location("produce_testable", SCRIPTS / "produce_curriculum_batch.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
qs = importlib.util.spec_from_file_location("review_testable", SCRIPTS / "build_owner_review_queue.py")
review = importlib.util.module_from_spec(qs)
qs.loader.exec_module(review)


def cfg():
    cs = "Dobrý den."
    return {
        "batch_id": "LOCAL-TEST", "dataset_version": "v0.9.20",
        "variants": ["natural"],
        "rows": [{
            "source_id": "CZ-A0-M01-L01-PH001", "cs_exact": cs,
            "text_sha256": hashlib.sha256(cs.encode()).hexdigest(),
            "lesson_id": "CZ-A0-M01-L01", "intent": "polite_greeting",
            "emotion": "neutral", "speaker_role": "teacher", "kind": "phrase",
            "source_gate": "language_prosody_review",
        }],
    }


class PreserveRawTest(unittest.TestCase):
    def execute(self, fail_qa=False):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        dest = Path(tmp.name) / "audio"
        qa = lambda *args: {"decision": "QUARANTINED", "technical": {"duration_seconds": 1.0}}
        if fail_qa:
            def qa(*args):
                raise RuntimeError("ASR temporarily unavailable")
        with patch.object(mod, "source_validate", return_value=cfg()), patch.object(
            mod, "automated_quality", side_effect=qa
        ), patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "AHOJ_GCP_ACCESS_TOKEN": "TEST"}), patch.object(
            sys, "argv", ["produce", "--manifest", "unused.json", "--out-dir", str(dest), "--generate"]
        ):
            mod.main()
        report = json.loads((dest / "production_report.json").read_text(encoding="utf-8"))
        return dest, report

    def test_quarantined_audio_and_original_are_both_retained(self):
        dest, report = self.execute()
        row = report["rows"][0]
        self.assertEqual(row["decision"], "QUARANTINED")
        self.assertEqual((dest / row["raw_storage_relative_path"]).read_bytes(), RAW)
        self.assertEqual((dest / row["storage_relative_path"]).read_bytes(), POLISHED)
        queue = review.build_queue(dest / "production_report.json", dest)
        self.assertEqual(queue["owner_review_required"], 1)
        self.assertTrue(all(item["exists"] and item["hash_verified"]
                            for item in queue["items"][0]["variants_for_listening"]))
        self.assertEqual(queue["items"][0]["owner_decision"], "PENDING")

    def test_qa_crash_preserves_original_for_owner(self):
        dest, report = self.execute(fail_qa=True)
        row = report["rows"][0]
        self.assertEqual(row["decision"], "QUARANTINED")
        self.assertEqual(report["counts"]["GENERATION_FAILED"], 0)
        self.assertEqual((dest / row["raw_storage_relative_path"]).read_bytes(), RAW)
        self.assertIn("ASR temporarily unavailable", row["qa_pipeline_error"])
        self.assertEqual(review.build_queue(dest / "production_report.json", dest)["owner_review_required"], 1)


if __name__ == "__main__":
    unittest.main()
