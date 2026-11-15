#!/usr/bin/env python3
"""Install a preverified multi-platform release without overwriting versions."""
import hashlib, json, os, pathlib, re, sys, tarfile, tempfile
archive, root_arg, version, manifest_sha = sys.argv[1:]
root = pathlib.Path(root_arg).resolve(strict=True)
allowed_roots = {'/opt/sub2agent-plugin-market/www/sub2agent/releases', '/var/www/sub2agent-update-8899/sub2agent/releases'}
allowed_names = {'magpie-windows-amd64.exe', 'magpie-darwin-arm64.zip', 'magpie-darwin-amd64.zip'}
if str(root) not in allowed_roots or not re.fullmatch(r'[0-9A-Za-z][0-9A-Za-z.-]*',version) or not re.fullmatch(r'[a-f0-9]{64}',manifest_sha): raise SystemExit('invalid release destination or identifier')
with tarfile.open(archive,'r') as tar:
    manifest=tar.extractfile('latest.json').read(1024*1024+1)
    if len(manifest)>1024*1024 or hashlib.sha256(manifest).hexdigest()!=manifest_sha: raise SystemExit('manifest checksum mismatch')
    parsed=json.loads(manifest); assets=parsed.get('assets',{})
    if parsed.get('version')!=version or not assets or not set(assets).issubset(allowed_names): raise SystemExit('manifest mismatch')
    dest_dir=root/version; dest_dir.mkdir(mode=0o755,exist_ok=True)
    for name,meta in assets.items():
        digest=meta['sha256']
        if not re.fullmatch(r'[a-f0-9]{64}',digest): raise SystemExit('invalid digest')
        src=tar.extractfile('assets/'+name)
        if src is None: raise SystemExit('missing asset '+name)
        fd,tmp=tempfile.mkstemp(prefix='.asset-',dir=dest_dir)
        try:
            h=hashlib.sha256();size=0
            with os.fdopen(fd,'wb') as out:
                while True:
                    b=src.read(1024*1024)
                    if not b: break
                    out.write(b);h.update(b);size+=len(b)
                out.flush();os.fsync(out.fileno())
            if h.hexdigest()!=digest or size!=meta['size']: raise SystemExit('asset checksum mismatch: '+name)
            dest=dest_dir/name
            if dest.exists():
                with dest.open('rb') as old: existing=hashlib.file_digest(old,'sha256').hexdigest()
                if existing!=digest: raise SystemExit('existing release differs: '+name)
                os.unlink(tmp)
            else: os.chmod(tmp,0o644);os.replace(tmp,dest)
        finally:
            if os.path.exists(tmp):os.unlink(tmp)
    fd,tmp=tempfile.mkstemp(prefix='.latest-',dir=root)
    try:
        with os.fdopen(fd,'wb') as out:out.write(manifest);out.flush();os.fsync(out.fileno())
        os.chmod(tmp,0o644);os.replace(tmp,root/'latest.json')
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
print('RELEASE_APPLIED',version,manifest_sha)
