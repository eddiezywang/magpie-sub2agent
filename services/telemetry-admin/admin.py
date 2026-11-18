"""Aggregate collector data locally and serve a read-only telemetry dashboard."""
import base64
import hmac
import json
import os
import re
import ssl
import sys
import tempfile
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.request import HTTPRedirectHandler, Request, build_opener

ZONE = timezone(timedelta(hours=8))
EVENTS = {
    "desktop_app_start": "桌面启动",
    "desktop_app_quit": "桌面退出",
    "desktop_proxy_usage_flushed": "网关在线上报",
    "desktop_proxy_start": "网关启动",
    "desktop_proxy_stop": "网关停止",
    "desktop_operation_failed": "客户端操作失败",
    "app_start": "旧版启动",
    "process_start": "进程启动",
    "other": "其他事件",
}
LIMIT = 4 * 1024 * 1024
DAYS = 90
TOKENS = ("input_tokens", "output_tokens", "cache_read_tokens",
          "cache_write_5m_tokens", "cache_write_1h_tokens")
VERSION = re.compile(r"v?\d{1,5}\.\d{1,5}\.\d{1,5}(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?")
DEVICE = re.compile(r"[0-9a-f]{24}")


def rows(folder, pattern, earliest):
    for file in sorted(folder.glob("*.jsonl")):
        match = re.fullmatch(pattern, file.name)
        if not match or match[1] < earliest:
            continue
        with file.open("rb") as handle:
            for line in handle:
                if line.endswith(b"\n") and line.strip():
                    yield json.loads(line)


def collect(folder, now, token):
    if not folder.is_dir():
        raise FileNotFoundError(folder)
    today = now.astimezone(ZONE).date()
    first = today - timedelta(days=DAYS - 1)
    # The storage partition may use a different timezone from the dashboard.
    earliest = (first - timedelta(days=1)).strftime("%Y%m%d")
    daily = {}
    installs = {}
    versions = {}

    def bucket(timestamp):
        day = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(ZONE).date()
        if first <= day <= today:
            return day.isoformat()
        return None

    def counts(day):
        return daily.setdefault(day, {"events": Counter(), "requests": 0, "active": 0})

    def device(day, raw_id):
        pseudonym = hmac.digest(token.encode(), b"install-id:" + raw_id.encode(), "sha256").hex()[:24]
        devices = installs.setdefault(day, {})
        return pseudonym, devices.setdefault(pseudonym, {"requests": 0, "tokens": Counter()})

    for row in rows(folder, r"telemetry-(?:archived-)?(\d{8})\.jsonl", earliest):
        day = bucket(row["timestamp"])
        if day is None:
            continue
        name = row["event"]
        counts(day)["events"][name if name in EVENTS else "other"] += 1
        if row.get("install_id"):
            pseudonym, _ = device(day, row["install_id"])
            version = row.get("app_version")
            if isinstance(version, str) and len(version) <= 64 and VERSION.fullmatch(version):
                observed = datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))
                key = day, pseudonym
                if key not in versions or observed >= versions[key][0]:
                    versions[key] = observed, version

    seen = set()
    for row in rows(folder / "minute-summaries", r"summaries-(\d{8})\.jsonl", earliest):
        key = row["install_id"], row["id"]
        if key in seen:
            continue
        seen.add(key)
        day = bucket(row["minute"])
        if day is None:
            continue
        _, install = device(day, row["install_id"])
        for group in row["groups"]:
            counts(day)["requests"] += group["requests"]
            install["requests"] += group["requests"]
            for field in TOKENS:
                install["tokens"][field] += group.get(field, 0)


    for day, devices in sorted(installs.items()):
        counts(day)["active"] = len(devices)
        counts(day)["devices"] = devices
        for pseudonym, install in devices.items():
            if (day, pseudonym) in versions:
                install["version"] = versions[day, pseudonym][1]
    return {"generated_at": now.isoformat(), "days": daily}


def read_snapshot(raw):
    data = json.loads(raw)
    generated = datetime.fromisoformat(data["generated_at"])
    if generated.tzinfo is None or abs(datetime.now(timezone.utc) - generated) > timedelta(minutes=10):
        raise ValueError("invalid snapshot timestamp")
    days = data["days"]
    if type(days) is not dict or len(days) > DAYS:
        raise ValueError("invalid days")

    def count(value):
        if type(value) is not int or not 0 <= value <= 2**53 - 1:
            raise ValueError("invalid counter")
        return value

    clean = {}
    for day, row in days.items():
        if date.fromisoformat(day).isoformat() != day:
            raise ValueError("invalid day")
        if not row["events"].keys() <= EVENTS.keys():
            raise ValueError("unknown event name")
        clean[day] = {"events": {key: count(value) for key, value in row["events"].items()},
                      "requests": count(row["requests"]), "active": count(row["active"])}
        if "devices" in row:
            clean_devices = {}
            for pseudonym, detail in row["devices"].items():
                if not DEVICE.fullmatch(pseudonym):
                    raise ValueError("invalid pseudonym")
                tokens = detail["tokens"]
                clean_detail = {
                    "requests": count(detail["requests"]),
                    "tokens": {field: count(tokens.get(field, 0)) for field in TOKENS},
                }
                version = detail.get("version")
                if version is not None:
                    if len(version) > 64 or not VERSION.fullmatch(version):
                        raise ValueError("invalid version")
                    clean_detail["version"] = version
                clean_devices[pseudonym] = clean_detail
            clean[day]["devices"] = clean_devices
    return {"generated_at": generated.isoformat(), "days": clean}


def save_snapshot(path, data):
    fd, name = tempfile.mkstemp(dir=path.parent)
    temp = Path(name)
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(data, handle)
            handle.flush()
            os.fsync(handle.fileno())
        temp.replace(path)
    finally:
        if temp.exists():
            temp.unlink()


def sync(folder, endpoint, token):
    if not endpoint.startswith(("http://", "https://")):
        raise ValueError("invalid sync URL")
    data = json.dumps(collect(folder, datetime.now(timezone.utc), token)).encode()
    request = Request(endpoint, data=data, headers={"Authorization": "Snapshot " + hmac.digest(token.encode(), data, "sha256").hex(),
                                                    "Content-Type": "application/json"})
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    with build_opener(NoRedirect()).open(request, timeout=25) as response:
        if response.status != 204 or response.geturl() != endpoint:
            raise RuntimeError("unexpected sync response")


def serve(state, username, password, token, host, port, cert=None, key=None):
    basic = "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()
    web = Path(__file__).parent

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            self.request.settimeout(10)
            super().setup()

        def reply(self, status, mime="text/plain", body=b"", challenge=False):
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'")
            if challenge:
                self.send_header("WWW-Authenticate", 'Basic realm="Sub2Agent telemetry"')
            self.end_headers()
            self.wfile.write(body)

        def authorized(self, expected):
            return hmac.compare_digest(self.headers.get("Authorization", "").encode(), expected.encode())

        def do_GET(self):
            if not self.authorized(basic):
                self.reply(401, challenge=True)
                return
            if self.path == "/api/stats":
                snapshot = json.loads(state.read_text()) if state.exists() else {"generated_at": None, "days": {}}
                data = json.dumps({**snapshot, "event_labels": EVENTS}).encode()
                self.reply(200, "application/json", data)
                return
            assets = {"/": ("index.html", "text/html; charset=utf-8"),
                      "/dashboard.js": ("dashboard.js", "text/javascript"),
                      "/dashboard.css": ("dashboard.css", "text/css")}
            if self.path not in assets:
                self.reply(404)
                return
            name, mime = assets[self.path]
            self.reply(200, mime, (web / name).read_bytes())

        def do_POST(self):
            if self.path != "/api/snapshot":
                self.reply(404)
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= LIMIT:
                    self.reply(413)
                    return
                raw = self.rfile.read(size)
                expected = "Snapshot " + hmac.digest(token.encode(), raw, "sha256").hex()
                if not self.authorized(expected):
                    self.reply(401)
                    return
                data = read_snapshot(raw)
            except (ValueError, TypeError, KeyError, AttributeError):
                self.reply(400)
                return
            with self.server.snapshot_lock:
                if state.exists():
                    previous = json.loads(state.read_text())["generated_at"]
                    if datetime.fromisoformat(data["generated_at"]) < datetime.fromisoformat(previous):
                        self.reply(409)
                        return
                save_snapshot(state, data)
            self.reply(204)

    from threading import Lock

    with ThreadingHTTPServer((host, port), Handler) as server:
        server.snapshot_lock = Lock()
        if cert:
            tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls.minimum_version = ssl.TLSVersion.TLSv1_2
            tls.load_cert_chain(cert, key)
            # Keep the accept socket plain so handshake timeouts apply per client.
            original_setup = Handler.setup

            def tls_setup(handler):
                handler.request.settimeout(10)
                handler.request = tls.wrap_socket(handler.request, server_side=True)
                original_setup(handler)

            Handler.setup = tls_setup
        server.serve_forever()


if __name__ == "__main__":
    env = os.environ
    if sys.argv[1:] == ["sync"]:
        sync(Path(env["USAGE_DATA"]), env["SYNC_URL"], env["SYNC_TOKEN"])
    else:
        serve(Path(env["SNAPSHOT_FILE"]), env["ADMIN_USER"], env["ADMIN_PASSWORD"],
              env["SYNC_TOKEN"], env.get("HOST", "127.0.0.1"), int(env.get("PORT", "8843")),
              env.get("TLS_CERT"), env.get("TLS_KEY"))
