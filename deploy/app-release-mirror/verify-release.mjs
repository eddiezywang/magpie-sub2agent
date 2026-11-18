import path from 'node:path';
import { verifyRelease } from './release.mjs';

console.log(JSON.stringify(await verifyRelease(path.resolve(process.argv[2] || ''))));
