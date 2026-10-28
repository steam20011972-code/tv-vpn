const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('fs'),
  path = require('path');
const K = require('../app/commands.js');
const app = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8'),
  services = require('../service/services.json'),
  info = require('../app/appinfo.json');

test('Homebrew Channel exec gets one fixed command: elevate-service for the app service', () => {
  assert.equal(K.SERVICE, info.id + '.service');
  assert.equal(K.SERVICE, services.id);
  assert.equal(
    K.ELEVATE,
    '/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service ' +
      'io.github.steam20011972code.tvvpn.service'
  );
  assert.deepEqual(Object.keys(K).sort(), ['ELEVATE', 'SERVICE']);
  // The app names exec once and hands it only that constant.
  assert.equal(app.split('hbchannel.service/exec').length, 2);
  assert.match(
    app,
    /'luna:\/\/org\.webosbrew\.hbchannel\.service\/exec',\s*\{ command: window\.TVCommands\.ELEVATE \}/
  );
  assert.doesNotMatch(app, /stdoutString/);
});

test('the app calls only methods the service offers', () => {
  const offered = services.services[0].commands.map((c) => c.name),
    used = new Set();
  for (const m of app.matchAll(/\b(?:call|luna)\('(\w+)'/g)) used.add(m[1]);
  // start and stop are picked by a ternary; the other 15 are named.
  assert.ok(used.size >= 15, 'found ' + [...used]);
  assert.match(app, /\? 'stop' : 'start'/);
  for (const m of used) assert.ok(offered.includes(m), m);
  // No action names of the old shell commands are left.
  assert.doesNotMatch(app, /call\('[a-z]+-[a-z-]+'/);
});
