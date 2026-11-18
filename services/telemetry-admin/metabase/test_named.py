import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from named import METRICS, collect


class NamedExportTest(unittest.TestCase):
    def test_retains_username_and_deduplicates_packets(self):
        now = datetime(2026, 11, 18, 17, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            event = {"install_id": "original-install", "username": "fixture-user",
                     "app_version": "1.2.3", "timestamp": now.isoformat()}
            (folder / "telemetry-20261118.jsonl").write_text(json.dumps(event) + "\n")
            summaries = folder / "minute-summaries"
            summaries.mkdir()
            group = dict.fromkeys(METRICS, 0)
            group.update(requests=2, input_tokens=10, model="m", agent="a", provider="p")
            summary = {**event, "id": "stable", "minute": now.isoformat(), "groups": [group]}
            (summaries / "summaries-20261118.jsonl").write_text((json.dumps(summary) + "\n") * 2)
            result = collect(folder, now, "fixture-token")
        self.assertNotIn("original-install", json.dumps(result))
        self.assertEqual(len(result["usage"]), 1)
        row = result["usage"][0]
        self.assertEqual(row[:2], ["2026-11-19", "fixture-user"])
        self.assertEqual(row[6:8], [2, 10])
        self.assertEqual(result["activity"][0][-1], "1.2.3")
