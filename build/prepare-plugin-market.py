#!/usr/bin/env python3
"""Build an offline publication tree; no server changes or credential reads."""
import argparse
import importlib.util
import json
import pathlib
import shutil
import subprocess

PIN = 'e90d6f011a7320372c5570600e9b267f75b34714'

def prepare(repo, community, output):
    if subprocess.check_output(['git', '-C', str(community), 'rev-parse', 'HEAD'], text=True).strip() != PIN:
        raise ValueError('community source must match the reviewed commit ' + PIN)
    publisher = repo / 'deploy/plugin-market/publish.py'
    spec = importlib.util.spec_from_file_location('market_publish', publisher)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    output.mkdir(parents=True, exist_ok=True)
    www = output / 'www'
    staging = output / 'staging'
    for kind in ['workbuddy', 'aiep', 'codebuddy', 'trae', 'native-api', 'community-antigravity', 'community-commandcode', 'community-cursor', 'community-devin', 'community-factory', 'community-grok', 'community-kiro', 'community-mimo', 'community-qoder', 'community-workbuddy', 'community-zcode', 'community-zed']:
        plugin = repo / 'build/sub2agent-runtime' / kind
        manifest = json.loads((plugin / 'package.json').read_text('utf-8'))
        module.publish(www, plugin, manifest['version'], manifest['magpie']['name'])
        shutil.copytree(plugin, staging / kind, dirs_exist_ok=True)
    upstream = community / 'packages/notify'
    target = staging / 'notify'
    target.mkdir(parents=True, exist_ok=True)
    names = ['notify.hooks.mjs', 'turn.mjs', 'channels.mjs', 'README.md']
    names += [path.relative_to(upstream).as_posix() for path in sorted((upstream / 'page').rglob('*')) if path.is_file()]
    for name in names:
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(upstream / name, destination)
    shutil.copyfile(community / 'LICENSE', target / 'LICENSE')
    (target / 'NOTICE').write_text('Source: https://github.com/magpie-community/plugins\nCommit: ' + PIN + '\nPackage: packages/notify\nLicense: MIT; see LICENSE.\n', encoding='utf-8')
    manifest = json.loads((upstream / 'package.json').read_text('utf-8'))
    manifest['sub2agentBundle'] = 2
    manifest['files'] = names + ['LICENSE', 'NOTICE']
    # Keep the reviewed upstream code; notification destinations remain unset.
    manifest['magpie']['options']['channels'] = []
    manifest['magpie']['options']['includeText'] = False
    manifest['magpie']['options']['lang'] = 'zh'
    (target / 'package.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    module.publish(www, target, manifest['version'], '任务完成、失败和重新登录提醒；需配置内部通知渠道')
    shutil.copytree(repo / 'deploy/plugin-market', output / 'service', ignore=shutil.ignore_patterns('__pycache__'), dirs_exist_ok=True)
    (output / 'provenance.json').write_text(json.dumps({'communityCommit': PIN, 'packages': 18, 'privateProviders': 'generated locally; do not publish this tree publicly'}, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(output), 'packages': 18, 'notifyVersion': manifest['version']}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--community', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    prepare(pathlib.Path(__file__).resolve().parent.parent, args.community.resolve(), args.output.resolve())
