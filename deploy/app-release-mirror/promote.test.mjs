import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promote } from './promote.mjs';
import { windowsAsset } from './release.mjs';

test('promotes only complete and signed releases, keeps older files and refuses downgrades', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sub2agent-release-test-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const content = Buffer.from('signed executable');
  const sha256 = createHash('sha256').update(content).digest('hex');
  const sums = `${sha256}  ${windowsAsset}\n`;
  function fetcher(version, binary = content, valid = true) {
    const sig = sign(null, Buffer.from(`magpie release ${version}\n${sums}`), privateKey);
    if (!valid) sig[0] ^= 1;
    const manifest = { version, assets: { [windowsAsset]: { sha256, size: content.length } },
      signed: { sums, sig: sig.toString('base64') } };
    return (name, file) => writeFile(file, name === 'latest.json' ? JSON.stringify(manifest) : binary);
  }
  const latest = () => readFile(path.join(root, 'latest.json'), 'utf8');
  try {
    await promote(root, fetcher('1.0.0-beta.9'), publicKey);
    const previous = await latest();
    await assert.rejects(promote(root, fetcher('1.0.0-beta.10', content, false), publicKey), /signature invalid/);
    await assert.rejects(promote(root, fetcher('1.0.0-beta.10', Buffer.from('bad executable')), publicKey), /checksum invalid/);
    assert.equal(await latest(), previous);
    await promote(root, fetcher('1.0.0-beta.10'), publicKey);
    assert.equal(JSON.parse(await latest()).version, '1.0.0-beta.10');
    assert.match(await promote(root, fetcher('1.0.0-beta.9'), publicKey), /Keeping/);
    assert.deepEqual(await readFile(path.join(root, '1.0.0-beta.9', windowsAsset)), content);
    assert.deepEqual(await readFile(path.join(root, '1.0.0-beta.10', 'Sub2Agent-windows-amd64.exe')), content);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
