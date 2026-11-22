import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "g1" / "recover_elevenlabs_history.py"
spec = importlib.util.spec_from_file_location("g1_history", MODULE_PATH)
g1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g1)

def item(source="s1", text="Dobrý den.", file="s1__hana.mp3"):
    return {"source_id": source, "cs_exact": text, "voice_id": "hana", "model": "eleven_multilingual_v2", "output_file_expected_name": file}

def history(history_id="H1", text="Dobrý den.", voice="hana", source="Flows"):
    return {"history_item_id": history_id, "text": text, "voice_id": voice, "model_id": "eleven_multilingual_v2", "source": source}

class TestPrivateG1(unittest.TestCase):
    def test_unicode_normalization_preserves_czech_accents(self):
        self.assertEqual(g1.exact("r\u030ca\u0301d"), g1.exact("řád"))
        self.assertNotEqual(g1.exact("rad"), g1.exact("řád"))

    def test_manifest_validation_and_duplicate_block(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "private_manifest.json"
            p.write_text(json.dumps({"records": [item()]}), encoding="utf-8")
            self.assertEqual(len(g1.valid_manifest(p, 1)), 1)
            with self.assertRaises(ValueError):
                g1.valid_manifest(p, 246)
            p.write_text(json.dumps({"records": [item(), item()]}), encoding="utf-8")
            with self.assertRaises(ValueError):
                g1.valid_manifest(p, 2)

    def test_reject_path_traversal(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "private.json"
            p.write_text(json.dumps({"records": [item(file="../evil.mp3")]}), encoding="utf-8")
            with self.assertRaises(ValueError):
                g1.valid_manifest(p, 1)

    def test_exact_matching_needs_voice_and_model(self):
        self.assertEqual(g1.match_manifest([item()], [history()], True)[0]["status"], "matched")
        self.assertEqual(g1.match_manifest([item()], [history(voice="jan")], True)[0]["status"], "missing")
        self.assertEqual(g1.match_manifest([item()], [history(source="TTS")], True)[0]["status"], "matched")

    def test_ambiguous_is_not_guessed(self):
        found = g1.match_manifest([item()], [history("H1"), history("H2")], True)
        self.assertEqual(found[0]["status"], "ambiguous")

    def test_page_limit_not_misreported_as_missing(self):
        self.assertEqual(g1.match_manifest([item()], [], False)[0]["status"], "not_found_in_partial_history")

    def test_list_only_never_downloads(self):
        with tempfile.TemporaryDirectory() as d:
            old_get = g1.get
            try:
                g1.get = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("must not fetch audio"))
                counts = g1.export([item()], [{"source_id": "s1", "status": "matched", "history_item_id": "H1", "file_name": "s1__hana.mp3"}], "dummy", Path(d), download=False)
                self.assertEqual(counts, {"matched": 1})
                self.assertEqual(list(Path(d).glob("*.mp3")), [])
            finally:
                g1.get = old_get

    def test_invalid_mp3_does_not_save(self):
        with tempfile.TemporaryDirectory() as d:
            old_get = g1.get
            try:
                g1.get = lambda *a, **k: b"x" * 300
                counts = g1.export([item()], [{"source_id": "s1", "status": "matched", "history_item_id": "H1", "file_name": "s1__hana.mp3"}], "dummy", Path(d), download=True)
                self.assertEqual(counts, {"invalid_mp3": 1})
                self.assertEqual(list(Path(d).glob("*.mp3")), [])
            finally:
                g1.get = old_get

if __name__ == "__main__":
    unittest.main()
