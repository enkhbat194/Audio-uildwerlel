import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import wave

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "produce_chirp_czech_ab20.py"
spec = importlib.util.spec_from_file_location("chirp_ab", SCRIPT)
chirp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(chirp)
MANIFEST = Path(__file__).resolve().parents[1] / "production" / "ab_comparison" / "2026-11-21-gemini38-vs-chirp3hd-20.json"


def sample_wav():
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as sound:
        sound.setframerate(24000)
        sound.setsampwidth(2)
        sound.setnchannels(1)
        sound.writeframes(b"\x10\x01" * 24000)
    return buffer.getvalue()


class ChirpPrivateABTest(unittest.TestCase):
    def test_manifest_is_frozen_20_with_text_hashes(self):
        m = chirp.validate_manifest(MANIFEST)
        self.assertEqual(len(m["rows"]), 20)
        self.assertTrue(all(hashlib.sha256(r["cs_exact"].encode()).hexdigest() ==
                            r["text_sha256"] for r in m["rows"]))

    def test_wav_survives_quarantine_and_receipt_is_written(self):
        m = chirp.validate_manifest(MANIFEST)
        wav = sample_wav()
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "audio"
            result = chirp.run(m, output, 2, "FAKE_TOKEN",
                               synth=lambda text, token: wav)
            self.assertEqual(len(result["rows"]), 2)
            self.assertEqual(result["attempted_billable_calls"], 2)
            self.assertTrue((output / "chirp_comparison_report.json").is_file())
            for r in result["rows"]:
                self.assertEqual((output / r["storage_relative_path"]).read_bytes(), wav)
                self.assertEqual(r["owner_review_status"], "PENDING")
                self.assertFalse(r["publish_allowed"])
            self.assertEqual(len(result["unattempted_indices"]), 18)
            with self.assertRaisesRegex(ValueError, "REFUSE_OVERWRITE"):
                chirp.run(m, output, 1, "FAKE_TOKEN",
                          synth=lambda text, token: wav)

    def test_invalid_wav_is_kept_for_owner(self):
        m = chirp.validate_manifest(MANIFEST)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "audio"
            result = chirp.run(m, output, 1, "FAKE_TOKEN",
                               synth=lambda text, token: b"some incomplete audio")
            r = result["rows"][0]
            self.assertEqual(r["decision"], "QUARANTINED")
            self.assertEqual((output / r["storage_relative_path"]).read_bytes(),
                             b"some incomplete audio")

    def test_permission_error_stops_without_retry(self):
        m = chirp.validate_manifest(MANIFEST)
        calls = []
        def fail(text, token):
            calls.append(text)
            raise RuntimeError("CHIRP_HTTP_403")
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "audio"
            result = chirp.run(m, output, 20, "FAKE_TOKEN", synth=fail)
            self.assertEqual(len(calls), 1)
            self.assertEqual(result["attempted_billable_calls"], 1)
            self.assertEqual(len(result["unattempted_indices"]), 19)
            self.assertEqual(result["rows"][0]["decision"], "GENERATION_FAILED")

    def test_tampered_source_is_rejected(self):
        m = chirp.validate_manifest(MANIFEST)
        m["rows"][0]["cs_exact"] = "Dobrý večer."
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "tampered.json"
            p.write_text(json.dumps(m), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "SOURCE_TEXT_SHA256_MISMATCH"):
                chirp.validate_manifest(p)


if __name__ == "__main__":
    unittest.main()
