import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {adaptWorkBuddySource} from './workbuddy-community-source.mjs';

const source = await readFile(new URL('../../.build-tools/community-plugins/packages/workbuddy/index.mjs', import.meta.url), 'utf8');

test('pinned community adaptation shares rules and fails closed on changed source seams', () => {
  const adapted = adaptWorkBuddySource(source);
  assert.match(adapted, /from 'sub2agent\/core\/workbuddy-prompt-compat'/);
  assert.doesNotMatch(adapted, /\[\/x-anthropic-billing-header/);
  assert.doesNotMatch(adapted, /if \(moved\) \{\s*refusedSystems.add/);
  for (const seam of ['function unflagged(text)', 'async function liveModels(site, a)', 'const FLAGGED = [', 'if (res.status === 400 && !native) {']) {
    assert.throws(() => adaptWorkBuddySource(source.replace(seam, 'CHANGED')), /seam changed/);
  }
});
