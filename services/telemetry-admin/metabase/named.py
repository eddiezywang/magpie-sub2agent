"""Synchronize named daily analytics over a pinned HTTPS connection."""
import hmac
import json
import os
import re
import ssl
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

ZONE = timezone(timedelta(hours=8))
DAYS = 90
LIMIT = 16 * 1024 * 1024
METRICS = ("requests", "input_tokens", "output_tokens", "cache_read_tokens",
           "cache_write_5m_tokens", "cache_write_1h_tokens")
DIMENSIONS = ("agent", "provider", "model")


def parse_time(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a timezone")
    return parsed


def rows(folder, pattern, earliest):
    for file in sorted(folder.glob("*.jsonl")):
        match = re.fullmatch(pattern, file.name)
        if match and match[1] >= earliest:
            with file.open("rb") as stream:
                for line in stream:
                    if line.endswith(b"\n") and line.strip():
                        yield json.loads(line)


def identity(row, token):
    raw = row.get("install_id")
    if not isinstance(raw, str) or not raw:
        return None
    user = row.get("username")
    if not isinstance(user, str) or user.strip().lower() in ("", "unknown"):
        user = None
    install = hmac.digest(token.encode(), b"bi-install:" + raw.encode(), "sha256").hex()[:24]
    return user, install


def collect(folder, now, token):
    today = now.astimezone(ZONE).date()
    first = today - timedelta(days=DAYS - 1)
    earliest = (first - timedelta(days=1)).strftime("%Y%m%d")
    if not (folder / "minute-summaries").is_dir():
        raise FileNotFoundError("collector summary directory unavailable")
    activity, usage, seen, seen_events = {}, {}, set(), set()

    def activity_for(at, who):
        day = at.astimezone(ZONE).date()
        if not first <= day <= today:
            return None
        key = (day.isoformat(), *who)
        active = activity.setdefault(key, [at, None, None, 0, 0])
        active[0] = max(active[0], at)
        return key, active

    for row in rows(folder, r"telemetry-(?:archived-)?(\d{8})\.jsonl", earliest):
        who = identity(row, token)
        if who is None:
            continue
        at = parse_time(row["timestamp"])
        found = activity_for(at, who)
        if not found:
            continue
        _, active = found
        event = row.get("event", "")
        marker = row.get("id") or (row["timestamp"], event, tuple(row.get("argv") or ()))
        event_key = who, marker
        if event_key in seen_events:
            continue
        seen_events.add(event_key)
        if event.startswith("desktop_") or (event == "app_start" and row.get("entry_mode") == "desktop"):
            active[3] += 1
        if event == "desktop_proxy_usage_flushed":
            args = row.get("args") or {}
            duration = args.get("proxy-usage-ms")
            if duration is None:
                duration = next((flag.partition("=")[2] for flag in (row.get("argv") or ())
                                 if isinstance(flag, str) and flag.startswith("--proxy-usage-ms=")), "")
            if str(duration).isdigit() and 0 < int(duration) <= 7 * 86400000:
                start = at.astimezone(ZONE) - timedelta(milliseconds=int(duration))
                end = at.astimezone(ZONE)
                start = max(start, datetime.combine(first, datetime.min.time(), ZONE))
                while start < end:
                    midnight = datetime.combine(start.date() + timedelta(days=1), datetime.min.time(), ZONE)
                    stop = min(end, midnight)
                    _, period = activity_for(start, who)
                    period[4] += int((stop - start) / timedelta(milliseconds=1))
                    start = stop
        version = row.get("app_version")
        if isinstance(version, str) and 0 < len(version) <= 64 and (active[1] is None or at >= active[1]):
            active[1:3] = at, version

    for row in rows(folder / "minute-summaries", r"summaries-(\d{8})\.jsonl", earliest):
        packet = row["install_id"], row["id"]
        if packet in seen:
            continue
        seen.add(packet)
        at = parse_time(row["minute"])
        who = identity(row, token)
        if who is None:
            continue
        found = activity_for(at, who)
        if not found:
            continue
        day_key, _ = found
        for group in row["groups"]:
            key = (*day_key, *(group[field] for field in DIMENSIONS))
            counter = usage.setdefault(key, Counter())
            for field in METRICS:
                counter[field] += group[field]

    return {
        "generated_at": now.isoformat(),
        "activity": [[*key, last.isoformat(), version_at.isoformat() if version_at else None, version, app_events, online_ms]
                     for key, (last, version_at, version, app_events, online_ms) in activity.items()],
        "usage": [[*key, *(counter[field] for field in METRICS)] for key, counter in usage.items()],
    }


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def send(folder, endpoint, token, ca):
    if not endpoint.startswith("https://"):
        raise ValueError("named export requires HTTPS")
    raw = json.dumps(collect(folder, datetime.now(timezone.utc), token), separators=(",", ":")).encode()
    if len(raw) > LIMIT:
        raise ValueError("analytics snapshot exceeds limit")
    signature = hmac.digest(token.encode(), b"bi-snapshot:" + raw, "sha256").hex()
    request = Request(endpoint, data=raw, headers={"Authorization": "Snapshot " + signature,
                                                  "Content-Type": "application/json"})
    tls = ssl.create_default_context(cafile=ca)
    with build_opener(NoRedirect(), HTTPSHandler(context=tls)).open(request, timeout=50) as reply:
        if reply.status != 204:
            raise RuntimeError("unexpected analytics receiver response")


def write_snapshot(data, dsn):
    import psycopg2
    from psycopg2.extras import execute_values

    generated = parse_time(data["generated_at"])
    if abs(datetime.now(timezone.utc) - generated) > timedelta(minutes=10):
        raise ValueError("snapshot timestamp outside allowed window")
    with psycopg2.connect(dsn) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(8897001)")
        cursor.execute("SELECT generated_at FROM analytics.snapshot WHERE id")
        prior = cursor.fetchone()
        if prior and generated <= prior[0]:
            return
        cursor.execute("TRUNCATE analytics.daily_activity, analytics.daily_usage")
        execute_values(cursor, "INSERT INTO analytics.daily_activity VALUES %s", data["activity"])
        execute_values(cursor, "INSERT INTO analytics.daily_usage VALUES %s", data["usage"])
        cursor.execute("INSERT INTO analytics.snapshot VALUES (true, %s) "
                       "ON CONFLICT (id) DO UPDATE SET generated_at = excluded.generated_at", (generated,))


def receive(dsn, token, port):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            self.request.settimeout(65)
            super().setup()

        def do_POST(self):
            if self.path != "/api/bi-snapshot":
                self.send_error(404)
                return
            try:
                size = int(self.headers.get("Content-Length", 0))
                if not 0 < size <= LIMIT:
                    self.send_error(413)
                    return
                raw = self.rfile.read(size)
                expected = "Snapshot " + hmac.digest(token.encode(), b"bi-snapshot:" + raw, "sha256").hex()
                if not hmac.compare_digest(self.headers.get("Authorization", "").encode(), expected.encode()):
                    self.send_error(401)
                    return
                write_snapshot(json.loads(raw), dsn)
            except (ValueError, TypeError, KeyError):
                self.send_error(400)
                return
            except Exception as error:
                self.log_error("database import failed: %s", type(error).__name__)
                self.send_error(503)
                return
            self.send_response(204)
            self.end_headers()

    with ThreadingHTTPServer(("127.0.0.1", port), Handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    env = os.environ
    if sys.argv[1:] == ["sync"]:
        send(Path(env["USAGE_DATA"]), env["BI_SYNC_URL"], env["SYNC_TOKEN"], env["BI_CA_FILE"])
    else:
        receive(Path(env["BI_WRITER_DSN_FILE"]).read_text().strip(), env["SYNC_TOKEN"],
                int(env.get("BI_LISTEN_PORT", "18898")))
