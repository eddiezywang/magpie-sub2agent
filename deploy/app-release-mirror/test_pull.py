import base64
import hashlib
import importlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

release = importlib.import_module('pull-release')


@unittest.skipUnless(shutil.which('openssl'), 'OpenSSL 3 is required')
class PullTests(unittest.TestCase):
    def test_promotion_checks_integrity_and_keeps_previous_version(self):
        with tempfile.TemporaryDirectory() as work:
            scratch = Path(work)
            key = scratch / 'key'
            root = scratch / 'published'
            root.mkdir()
            subprocess.run(['openssl', 'genpkey', '-algorithm', 'ED25519', '-out', key], check=True)
            public = subprocess.check_output(['openssl', 'pkey', '-in', key, '-pubout', '-outform', 'DER'])
            binary = b'signed executable'
            digest = hashlib.sha256(binary).hexdigest()
            sums = f'{digest}  {release.WINDOWS}\n'

            def source(version, data=binary, valid=True):
                payload = scratch / 'payload'
                payload.write_text(f'magpie release {version}\n{sums}', encoding='ascii')
                signature = subprocess.check_output(
                    ['openssl', 'pkeyutl', '-sign', '-rawin', '-inkey', key, '-in', payload])
                if not valid:
                    signature = b'\x00' * len(signature)
                manifest = {'version': version, 'assets': {release.WINDOWS: {
                    'sha256': digest, 'size': len(binary)}},
                    'signed': {'sums': sums, 'sig': base64.b64encode(signature).decode()}}
                return lambda name, dest, _: dest.write_bytes(
                    json.dumps(manifest).encode() if name == 'latest.json' else data)

            old, new = '1.0.0-beta.9', '1.0.0-beta.10'
            with patch.object(release, 'PUBLIC_KEY', public):
                release.promote(root, source(old))
                latest = root / 'latest.json'
                previous = latest.read_bytes()
                with self.assertRaisesRegex(ValueError, 'signature invalid'):
                    release.promote(root, source(new, valid=False))
                with self.assertRaisesRegex(ValueError, 'checksum or size mismatch'):
                    release.promote(root, source(new, b'corrupt asset'))
                self.assertEqual(latest.read_bytes(), previous)
                release.promote(root, source(new))
                self.assertEqual(json.loads(latest.read_bytes())['version'], new)
                self.assertIn('Keeping', release.promote(root, source(old)))
                self.assertEqual((root / old / release.WINDOWS).read_bytes(), binary)
                self.assertEqual((root / new / 'Sub2Agent-windows-amd64.exe').read_bytes(), binary)
