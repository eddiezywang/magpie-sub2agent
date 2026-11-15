#!/usr/bin/env python3
"""Read-only release mirror; never exposes local directories."""
import argparse
import http.server
from pathlib import Path

class Handler(http.server.SimpleHTTPRequestHandler):
    def list_directory(self, path):
        self.send_error(404)
    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
    def setup(self):
        super().setup()
        self.connection.settimeout(60)

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--root', type=Path, required=True)
    p.add_argument('--bind', default='0.0.0.0')
    p.add_argument('--port', type=int, default=8899)
    args = p.parse_args()
    root = args.root.resolve(strict=True)
    def handler(*a, **kw):
        return Handler(*a, directory=str(root), **kw)
    http.server.ThreadingHTTPServer((args.bind, args.port), handler).serve_forever()

if __name__ == '__main__':
    main()
