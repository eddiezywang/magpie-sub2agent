#!/usr/bin/env python3
"""Serve signed release assets over authenticated TLS."""
import argparse
import hmac
import http.server
from pathlib import Path
import re
import ssl


class Handler(http.server.SimpleHTTPRequestHandler):
    def list_directory(self, path):
        self.send_error(404)

    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def send_head(self):
        auth = self.headers.get('Authorization', '').encode()
        if not hmac.compare_digest(auth, self.server.authorization):
            self.send_response(401)
            self.send_header('WWW-Authenticate', 'Basic realm="Sub2Agent release staging"')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None
        if not re.fullmatch(
            r'/(?:latest\.json|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/'
            r'(?:magpie-windows-amd64\.exe|magpie-darwin-(?:arm64|amd64)\.zip))', self.path
        ):
            self.send_error(404)
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'private, no-store')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--authorization', type=Path, required=True)
    parser.add_argument('--cert', required=True)
    parser.add_argument('--key', required=True)
    parser.add_argument('--port', type=int, default=443)
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    with http.server.ThreadingHTTPServer(('0.0.0.0', args.port),
                                        lambda *a: Handler(*a, directory=str(root))) as server:
        server.authorization = args.authorization.read_bytes().strip()
        if not server.authorization.startswith(b'Basic ') or len(server.authorization) <= 6:
            raise ValueError('missing Basic authorization')
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(args.cert, args.key)
        server.socket = tls.wrap_socket(server.socket, server_side=True, do_handshake_on_connect=False)
        server.serve_forever()


if __name__ == '__main__':
    main()
