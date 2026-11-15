#!/usr/bin/env python3
"""Install a preverified release from a tar archive without overwriting versions."""
import hashlib, json, os, pathlib, sys, tarfile, tempfile
archive, root_arg, version, digest = sys.argv[1:]
root = pathlib.Path(root_arg).resolve(strict=True)
allowed = {'/opt/sub2agent-plugin-market/www/sub2agent/releases', '/var/www/sub2agent-update-8899/sub2agent/releases'}
if str(root) not in allowed or not __import__('re').fullmatch(r'[0-9A-Za-z][0-9A-Za-z.-]*', version) or not __import__('re').fullmatch(r'[a-f0-9]{64}', digest):
    raise SystemExit('invalid release destination or identifier')
name = 'magpie-windows-amd64.exe'
with tarfile.open(archive, 'r') as tar:
    info=tar.extractfile('latest.json'); obj=tar.extractfile('asset.exe')
    if info is None or obj is None: raise SystemExit('missing release data')
    manifest=info.read(1024*1024+1)
    if len(manifest)>1024*1024: raise SystemExit('manifest too large')
    parsed=json.loads(manifest)
    if parsed['version'] != version or parsed['assets'][name]['sha256'] != digest: raise SystemExit('manifest mismatch')
    dest_dir=root/version; dest_dir.mkdir(mode=0o755,exist_ok=True)
    dest=dest_dir/name
    fd,tmp=tempfile.mkstemp(prefix='.asset-', dir=dest_dir)
    try:
        h=hashlib.sha256(); size=0
        with os.fdopen(fd,'wb') as out:
            while True:
                b=obj.read(1024*1024)
                if not b: break
                out.write(b);h.update(b);size+=len(b)
            out.flush(); os.fsync(out.fileno())
        if h.hexdigest()!=digest or size!=parsed['assets'][name]['size']: raise SystemExit('asset checksum mismatch')
        if dest.exists():
            with dest.open('rb') as old:
                existing=hashlib.file_digest(old,'sha256').hexdigest()
            if existing!=digest: raise SystemExit('existing release has different content')
            os.unlink(tmp)
        else:
            os.chmod(tmp,0o644);os.replace(tmp,dest)
        fd,manifest_tmp=tempfile.mkstemp(prefix='.latest-',dir=root)
        with os.fdopen(fd,'wb') as out: out.write(manifest);out.flush();os.fsync(out.fileno())
        os.chmod(manifest_tmp,0o644);os.replace(manifest_tmp,root/'latest.json')
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
print('RELEASE_APPLIED',version,digest)
