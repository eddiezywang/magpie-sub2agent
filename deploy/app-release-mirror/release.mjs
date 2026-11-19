import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
export const windowsAsset = 'magpie-windows-amd64.exe';
const assets = new Set([windowsAsset, 'magpie-darwin-arm64.zip', 'magpie-darwin-amd64.zip']);
const publicKey = createPublicKey({
  key: Buffer.from('302a300506032b6570032100' + Buffer.from('vZLjKd13KX+3te66w3nBbJRkLGwd81sJNx3UgCrqJ9Y=', 'base64').toString('hex'), 'hex'),
  format: 'der',
  type: 'spki',
});

export function verifyManifest(bytes, key = publicKey) {
  if (bytes.length > 1024 * 1024) throw Error('release manifest exceeds 1 MiB');
  const data = JSON.parse(bytes);
  const { version, signed } = data;
  const entries = Object.entries(data.assets ?? {});
  if (!versionPattern.test(version ?? '') || !entries.length) throw Error('invalid release manifest');
  for (const [name, asset] of entries) {
    if (!assets.has(name) || !/^[0-9a-f]{64}$/.test(asset?.sha256 ?? '') ||
        !Number.isSafeInteger(asset.size) || asset.size < 1) throw Error('invalid release asset');
  }
  const sums = entries.map(([name, info]) => `${info.sha256}  ${name}\n`).join('');
  if (sums !== signed?.sums ||
      !verify(null, Buffer.from(`magpie release ${version}\n${sums}`), key, Buffer.from(signed?.sig ?? '', 'base64'))) {
    throw Error('release signature invalid');
  }
  return data;
}

export async function verifyAsset(file, asset) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    size += chunk.length;
    if (size > asset.size) throw Error('asset size invalid: ' + path.basename(file));
    hash.update(chunk);
  }
  const sha256 = hash.digest('hex');
  if (size !== asset.size || sha256 !== asset.sha256) throw Error('size or checksum invalid: ' + path.basename(file));
  return { file, size, sha256 };
}

export async function verifyRelease(dir) {
  const data = verifyManifest(await readFile(path.join(dir, 'latest.json')));
  const files = [];
  for (const [name, asset] of Object.entries(data.assets)) {
    files.push({ name, ...await verifyAsset(path.join(dir, data.version, name), asset) });
  }
  return { version: data.version, files };
}
