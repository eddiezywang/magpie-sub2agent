import { execFileSync } from 'node:child_process';
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyAsset, verifyManifest, versionPattern, windowsAsset } from './release.mjs';

function compareVersion(left, right) {
  const parse = value => {
    const [, major, minor, patch, pre] = versionPattern.exec(value);
    return [[major, minor, patch], pre?.split('.')];
  };
  const [a, ap] = parse(left);
  const [b, bp] = parse(right);
  const compare = (x, y) => Number(x > y) - Number(x < y);
  for (let i = 0; i < a.length; i++) {
    const order = compare(BigInt(a[i]), BigInt(b[i]));
    if (order) return order;
  }
  if (!ap || !bp) return compare(!ap, !bp);
  for (let i = 0; i < Math.min(ap.length, bp.length); i++) {
    const an = /^\d+$/.test(ap[i]);
    const bn = /^\d+$/.test(bp[i]);
    const order = an && bn ? compare(BigInt(ap[i]), BigInt(bp[i]))
      : an !== bn ? compare(bn, an) : compare(ap[i], bp[i]);
    if (order) return order;
  }
  return compare(ap.length, bp.length);
}

export async function promote(root, fetchFile, key) {
  const stage = await mkdtemp(path.join(root, '.release-'));
  try {
    const incoming = path.join(stage, 'latest.json');
    await fetchFile('latest.json', incoming, 1024 * 1024);
    const bytes = await readFile(incoming);
    const release = verifyManifest(bytes, key);
    const currentPath = path.join(root, 'latest.json');
    const currentBytes = await readFile(currentPath).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (currentBytes) {
      const current = verifyManifest(currentBytes, key);
      const order = compareVersion(release.version, current.version);
      if (order < 0) return `Keeping ${current.version}; source has ${release.version}`;
      if (!order && !bytes.equals(currentBytes)) throw Error('published version has a different manifest');
    }

    const dest = path.join(root, release.version);
    await mkdir(dest, { recursive: true });
    for (const [name, asset] of Object.entries(release.assets)) {
      const target = path.join(dest, name);
      try {
        await verifyAsset(target, asset);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const candidate = path.join(stage, name);
        await fetchFile(`${release.version}/${name}`, candidate, asset.size);
        await verifyAsset(candidate, asset);
        await chmod(candidate, 0o644);
        await link(candidate, target);
      }
      if (name === windowsAsset) {
        const branded = path.join(dest, 'Sub2Agent-windows-amd64.exe');
        try {
          await link(target, branded);
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          await verifyAsset(branded, asset);
        }
      }
    }
    if (currentBytes?.equals(bytes)) return `Verified ${release.version}`;
    // Refuse a conflicting change from an administrator using the legacy workflow.
    const previous = await readFile(currentPath).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (previous ? !currentBytes?.equals(previous) : currentBytes) throw Error('current release changed during promotion');
    await chmod(incoming, 0o644);
    await rename(incoming, currentPath);
    return `Published ${release.version}`;
  } finally {
    await rm(stage, { force: true, recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [root, source, credentials, ca] = process.argv.slice(2);
  if (!root || !source) throw Error('usage: promote.mjs <destination> <local-release | HTTPS-source> [netrc CA]');
  const download = source.startsWith('https://') ? (name, dest, limit) => {
    if (!credentials || !ca) throw Error('authenticated source requires netrc and CA files');
    const url = new URL(name, source);
    execFileSync('curl', ['--disable', '--fail', '--silent', '--show-error',
      '--connect-timeout', '12', '--max-time', '600', '--max-filesize', String(limit),
      '--netrc-file', credentials, '--cacert', ca, '--output', dest, url.href], { stdio: 'inherit' });
  } : (name, dest) => copyFile(path.join(source, name), dest);
  console.log(await promote(root, download));
}
