#!/usr/bin/env python3
"""Read-only intranet plugin directory and immutable complete bundles."""
import argparse
import http.server
import json
import pathlib
import re
import urllib.parse


class Handler(http.server.SimpleHTTPRequestHandler):
    def list_directory(self, path):
        self.send_error(404)

    def send_head(self):
        request_path = urllib.parse.urlsplit(self.path).path
        prefix = '/sub2agent/releases/'
        release_root = pathlib.Path(self.directory) / 'sub2agent/releases'
        target = pathlib.Path(self.translate_path(self.path))
        if target.is_relative_to(release_root) and not request_path.startswith(prefix):
            self.send_error(404)
            return None
        if request_path.startswith(prefix):
            route = request_path.removeprefix(prefix)
            if route == 'latest/windows-amd64':
                try:
                    manifest = json.loads((release_root / 'latest.json').read_bytes())
                    version = manifest['version']
                    name = 'Sub2Agent-windows-amd64.exe'
                    if (not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', version)
                            or 'magpie-windows-amd64.exe' not in manifest['assets']
                            or not (release_root / version / name).is_file()):
                        raise ValueError('Windows installer unavailable')
                except (OSError, ValueError, KeyError, TypeError):
                    self.send_error(503, 'Windows installer unavailable')
                    return None
                self.send_response(302)
                self.send_header('Location', f'../{version}/{name}')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return None
            if route != 'latest.json' and not re.fullmatch(
                r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/(?:magpie-windows-amd64\.exe|'
                r'Sub2Agent-windows-amd64\.exe|magpie-darwin-(?:arm64|amd64)\.zip)', route
            ):
                self.send_error(404)
                return None
        return super().send_head()

    def do_GET(self):
        if urllib.parse.urlsplit(self.path).path == '/healthz':
            try:
                catalog = json.loads((pathlib.Path(self.directory) / 'magpie/plugins/registry.json').read_text('utf-8'))
                assert isinstance(catalog['plugins'], list)
                body = json.dumps({'status': 'ok', 'plugins': len(catalog['plugins'])}).encode()
                self.send_response(200)
            except (OSError, ValueError, KeyError, AssertionError):
                body = b'{"status":"invalid-directory"}'
                self.send_response(503)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        request_path = urllib.parse.urlsplit(self.path).path
        if request_path in ('/sub2agent/releases/latest.json', '/sub2agent/releases/latest/windows-amd64'):
            self.send_header('Cache-Control', 'no-store')
        elif request_path.endswith('.zip') or re.fullmatch(r'/sub2agent/releases/[^/]+/[^/]+\.exe', request_path):
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        else:
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def guess_type(self, path):
        if '/npm/' in path.replace('\\', '/'):
            return 'application/json'
        return super().guess_type(path)

    def setup(self):
        super().setup()
        self.connection.settimeout(30)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True, type=pathlib.Path)
    parser.add_argument('--bind', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=80)
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    handler = lambda *a, **kw: Handler(*a, directory=str(root), **kw)
    http.server.ThreadingHTTPServer((args.bind, args.port), handler).serve_forever()


if __name__ == '__main__':
    main()
