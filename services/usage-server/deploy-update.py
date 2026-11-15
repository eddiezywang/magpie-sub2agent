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
dropin = pathlib.Path('/etc/systemd/system/usage-server.service.d/sub2agent-alias.conf')
expected = '[Service]\nEnvironment=USAGE_SERVER_ALIAS_PORT=17890\n'
previous = dropin.read_text() if dropin.exists() else None
if previous is not None and previous != expected:
    raise SystemExit('Unexpected alias configuration; inspect it first.')
if any(line.split()[3].endswith(':17890') for line in listeners.splitlines()[1:] if len(line.split()) > 3):
    pid = subprocess.check_output(['systemctl', 'show', 'usage-server', '--property=MainPID'], text=True).strip().partition('=')[2]
    owners = subprocess.check_output(['ss', '-lntp', 'sport = :17890'], text=True)
    if previous != expected or pid == '0' or ('pid=' + pid + ',') not in owners:
        raise SystemExit('Legacy port belongs to an unverified listener; inspect it first.')
backup = root / 'releases' / datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
backup.mkdir(parents=True)
shutil.copytree(root / 'src', backup / 'src')
shutil.copy2(root / 'package.json', backup / 'package.json')
shutil.copytree(release / 'src', root / 'src.next')
(root / 'src').replace(backup / 'active-src')
(root / 'src.next').replace(root / 'src')
shutil.copy2(release / 'package.json', root / 'package.json')
dropin.parent.mkdir(parents=True, exist_ok=True)
if previous is not None:
    (backup / 'alias.conf').write_text(previous)
dropin.write_text(expected)
subprocess.run(['systemctl', 'daemon-reload'], check=True)
restarted = subprocess.run(['systemctl', 'restart', 'usage-server']).returncode == 0
ok = False
for _ in range(15 if restarted else 0):
    try:
        health = []
        for port in (17890, 17891):
            with urllib.request.urlopen('http://127.0.0.1:' + str(port) + '/healthz', timeout=2) as response:
                health.append('sub2agent-usage/3' in json.load(response)['usage_schemas'])
        ok = all(health)
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
    if previous is None:
        dropin.unlink()
    else:
        dropin.write_text(previous)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'start', 'usage-server'], check=True)
    raise SystemExit('Health verification failed; original application restored.')
with urllib.request.urlopen('http://127.0.0.1:17891/healthz', timeout=3) as response:
    print(json.load(response))
print('DEPLOY_OK backup=' + str(backup))
