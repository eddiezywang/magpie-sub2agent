import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from admin import collect, read_snapshot, save_snapshot


class SnapshotTest(unittest.TestCase):
    def test_aggregation_keeps_only_counters_and_deduplicates_summaries(self):
        now = datetime.now(timezone.utc)
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            stamp = now.strftime("%Y%m%d")
            identity = {"install_id": "internal-device", "username": "internal-user"}
            telemetry = dict(identity, event="desktop_app_start", app_version="1.0.0-beta.3", timestamp=now.isoformat())
            unexpected = dict(telemetry, event="private message")
            records = "\n".join(map(json.dumps, (telemetry, unexpected))) + "\n"
            (folder / f"telemetry-{stamp}.jsonl").write_text(records + "{")
            usage = dict(identity, id="stable-id", minute=now.isoformat(), groups=[{"requests": 8, "input_tokens": 20, "output_tokens": 4}])
            (folder / "minute-summaries").mkdir()
            (folder / f"minute-summaries/summaries-{stamp}.jsonl").write_text((json.dumps(usage) + "\n") * 2)
            snapshot = collect(folder, now, "fixture-secret")
            wire = json.dumps(snapshot)
            self.assertNotIn("internal-", wire)
            self.assertNotIn("private message", wire)
            day = next(iter(snapshot["days"].values())).copy()
            devices = day.pop("devices")
            self.assertEqual(len(devices), 1)
            detail = next(iter(devices.values()))
            self.assertEqual(detail["version"], "1.0.0-beta.3")
            self.assertEqual(detail["tokens"]["input_tokens"], 20)
            self.assertEqual(detail["tokens"]["output_tokens"], 4)
            self.assertEqual(day, {
                "active": 1, "requests": 8, "events": {"desktop_app_start": 1, "other": 1}
            })
            file = folder / "snapshot.json"
            save_snapshot(file, read_snapshot(wire))
            self.assertEqual(json.loads(file.read_text()), snapshot)

    def test_receiver_rejects_unrecognized_events(self):
        now = datetime.now(timezone.utc)
        with self.assertRaises(ValueError):
            read_snapshot(json.dumps({"generated_at": now.isoformat(),
                                      "days": {now.date().isoformat(): {"events": {"data": 1}}}}))


if __name__ == "__main__":
    unittest.main()
