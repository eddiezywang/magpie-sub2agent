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
            class Mirror:
                def records(self, kind):
                    if kind == "summary":
                        yield summary
                        yield {**summary, "install_id": "public-install", "username": "public-user"}

            result = collect(folder, now, "fixture-token", Mirror())
        self.assertNotIn("original-install", json.dumps(result))
        self.assertEqual(len(result["usage"]), 2)
        row = result["usage"][0]
        self.assertEqual(row[:2], ["2026-11-19", "fixture-user"])
        self.assertEqual(row[6:8], [2, 10])
        self.assertEqual(row[-1], "内网")
        self.assertEqual(result["usage"][1][1], "public-user")
        self.assertEqual(result["usage"][1][-1], "公网")
        self.assertEqual(result["activity"][0][5], "1.2.3")
        self.assertEqual(result["activity"][1][-1], "公网")

    def test_online_interval_crosses_midnight_and_retry_counts_once(self):
        now = datetime(2026, 11, 18, 16, 5, tzinfo=timezone.utc)
        flush = {"install_id": "install", "username": "fixture-user", "id": "stable-flush",
                 "event": "desktop_proxy_usage_flushed", "timestamp": now.isoformat(),
                 "argv": ["--proxy-usage-ms=600000"]}
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "minute-summaries").mkdir()
            (folder / "telemetry-20261118.jsonl").write_text((json.dumps(flush) + "\n") * 2)
            result = collect(folder, now, "fixture-token")
        by_day = {row[0]: row[6:] for row in result["activity"]}
        self.assertEqual(by_day, {"2026-11-18": [0, 300000, "内网"], "2026-11-19": [1, 300000, "内网"]})

    def test_public_packets_keep_source_and_deduplicate_against_intranet(self):
        now = datetime(2026, 11, 18, 17, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            folder.joinpath("minute-summaries").mkdir()
            group = dict.fromkeys(METRICS, 0)
            group.update(requests=1, model="m", agent="a", provider="p")
            packet = {"install_id": "roaming-install", "username": "roamer", "id": "packet-1",
                      "minute": now.isoformat(), "groups": [group]}
            (folder / "minute-summaries" / "summaries-20261118.jsonl").write_text(json.dumps(packet) + "\n")
            class Mirror:
                def records(self, kind):
                    if kind == "summary":
                        yield packet
                        yield {**packet, "id": "packet-2"}

            result = collect(folder, now, "fixture-token", Mirror())
        self.assertEqual(len(result["usage"]), 2)
        self.assertEqual([row[-1] for row in result["usage"]], ["内网", "公网"])
        self.assertEqual([row[6] for row in result["usage"]], [1, 1])
