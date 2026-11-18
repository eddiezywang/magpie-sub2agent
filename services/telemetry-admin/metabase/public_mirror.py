"""Pull the public collector inbox onto 0.177 for packet-level deduplication."""
import json
import sqlite3
import ssl
import time
from datetime import datetime, timedelta, timezone
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class PublicMirror:
    def __init__(self, path, endpoint, token, ca):
        if not endpoint.startswith("https://"):
            raise ValueError("public mirror requires HTTPS")
        self.endpoint = endpoint.rstrip("/")
        self.headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
        self.opener = build_opener(NoRedirect(), HTTPSHandler(context=ssl.create_default_context(cafile=ca)))
        self.db = sqlite3.connect(path)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS packets
              (seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, added TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS cursor (id INTEGER PRIMARY KEY CHECK(id=1), seq INTEGER NOT NULL);
            INSERT OR IGNORE INTO cursor VALUES (1,0);
        """)

    def request(self, endpoint, payload=None, method=None):
        req = Request(self.endpoint + endpoint, data=payload, method=method, headers=self.headers)
        with self.opener.open(req, timeout=12) as response:
            body = response.read(8 * 1024 * 1024 + 1)
        if len(body) > 8 * 1024 * 1024:
            raise ValueError("public mirror response too large")
        return json.loads(body)

    def refresh(self):
        # Bounded catch-up keeps the separate internal BI sync running even after downtime.
        after = self.db.execute("SELECT seq FROM cursor WHERE id=1").fetchone()[0]
        now = datetime.now(timezone.utc)
        deadline = time.monotonic() + 15
        for _ in range(12):
            if time.monotonic() >= deadline:
                break
            batch = self.request(f"/mirror?after={after}")["rows"]
            if not batch:
                break
            with self.db:
                for record in batch:
                    seq, kind, payload = record["seq"], record["kind"], record["payload"]
                    if type(seq) is not int or seq <= after or kind not in {"legacy", "summary"}:
                        raise ValueError("invalid public mirror cursor")
                    if not isinstance(json.loads(payload), dict):
                        raise ValueError("invalid public packet")
                    self.db.execute("INSERT INTO packets VALUES (?,?,?,?)", (seq, kind, payload, now.isoformat()))
                    after = seq
                self.db.execute("UPDATE cursor SET seq=? WHERE id=1", (after,))
            if len(batch) < 64:
                break
        with self.db:
            cutoff = (now - timedelta(days=120)).isoformat()
            self.db.execute("DELETE FROM packets WHERE added<?", (cutoff,))

    def publish_rules(self, internal_endpoint):
        internal = build_opener(NoRedirect())
        with internal.open(internal_endpoint, timeout=4) as response:
            payload = response.read(1024 * 1024 + 1)
        if len(payload) > 1024 * 1024:
            raise ValueError("aggregation rules too large")
        self.request("/mirror/rules", payload, "PUT")

    def records(self, kind):
        cursor = self.db.execute("SELECT payload FROM packets WHERE kind=? ORDER BY seq", (kind,))
        for (payload,) in cursor:
            yield json.loads(payload)

    def close(self):
        self.db.close()
