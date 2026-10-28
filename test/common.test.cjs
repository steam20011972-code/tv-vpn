const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('fs'),
  os = require('os'),
  path = require('path');
process.env.TVVPN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tvvpn-common-'));
const C = require('../runtime/common.cjs');
const node = (code, timeout) => C.verdict(process.execPath, ['-e', code], timeout);

// supervisor.cjs runs sing-box check through verdict: a refusal is a bad profile and turns VPN off, no answer is
// retried. On 2026-10-28 the check got no answer within 4 s right after a reboot and VPN stayed off.
test('verdict: exit 0 passes, another exit code refuses, no answer in time rejects', async () => {
  assert.equal(await node('process.exit(0)'), true);
  assert.equal(await node('process.exit(1)'), false);
  await assert.rejects(node('setTimeout(() => {}, 10000)', 300), /gave no answer/);
  await assert.rejects(C.verdict(path.join(process.env.TVVPN_HOME, 'missing'), []), /gave no answer/);
});
test('verdict does not block the event loop while it waits', async () => {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 50);
  try {
    assert.equal(await node('setTimeout(() => process.exit(0), 600)'), true);
  } finally {
    clearInterval(timer);
  }
  assert.ok(ticks >= 5, String(ticks));
});
