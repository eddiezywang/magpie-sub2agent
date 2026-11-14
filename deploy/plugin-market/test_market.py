import hashlib
import io
import json
import pathlib
import tempfile
import threading
import unittest
import urllib.request
import zipfile
from functools import partial
from http.server import ThreadingHTTPServer
from publish import publish
from serve import Handler


class MarketTests(unittest.TestCase):
    def test_hooks_page_bundle_has_only_declared_files(self):
        with tempfile.TemporaryDirectory() as temp:
            base = pathlib.Path(temp)
            plugin = base / 'plugin'
            (plugin / 'page').mkdir(parents=True)
            manifest = {'name': '@internal/notify', 'type': 'module', 'sub2agentBundle': 2,
                        'files': ['notify.mjs', 'page/index.html', 'page/app.js'],
                        'magpie': {'hooks': './notify.mjs', 'page': {'file': 'page/index.html', 'title': 'Notify'}}}
            for name in manifest['files']:
                (plugin / name).write_text('fixture', encoding='utf-8')
            (plugin / 'credentials.json').write_text('must stay private')
            def save():
                (plugin / 'package.json').write_text(json.dumps(manifest), encoding='utf-8')
            save()
            entry = publish(base / 'www', plugin, '1.0.0', 'Notify')
            self.assertEqual(entry['name'], 'Notify')
            self.assertEqual(entry['kind'], 'hooks')
            archive = base / 'www/magpie/plugins/dist' / (entry['bundle']['sha256'] + '.zip')
            with zipfile.ZipFile(archive) as bundle:
                self.assertEqual(set(bundle.namelist()), {'package.json', *manifest['files']})
            for unsafe in ['../outside.js', 'page/CON.js', 'page/APP.js', 'credentials.exe']:
                manifest['files'].append(unsafe)
                save()
                with self.assertRaises((ValueError, FileNotFoundError)):
                    publish(base / 'www', plugin, '1.0.1', 'Unsafe')
                manifest['files'].pop()
            manifest['magpie']['hooks'] = './missing.mjs'
            save()
            with self.assertRaisesRegex(ValueError, 'entry'):
                publish(base / 'www', plugin, '1.0.1', 'Incomplete')

    def test_publish_serve_and_refuse_changed_versions(self):
        with tempfile.TemporaryDirectory() as temp:
            base = pathlib.Path(temp)
            root, plugin = base / 'www', base / 'plugin'
            plugin.mkdir()
            (plugin / 'package.json').write_text(json.dumps({'name': '@internal/test', 'type': 'module', 'main': 'index.js', 'magpie': {'icon': 'kiro-color'}}))
            (plugin / 'index.js').write_text('export const plugin = async () => ({});')
            (plugin / 'credentials.json').write_text('must not publish')
            first = publish(root, plugin, '1.0.0', 'Test plugin')
            self.assertEqual(first['icon'], 'kiro-color')
            artifact = root / 'magpie/plugins/dist' / (first['bundle']['sha256'] + '.zip')
            self.assertEqual(hashlib.sha256(artifact.read_bytes()).hexdigest(), first['bundle']['sha256'])
            with zipfile.ZipFile(io.BytesIO(artifact.read_bytes())) as archive:
                self.assertEqual(set(archive.namelist()), {'package.json', 'index.js'})
            (plugin / 'index.js').write_text('export const plugin = async () => ({config: true});')
            publish(root, plugin, '1.0.1', 'Updated')
            snapshot = (root / 'magpie/plugins/registry.json').read_bytes()
            with self.assertRaisesRegex(ValueError, 'immutable'):
                publish(root, plugin, '1.0.0', 'Changed old version')
            self.assertEqual(snapshot, (root / 'magpie/plugins/registry.json').read_bytes())
            server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(root)))
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            try:
                base_url = f'http://127.0.0.1:{server.server_port}'
                for path in ['/healthz', '/magpie/plugins/registry.json', '/npm/@internal%2Ftest/latest']:
                    with urllib.request.urlopen(base_url + path, timeout=2) as response:
                        self.assertEqual(response.status, 200)
                        json.load(response)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
