#!/usr/bin/env python3
"""Back up application code, retain production data, and verify both listeners."""
import datetime
import json
import pathlib
import shutil
import subprocess
import time
import urllib.request

release = pathlib.Path(__file__).resolve().parent
root = pathlib.Path('/opt/usage-server')
assert root.resolve() == root and root.is_dir()
subprocess.run(['node', '--test', 'test/summary.test.js'], cwd=release, check=True)
listeners = subprocess.check_output(['ss', '-lnt'], text=True)
if any(line.split()[3].endswith(':17890') for line in listeners.splitlines()[1:] if len(line.split()) > 3):
    raise SystemExit('Legacy port already has a listener; inspect it first.')
backup = root / 'releases' / datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
backup.mkdir(parents=True)
shutil.copytree(root / 'src', backup / 'src')
shutil.copy2(root / 'package.json', backup / 'package.json')
shutil.copytree(release / 'src', root / 'src.next')
(root / 'src').replace(backup / 'active-src')
(root / 'src.next').replace(root / 'src')
shutil.copy2(release / 'package.json', root / 'package.json')
dropin = pathlib.Path('/etc/systemd/system/usage-server.service.d/sub2agent-alias.conf')
dropin.parent.mkdir(parents=True, exist_ok=True)
assert not dropin.exists(), 'Existing alias configuration must be reviewed first'
dropin.write_text('[Service]\nEnvironment=USAGE_SERVER_ALIAS_PORT=17890\n')
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'restart', 'usage-server'], check=True)
ok = False
for _ in range(15):
    try:
        with urllib.request.urlopen('http://127.0.0.1:17890/healthz', timeout=2) as response:
            ok = 'sub2agent-usage/3' in json.load(response)['usage_schemas']
        if ok:
            break
    except (OSError, ValueError, KeyError):
        pass
    time.sleep(1)
if not ok:
    subprocess.run(['systemctl', 'stop', 'usage-server'], check=True)
    (root / 'src').replace(backup / 'failed-src')
    (backup / 'active-src').replace(root / 'src')
    shutil.copy2(backup / 'package.json', root / 'package.json')
    dropin.unlink()
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'start', 'usage-server'], check=True)
    raise SystemExit('Health verification failed; original application restored.')
with urllib.request.urlopen('http://127.0.0.1:17891/healthz', timeout=3) as response:
    print(json.load(response))
print('DEPLOY_OK backup=' + str(backup))
