#!/usr/bin/env python3
"""Publish an already bundled index.js; never resolves or downloads dependencies."""
import argparse
import hashlib
import io
import json
import os
import pathlib
import re
import tempfile
import zipfile


def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.publish-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
        os.chmod(temp, 0o644)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def encoded(data):
    return (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def safe_path(name):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*', name):
        return False
    for part in name.split('/'):
        base = part.split('.')[0].upper()
        if part in ['.', '..'] or part.endswith('.') or part.startswith('.internal-'):
            return False
        if base in ['CON', 'PRN', 'AUX', 'NUL'] or re.fullmatch(r'(COM|LPT)[0-9]', base):
            return False
    return True


def publish(root, plugin, version, summary):
    root = pathlib.Path(root).resolve()
    plugin = pathlib.Path(plugin).resolve(strict=True)
    manifest = json.loads((plugin / 'package.json').read_text('utf-8'))
    name = manifest['name']
    if not re.fullmatch(r'(?:@[a-z0-9._-]+/)?[a-z0-9][a-z0-9._-]*', name):
        raise ValueError('invalid package name')
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?', version):
        raise ValueError('an exact semantic version is required')
    if any(manifest.get(key) for key in ['dependencies', 'optionalDependencies', 'peerDependencies', 'scripts']):
        raise ValueError('bundle dependencies first; remove package scripts before publication')
    if manifest.get('type') != 'module':
        raise ValueError('offline bundles must use type: module')
    manifest['version'] = version
    files = {'package.json': encoded(manifest)}
    if manifest.get('sub2agentBundle') == 2:
        names = manifest.get('files', [])
        if not isinstance(names, list) or not names or len(names) > 127:
            raise ValueError('declare an exact, bounded files list')
        entries = [manifest.get('main'), manifest.get('magpie', {}).get('hooks'),
                   manifest.get('magpie', {}).get('page', {}).get('file')]
        entries = [entry.removeprefix('./') for entry in entries if entry]
        if not entries or any(entry not in names for entry in entries):
            raise ValueError('declared entry is missing from files')
    else:
        if manifest.get('main') != 'index.js' or manifest.get('sub2agentBundle', 1) != 1:
            raise ValueError('complete ESM bundle must use main: index.js')
        names = ['index.js'] + [name for name in ['README.md', 'LICENSE'] if (plugin / name).is_file()]
    seen = {'package.json'}
    for filename in names:
        if not isinstance(filename, str) or not safe_path(filename) or filename.lower() in seen:
            raise ValueError('unsafe or duplicate bundle path')
        seen.add(filename.lower())
        if filename not in ['README.md', 'LICENSE', 'NOTICE'] and pathlib.PurePosixPath(filename).suffix.lower() not in ['.json', '.js', '.mjs', '.html', '.css', '.svg']:
            raise ValueError('unsupported bundle file type')
        source = plugin / filename
        if source.is_symlink() or any(parent.is_symlink() for parent in source.parents if parent != plugin.parent):
            raise ValueError('bundle links are forbidden')
        resolved = source.resolve(strict=True)
        if not resolved.is_relative_to(plugin) or not resolved.is_file():
            raise ValueError('bundle file escaped package')
        files[filename] = resolved.read_bytes()
    if sum(map(len, files.values())) > 32 << 20:
        raise ValueError('bundle exceeds 32 MiB')
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        for filename, data in files.items():
            info = zipfile.ZipInfo(filename, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    data = buffer.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    catalog_path = root / 'magpie/plugins/registry.json'
    root.mkdir(parents=True, exist_ok=True)
    lock = root / '.publish-lock'
    lock.mkdir()  # refuse concurrent publication rather than losing entries
    try:
        catalog = json.loads(catalog_path.read_text('utf-8')) if catalog_path.exists() else {'version': 1, 'plugins': []}
        artifact = {'version': version, 'url': f'http://172.21.0.177/magpie/plugins/dist/{digest}.zip', 'sha256': digest, 'bytes': len(data)}
        entry = {'package': name, 'name': manifest.get('magpie', {}).get('name', name), 'summary': {'zh': summary, 'en': manifest.get('description', summary)}, 'bundle': artifact}
        same = next((item for item in catalog['plugins'] if item['package'] == name), None)
        published_version = root / 'npm' / name / version
        if published_version.exists() and json.loads(published_version.read_text('utf-8'))['dist']['sha256'] != digest:
            raise ValueError('published version is immutable: use a new version')
        if same and same.get('bundle', {}).get('version') == version and same.get('bundle', {}).get('sha256') != digest:
            raise ValueError('published version is immutable: use a new version')
        if catalog_path.exists():
            atomic(root / 'magpie/plugins/registry.previous.json', catalog_path.read_bytes())
        atomic(root / f'magpie/plugins/dist/{digest}.zip', data)
        metadata = {**manifest, 'description': summary, 'dist': {'tarball': artifact['url'], 'sha256': digest}}
        atomic(root / 'npm' / name / version, encoded(metadata))
        atomic(root / 'npm' / name / 'latest', encoded(metadata))
        catalog['plugins'] = [item for item in catalog['plugins'] if item['package'] != name] + [entry]
        atomic(catalog_path, encoded(catalog))  # final publication point
    finally:
        lock.rmdir()
    return entry


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--plugin', required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--summary', required=True)
    args = parser.parse_args()
    result = publish(args.root, args.plugin, args.version, args.summary)
    print(json.dumps({'package': result['package'], **result['bundle']}, ensure_ascii=False))
