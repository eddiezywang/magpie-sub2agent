#!/usr/bin/env python3
"""Read-only intranet plugin directory and immutable complete bundles."""
import argparse
import http.server
import json
import pathlib
import urllib.parse


class Handler(http.server.SimpleHTTPRequestHandler):
    def list_directory(self, path):
        self.send_error(404)

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
        if self.path.endswith('.zip'):
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
