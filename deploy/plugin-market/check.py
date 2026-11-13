#!/usr/bin/env python3
"""Read-only catalog, metadata and artifact verification from any intranet host."""
import argparse
import hashlib
import json
import urllib.parse
import urllib.request


def check(base):
    base = base.rstrip('/')
    def read(path):
        with urllib.request.urlopen(base + path, timeout=6) as response:
            return response.read(32 * 1024 * 1024 + 1)
    assert json.loads(read('/healthz'))['status'] == 'ok'
    catalog = json.loads(read('/magpie/plugins/registry.json'))
    for plugin in catalog['plugins']:
        bundle = plugin['bundle']
        url = urllib.parse.urlsplit(bundle['url'])
        assert url.hostname == '172.21.0.177' and url.path.startswith('/magpie/plugins/dist/')
        data = read(url.path)
        assert len(data) == bundle['bytes']
        assert hashlib.sha256(data).hexdigest() == bundle['sha256']
        metadata = json.loads(read('/npm/' + urllib.parse.quote(plugin['package'], safe='@') + '/latest'))
        assert metadata['name'] == plugin['package'] and metadata['version'] == bundle['version']
    print(json.dumps({'status': 'ok', 'plugins': len(catalog['plugins']), 'server': base}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://172.21.0.177')
    check(parser.parse_args().base)
