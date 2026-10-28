const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('fs'),
  os = require('os'),
  path = require('path'),
  cp = require('child_process'),
  Module = require('module');
const app = require('../app/appinfo.json');
const posix = process.platform !== 'win32';
// The service staged as tools/build.cjs packages it and laid out as installed: usr/palm/services/<id>.service beside
// usr/palm/applications/<id>, where it finds the app.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tvvpn-service-')),
  serviceDir = path.join(tmp, 'usr/palm/services', app.id + '.service'),
  appDir = path.join(tmp, 'usr/palm/applications', app.id);
fs.mkdirSync(serviceDir, { recursive: true });
fs.cpSync('service', serviceDir, { recursive: true });
fs.copyFileSync('runtime/secure-app.cjs', serviceDir + '/secure-app.cjs');
fs.mkdirSync(appDir + '/runtime', { recursive: true });
fs.writeFileSync(appDir + '/appinfo.json', '{}');
fs.writeFileSync(appDir + '/runtime/setup.cjs', '');
// Stand-in for the system webos-service: records the service name and the registered methods. The service asks for
// it by absolute path only; a bare require('webos-service') would not find it here and the require below would fail.
const stub = path.join(tmp, 'webos-service.cjs');
fs.writeFileSync(
  stub,
  'const registry = { name: null, methods: {} };\n' +
    'module.exports = class Service {\n' +
    '  constructor(name) { registry.name = name; }\n' +
    '  register(method, fn) { registry.methods[method] = fn; }\n' +
    '};\n' +
    'module.exports.registry = registry;\n'
);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === '/usr/lib/node_modules/webos-service' ? stub : resolve.call(this, request, ...rest);
};
const S = require(path.join(serviceDir, 'service.js')),
  { registry } = require(stub);
Module._resolveFilename = resolve;
// After a not-elevated answer the service leaves; here it only counts.
let quits = 0;
S.life.quit = () => quits++;

const PLANNED = [
  'status',
  'start',
  'stop',
  'restoreNetwork',
  'setAutostart',
  'profiles',
  'select',
  'delete',
  'importBegin',
  'importStatus',
  'importEnd',
  'importUsb',
  'refreshSubscription',
  'diagnostics',
  'setupStatus',
  'setupInstall',
  'setupUninstall',
];
const VALID = {
  setAutostart: { enabled: true },
  select: { id: 'abcd1234' },
  delete: { id: 'abcd1234' },
  refreshSubscription: { id: 'sub0000001' },
  setupUninstall: { deleteProfile: false },
};
const owner = process.getuid ? process.getuid() : 0;
// BASE with an installed runtime; setup.cjs carries the marker of a copy that takes --app.
function base(marker = true) {
  const dir = fs.mkdtempSync(path.join(tmp, 'base-'));
  fs.mkdirSync(dir + '/runtime');
  fs.writeFileSync(dir + '/runtime/ctl.cjs', '');
  fs.writeFileSync(dir + '/runtime/setup.cjs', marker ? '// setup:app-option\n' : '// 0.6.1\n');
  return dir;
}
// execFile stand-in: records each call and answers with reply(args), or holds the answer when hold is set.
function runner(reply = () => '{"ok":true}\n', hold = false) {
  const calls = [];
  const execFile = (file, args, options, cb) => {
    calls.push({ file, args, options, answer: (out) => cb(null, out, '') });
    if (!hold) setImmediate(() => cb(null, reply(args), ''));
  };
  return { calls, execFile };
}
const elevated = (r, extra) => Object.assign({ uid: 0, owner, base: base(), execFile: r.execFile }, extra);
const tick = () => new Promise((r) => setImmediate(r));
// A registered method called the way the bus does, with what it answers.
function callRegistered(method, sender, payload) {
  return new Promise((done) => registry.methods[method]({ sender, payload, respond: done }));
}

test('the service id has no hyphen, matches the app id and offers exactly the planned methods', () => {
  // Luna refuses service names with "-" (stage 10): the reason the app id changed.
  assert.equal(S.APP_ID, app.id);
  assert.equal(S.SERVICE_ID, app.id + '.service');
  assert.match(S.SERVICE_ID, /^[a-z0-9]+(\.[a-z0-9]+)+$/);
  assert.equal(registry.name, S.SERVICE_ID);
  assert.deepEqual(S.METHODS.slice().sort(), PLANNED.slice().sort());
  assert.deepEqual(Object.keys(registry.methods).sort(), PLANNED.slice().sort());
  const services = require('../service/services.json'),
    pkg = require('../service/package.json');
  assert.equal(services.id, S.SERVICE_ID);
  assert.equal(services.services[0].name, S.SERVICE_ID);
  assert.deepEqual(services.services[0].commands.map((c) => c.name).sort(), PLANNED.slice().sort());
  assert.equal(pkg.name, S.SERVICE_ID);
  assert.equal(pkg.main, 'service.js');
  assert.equal(pkg.version, app.version);
});

test('any caller but the app gets forbidden, before anything else is looked at, and nothing runs', async () => {
  const r = runner(),
    real = cp.execFile;
  cp.execFile = r.execFile;
  try {
    for (const sender of [
      'io.github.steam20011972code.tvvpnother',
      'io.github.steam20011972-code.tvvpn',
      app.id + '-1860',
      'com.webos.lunasend-4242',
      '',
      undefined,
      null,
    ]) {
      for (const method of PLANNED) {
        assert.deepEqual(await S.handle(method, sender, VALID[method], elevated(r)), {
          ok: false,
          error: 'forbidden',
        });
        assert.deepEqual(await callRegistered(method, sender, VALID[method]), {
          ok: false,
          error: 'forbidden',
          returnValue: false,
        });
      }
      assert.deepEqual(await S.handle('exec', sender, {}, elevated(r)), { ok: false, error: 'forbidden' });
    }
  } finally {
    cp.execFile = real;
  }
  assert.equal(r.calls.length, 0);
});

test('not running as root (not elevated yet, or reset by an update): not-elevated, and nothing runs', async () => {
  const r = runner(),
    real = cp.execFile;
  cp.execFile = r.execFile;
  try {
    for (const method of PLANNED) {
      assert.deepEqual(await S.handle(method, app.id, VALID[method], elevated(r, { uid: 5312 })), {
        ok: false,
        error: 'not-elevated',
      });
      // The registered methods use the real uid: this test process is not root.
      if (!(process.getuid && process.getuid() === 0))
        assert.deepEqual(await callRegistered(method, app.id, VALID[method]), {
          ok: false,
          error: 'not-elevated',
          returnValue: false,
        });
    }
  } finally {
    cp.execFile = real;
  }
  assert.equal(r.calls.length, 0);
});

test('after not-elevated the registered method answers and the service leaves; not after other answers', async () => {
  if (process.getuid && process.getuid() === 0) return;
  // Earlier tests' not-elevated answers have left by now.
  await new Promise((r) => setTimeout(r, 200));
  const before = quits;
  await callRegistered('status', 'io.github.steam20011972code.tvvpnother', {});
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(quits, before);
  assert.deepEqual(await callRegistered('setupStatus', app.id, {}), {
    ok: false,
    error: 'not-elevated',
    returnValue: false,
  });
  // It answers first, then leaves.
  assert.equal(quits, before);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(quits, before + 1);
});

test('arguments: only the fixed values pass; other payload fields never reach the command line', async () => {
  const r = runner();
  for (const [method, payload] of [
    ['setAutostart', {}],
    ['setAutostart', { enabled: 'on' }],
    ['setAutostart', { enabled: 1 }],
    ['select', {}],
    ['select', null],
    ['select', { id: 'ABCDEFGH' }],
    ['select', { id: 'abc;reboot' }],
    ['select', { id: 'abcd123' }],
    ['select', { id: '$(id)abcd' }],
    ['delete', { id: 'a'.repeat(17) }],
    ['delete', { id: ['abcd1234'] }],
    ['refreshSubscription', { id: 'abcd1234 x' }],
    ['setupUninstall', {}],
    ['setupUninstall', { deleteProfile: 'delete-profile' }],
    ['exec', { command: 'id' }],
    ['set-autostart', { enabled: true }],
    ['constructor', {}],
    ['__proto__', {}],
    ['hasOwnProperty', {}],
  ])
    assert.deepEqual(
      await S.handle(method, app.id, payload, elevated(r)),
      { ok: false, error: 'invalid-action' },
      method + ' ' + JSON.stringify(payload)
    );
  assert.equal(r.calls.length, 0);
  const o = elevated(r);
  await S.handle('status', app.id, { id: 'abcd1234', enabled: true, command: 'reboot', arg: '--app' }, o);
  assert.deepEqual(r.calls[0].args, [path.join(o.base, 'runtime', 'ctl.cjs'), 'status']);
});

test('every method runs /usr/bin/node with an argument array, never through a shell', async () => {
  const r = runner((args) => JSON.stringify({ ok: true, ran: args[1] }) + '\n'),
    o = elevated(r),
    ctl = path.join(o.base, 'runtime', 'ctl.cjs'),
    setup = path.join(o.base, 'runtime', 'setup.cjs');
  const want = {
    status: [ctl, 'status'],
    start: [ctl, 'start'],
    stop: [ctl, 'stop'],
    restoreNetwork: [ctl, 'restore-network'],
    setAutostart: [ctl, 'set-autostart', 'on'],
    profiles: [ctl, 'profiles'],
    select: [ctl, 'select', 'abcd1234'],
    delete: [ctl, 'delete', 'abcd1234'],
    importBegin: [ctl, 'import-begin'],
    importStatus: [ctl, 'import-status'],
    importEnd: [ctl, 'import-end'],
    importUsb: [ctl, 'import-usb'],
    refreshSubscription: [ctl, 'refresh-subscription', 'sub0000001'],
    diagnostics: [ctl, 'diagnostics'],
    setupStatus: [setup, 'status', '--app', appDir],
    setupInstall: [setup, 'install', '--app', appDir],
    setupUninstall: [setup, 'uninstall', 'keep-profile', '--app', appDir],
  };
  for (const method of PLANNED) {
    const answer = await S.handle(method, app.id, VALID[method], o),
      call = r.calls.pop();
    assert.deepEqual(answer, { ok: true, ran: want[method][1] }, method);
    assert.equal(call.file, '/usr/bin/node');
    assert.ok(Array.isArray(call.args) && call.args.every((a) => typeof a === 'string'), method);
    assert.deepEqual(call.args, want[method], method);
    assert.ok(!call.options.shell, method);
    // Install and uninstall are never cut short; everything else has a time limit.
    assert.equal(call.options.timeout > 0, !['setupInstall', 'setupUninstall'].includes(method), method);
  }
  await S.handle('setAutostart', app.id, { enabled: false }, o);
  assert.deepEqual(r.calls.pop().args, [ctl, 'set-autostart', 'off']);
  await S.handle('setupUninstall', app.id, { deleteProfile: true }, o);
  assert.deepEqual(r.calls.pop().args, [setup, 'uninstall', 'delete-profile', '--app', appDir]);
});

test('setup runs the installed root-only copy once there is one, else the package copy after secureApp', async () => {
  const r = runner();
  if (posix) fs.chmodSync(appDir, 0o777);
  const o = elevated(r);
  await S.handle('setupInstall', app.id, {}, o);
  assert.equal(r.calls.pop().args[0], path.join(o.base, 'runtime', 'setup.cjs'));
  // The package directory is left as it was: none of its code ran.
  if (posix) assert.equal(fs.statSync(appDir).mode & 0o777, 0o777);
  // First install: no BASE yet, or BASE without runtime (components removed, profiles kept).
  const empty = fs.mkdtempSync(path.join(tmp, 'base-'));
  for (const b of [path.join(tmp, 'absent'), empty]) {
    await S.handle('setupInstall', app.id, {}, elevated(r, { base: b }));
    assert.deepEqual(r.calls.pop().args, [path.join(appDir, 'runtime', 'setup.cjs'), 'install', '--app', appDir]);
    if (posix) assert.equal(fs.statSync(appDir).mode & 0o777, 0o755);
    if (posix) fs.chmodSync(appDir, 0o777);
    // No installed controller yet: nothing to run for VPN methods.
    assert.deepEqual(await S.handle('status', app.id, {}, elevated(r, { base: b })), {
      ok: false,
      error: 'controller-error',
    });
  }
  // Components from 0.6.1 or older: their setup.cjs does not take --app.
  await S.handle('setupStatus', app.id, {}, elevated(r, { base: base(false) }));
  assert.equal(r.calls.pop().args[0], path.join(appDir, 'runtime', 'setup.cjs'));
  assert.equal(r.calls.length, 0);
  if (posix) fs.chmodSync(appDir, 0o755);
});

test('package-unsafe: a package directory that fails secureApp runs nothing', async () => {
  const r = runner(),
    absent = path.join(tmp, 'absent');
  for (const method of ['setupStatus', 'setupInstall', 'setupUninstall'])
    assert.deepEqual(await S.handle(method, app.id, VALID[method], elevated(r, { base: absent, owner: owner + 1 })), {
      ok: false,
      error: 'package-unsafe',
    });
  if (posix)
    for (const plant of [
      () => fs.symlinkSync('/etc/hostname', appDir + '/runtime/extra.cjs'),
      () => fs.linkSync(appDir + '/runtime/setup.cjs', appDir + '/runtime/twin.cjs'),
    ]) {
      plant();
      assert.deepEqual(await S.handle('setupInstall', app.id, {}, elevated(r, { base: absent })), {
        ok: false,
        error: 'package-unsafe',
      });
      fs.rmSync(appDir + '/runtime/' + fs.readdirSync(appDir + '/runtime').find((f) => f !== 'setup.cjs'));
    }
  assert.equal(r.calls.length, 0);
});

test('unsafe-base: an installed runtime that is not root-only is not run', async () => {
  const r = runner();
  for (const method of ['status', 'setupStatus', 'setupInstall'])
    assert.deepEqual(await S.handle(method, app.id, {}, elevated(r, { owner: owner + 1 })), {
      ok: false,
      error: 'unsafe-base',
    });
  if (posix) {
    const linked = base();
    fs.symlinkSync('/etc/hostname', linked + '/runtime/link.cjs');
    assert.deepEqual(await S.handle('status', app.id, {}, elevated(r, { base: linked })), {
      ok: false,
      error: 'unsafe-base',
    });
    const loose = base();
    fs.chmodSync(loose + '/runtime/ctl.cjs', 0o666);
    await S.handle('status', app.id, {}, elevated(r, { base: loose }));
    assert.equal(fs.statSync(loose + '/runtime/ctl.cjs').mode & 0o777, 0o644);
    assert.equal(r.calls.length, 1);
  } else assert.equal(r.calls.length, 0);
});

test('output that is not one JSON answer becomes an error code; the last line is the answer', async () => {
  for (const [out, method, error] of [
    ['garbage', 'status', 'controller-error'],
    ['', 'start', 'controller-error'],
    ['{"state":"connected"}', 'status', 'controller-error'],
    ['[true]', 'status', 'controller-error'],
    ['garbage', 'setupStatus', 'install-failed'],
    ['', 'setupInstall', 'install-failed'],
    ['garbage', 'setupUninstall', 'uninstall-failed'],
  ]) {
    const r = runner(() => out);
    assert.deepEqual(await S.handle(method, app.id, VALID[method], elevated(r)), { ok: false, error }, method);
  }
  const r = runner(() => 'node: warning\n{"ok":false,"error":"core-mismatch"}\n');
  assert.deepEqual(await S.handle('setupInstall', app.id, {}, elevated(r)), { ok: false, error: 'core-mismatch' });
});

test('one install or uninstall at a time; status does not wait', async () => {
  const r = runner(undefined, true),
    o = elevated(r);
  const first = S.handle('setupInstall', app.id, {}, o),
    second = S.handle('setupUninstall', app.id, { deleteProfile: false }, o);
  await tick();
  assert.equal(r.calls.length, 1);
  const status = S.handle('setupStatus', app.id, {}, o);
  await tick();
  assert.equal(r.calls.length, 2);
  r.calls[1].answer('{"ok":true,"current":true}');
  assert.deepEqual(await status, { ok: true, current: true });
  r.calls[0].answer('{"ok":true}');
  assert.deepEqual(await first, { ok: true });
  await tick();
  assert.equal(r.calls.length, 3);
  assert.equal(r.calls[2].args[1], 'uninstall');
  r.calls[2].answer('{"ok":true,"profileRetained":true}');
  assert.deepEqual(await second, { ok: true, profileRetained: true });
});

test('setupInstall removes the package with the old id first, and installs nothing while it stays', async () => {
  assert.equal(S.LEGACY_ID, 'io.github.steam20011972-code.tvvpn');
  const legacy = path.join(path.dirname(appDir), S.LEGACY_ID),
    order = [];
  fs.mkdirSync(legacy + '/runtime', { recursive: true });
  const r = runner((args) => {
      order.push('setup ' + args[1]);
      return '{"ok":true}';
    }),
    removed = [];
  const removeApp = async (id, gone) => {
    removed.push(id);
    order.push('remove');
    assert.equal(gone(), false);
    fs.rmSync(legacy, { recursive: true });
    assert.equal(gone(), true);
  };
  // Status and uninstall leave it alone.
  await S.handle('setupStatus', app.id, {}, elevated(r, { removeApp }));
  await S.handle('setupUninstall', app.id, VALID.setupUninstall, elevated(r, { removeApp }));
  assert.deepEqual(removed, []);
  assert.deepEqual(await S.handle('setupInstall', app.id, {}, elevated(r, { removeApp })), { ok: true });
  assert.deepEqual(removed, [S.LEGACY_ID]);
  assert.deepEqual(order, ['setup status', 'setup uninstall', 'remove', 'setup install']);
  // Gone already: nothing to remove.
  await S.handle('setupInstall', app.id, {}, elevated(r, { removeApp }));
  assert.deepEqual(removed, [S.LEGACY_ID]);
  // The installer did not remove it: no install.
  fs.mkdirSync(legacy);
  const calls = r.calls.length;
  assert.deepEqual(await S.handle('setupInstall', app.id, {}, elevated(r, { removeApp: async () => {} })), {
    ok: false,
    error: 'legacy-remove-failed',
  });
  assert.equal(r.calls.length, calls);
  fs.rmSync(legacy, { recursive: true });
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
