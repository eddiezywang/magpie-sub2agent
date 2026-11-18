#!/usr/bin/env python3
"""Promote a signed release using the runtimes available on the intranet mirror."""
import base64
import functools
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

WINDOWS = 'magpie-windows-amd64.exe'
ASSETS = {WINDOWS, 'magpie-darwin-arm64.zip', 'magpie-darwin-amd64.zip'}
VERSION = re.compile(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?')
PUBLIC_KEY = bytes.fromhex('302a300506032b6570032100') + base64.b64decode(
    'vZLjKd13KX+3te66w3nBbJRkLGwd81sJNx3UgCrqJ9Y=')
MANIFEST_LIMIT = 1024 * 1024


def version_key(version):
    match = VERSION.fullmatch(version or '')
    if not match:
        raise ValueError('invalid release version')
    major, minor, patch, pre = match.groups()
    identifiers = [(0, int(part)) if part.isdigit() else (1, part) for part in pre.split('.')] if pre else []
    return int(major), int(minor), int(patch), not pre, identifiers


def verify_manifest(raw, scratch):
    if len(raw) > MANIFEST_LIMIT:
        raise ValueError('release manifest exceeds 1 MiB')
    release = json.loads(raw)
    version = release['version']
    version_key(version)
    assets = release['assets']
    if not isinstance(assets, dict) or not assets or set(assets) - ASSETS:
        raise ValueError('invalid release assets')
    for asset in assets.values():
        if (not re.fullmatch(r'[a-f0-9]{64}', asset['sha256'])
                or type(asset['size']) is not int or not 0 < asset['size'] < 2**53):
            raise ValueError('invalid release asset metadata')
    sums = ''.join(f"{asset['sha256']}  {name}\n" for name, asset in assets.items())
    signed = release['signed']
    if signed['sums'] != sums:
        raise ValueError('signed asset list differs from manifest')
    key, message, signature = (scratch / name for name in ('key.der', 'message', 'signature'))
    key.write_bytes(PUBLIC_KEY)
    message.write_bytes(f'magpie release {version}\n{sums}'.encode())
    signature.write_bytes(base64.b64decode(signed['sig'], validate=True))
    check = subprocess.run(
        ['openssl', 'pkeyutl', '-verify', '-pubin', '-keyform', 'DER', '-inkey', key,
         '-rawin', '-in', message, '-sigfile', signature],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
    )
    if check.returncode:
        raise ValueError('release signature invalid')
    return release


def verify_file(file, asset):
    with file.open('rb') as data:
        if (file.stat().st_size != asset['size']
                or hashlib.file_digest(data, 'sha256').hexdigest() != asset['sha256']):
            raise ValueError(f'asset checksum or size mismatch: {file.name}')


def download(source, netrc, cert, name, destination, max_size):
    subprocess.run(
        ['curl', '--disable', '--fail', '--silent', '--show-error', '--connect-timeout', '12',
         '--max-time', '600', '--max-filesize', str(max_size), '--netrc-file', netrc,
         '--cacert', cert, '--output', destination, source + name], check=True,
    )


def promote(root, fetch_file):
    latest = root / 'latest.json'
    with tempfile.TemporaryDirectory(prefix='.release-', dir=root) as work:
        stage = Path(work)
        candidate = stage / 'latest.json'
        fetch_file('latest.json', candidate, MANIFEST_LIMIT)
        raw = candidate.read_bytes()
        release = verify_manifest(raw, stage)
        version = release['version']
        previous = latest.read_bytes() if latest.exists() else None
        if previous is not None:
            current = verify_manifest(previous, stage)
            incoming_key, current_key = version_key(version), version_key(current['version'])
            if incoming_key < current_key:
                return f"Keeping {current['version']}; source has {version}"
            if incoming_key == current_key and raw != previous:
                raise ValueError('published version has a different manifest')
        dest = root / version
        dest.mkdir(exist_ok=True)
        for name, asset in release['assets'].items():
            target = dest / name
            if not target.exists():
                file = stage / name
                fetch_file(f"{version}/{name}", file, asset['size'])
                verify_file(file, asset)
                file.chmod(0o644)
                target.hardlink_to(file)
            else:
                verify_file(target, asset)
            if name == WINDOWS:
                branded = dest / 'Sub2Agent-windows-amd64.exe'
                if not branded.exists():
                    branded.hardlink_to(target)
                elif not branded.samefile(target):
                    verify_file(branded, asset)
        if raw == previous:
            return f'Verified {version}'
        if (latest.read_bytes() if latest.exists() else None) != previous:
            raise ValueError('current release changed during promotion')
        candidate.chmod(0o644)
        candidate.replace(latest)
        return f'Published {version}'


if __name__ == '__main__':
    root, source, *credentials = sys.argv[1:]
    if source.startswith('https://'):
        if not source.endswith('/') or len(credentials) != 2:
            raise SystemExit('an HTTPS base, netrc and CA files are required')
        fetch = functools.partial(download, source, *credentials)
    else:
        def fetch(name, destination, _):
            shutil.copyfile(Path(source) / name, destination)
    try:
        print(promote(Path(root), fetch))
    except (ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from None
