const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('fs'),
  os = require('os'),
  path = require('path'),
  crypto = require('crypto'),
  cp = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tvvpn-setup-'));
process.env.TVVPN_HOME = path.join(tmp, 'base');
process.env.TVVPN_HOOK_DIR = path.join(tmp, 'init.d');
// Fake packages below are unsigned; the signature tests turn this off.
process.env.TVVPN_ALLOW_UNSIGNED = '1';
fs.mkdirSync(process.env.TVVPN_HOME);
const C = require('../runtime/common.cjs'),
  setup = require('../runtime/setup.cjs'),
  { secureApp, securePackage } = require('../runtime/secure-app.cjs');
const BASE = process.env.TVVPN_HOME;
// Fake app directory laid out like the IPK built by tools/build.cjs.
function fakeApp(name, version = '9.9.9', core = Buffer.from('fake core ' + name)) {
  const app = path.join(tmp, name);
  fs.mkdirSync(app + '/runtime', { recursive: true });
  fs.mkdirSync(app + '/core');
  for (const f of fs.readdirSync('runtime')) fs.copyFileSync('runtime/' + f, app + '/runtime/' + f);
  fs.writeFileSync(app + '/core/sing-box', core);
  fs.writeFileSync(app + '/core/LICENSE', 'license');
  fs.writeFileSync(
    app + '/core.lock.json',
    JSON.stringify({ version: '1.0.0', binarySha256: crypto.createHash('sha256').update(core).digest('hex') })
  );
  fs.writeFileSync(app + '/appinfo.json', JSON.stringify({ version }));
  return app;
}
const app = fakeApp('app');
test('deploy installs runtime, verified core, boot hook and version marker', () => {
  fs.writeFileSync(BASE + '/profile.json', '{}');
  fs.chmodSync(BASE + '/profile.json', 0o777);
  // As devmode.sh leaves run/ after a boot; a link there is not followed.
  fs.writeFileSync(C.RUN + '/events.log', '');
  fs.chmodSync(C.RUN + '/events.log', 0o777);
  const outside = path.join(tmp, 'outside-run');
  fs.writeFileSync(outside, '');
  fs.chmodSync(outside, 0o644);
  if (process.platform !== 'win32') fs.symlinkSync(outside, C.RUN + '/link');
  setup.deploy(C, app);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(BASE + '/profile.json').mode & 0o777, 0o600);
    assert.equal(fs.statSync(C.RUN + '/events.log').mode & 0o777, 0o600);
    assert.equal(fs.statSync(outside).mode & 0o777, 0o644);
    assert.equal(fs.statSync(BASE + '/bin/LICENSE').mode & 0o777, 0o600);
    fs.unlinkSync(C.RUN + '/link');
  }
  fs.unlinkSync(BASE + '/profile.json');
  fs.unlinkSync(C.RUN + '/events.log');
  for (const f of ['runtime/supervisor.cjs', 'runtime/watchdog.sh', 'runtime/setup.cjs', 'bin/sing-box', 'bin/LICENSE'])
    assert.ok(fs.existsSync(BASE + '/' + f), f);
  assert.equal(fs.readFileSync(C.HOOK, 'utf8'), fs.readFileSync('runtime/70-tv-vpn', 'utf8'));
  assert.equal(C.read('installed.json').version, '9.9.9');
  // The package, for launch.cjs to tighten at boot.
  assert.equal(C.read('installed.json').app, path.resolve(app));
  assert.ok(!fs.existsSync(BASE + '/runtime.new') && !fs.existsSync(BASE + '/runtime.old'));
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(BASE + '/bin/sing-box').mode & 0o777, 0o700);
    assert.equal(fs.statSync(BASE + '/runtime/common.cjs').mode & 0o777, 0o600);
  }
  const s = setup.status(app);
  assert.equal(s.current, true);
  assert.equal(s.installed.version, '9.9.9');
});
test('deploy is idempotent and does not recopy a matching core', () => {
  const before = fs.statSync(BASE + '/bin/sing-box').mtimeMs;
  setup.deploy(C, app);
  assert.equal(fs.statSync(BASE + '/bin/sing-box').mtimeMs, before);
  assert.equal(setup.status(app).current, true);
});
test('a newer app version reports the install as outdated', () => {
  assert.equal(setup.status(fakeApp('newer', '10.0.0')).current, false);
});
test('an install without the package path (as a 0.6.x copy writes it), or with another one, is not current', () => {
  const saved = C.read('installed.json');
  const { app: _, ...without } = saved;
  C.write('installed.json', without);
  assert.equal(setup.status(app).current, false);
  C.write('installed.json', { ...saved, app: path.resolve(fakeApp('elsewhere')) });
  assert.equal(setup.status(app).current, false);
  C.write('installed.json', saved);
  assert.equal(setup.status(app).current, true);
});
test('the boot hook starts nothing once the app was removed from the TV menu', () => {
  const saved = C.read('installed.json');
  const gone = fakeApp('gone');
  fs.rmSync(gone, { recursive: true });
  C.write('installed.json', { ...saved, app: path.resolve(gone) });
  fs.rmSync(C.RUN + '/controller.log', { force: true });
  const r = cp.spawnSync(process.execPath, [BASE + '/runtime/launch.cjs', 'boot'], { env: process.env });
  assert.equal(r.status, 0);
  assert.ok(!fs.existsSync(C.RUN + '/controller.log'), 'supervisor launched');
  C.write('installed.json', saved);
});
test('core whose hash differs from core.lock.json is rejected before anything is replaced', () => {
  const bad = fakeApp('bad', '9.9.10');
  fs.writeFileSync(bad + '/core/sing-box', 'tampered');
  assert.throws(() => setup.deploy(C, bad), { code: 'core-mismatch' });
  assert.equal(C.read('installed.json').version, '9.9.9');
});
test('foreign boot hook is not overwritten', () => {
  const saved = fs.readFileSync(C.HOOK);
  fs.writeFileSync(C.HOOK, '#!/bin/sh\necho other\n');
  assert.throws(() => setup.deploy(C, app), { code: 'hook-conflict' });
  assert.equal(fs.readFileSync(C.HOOK, 'utf8'), '#!/bin/sh\necho other\n');
  fs.writeFileSync(C.HOOK, saved);
});
test('stopController is a no-op without a running controller or lease', async () => {
  await setup.stopController(C);
  await setup.stopController(C);
});
test('install parks the live runtime so nothing can relaunch it; a failure puts it back, a deploy replaces it', () => {
  setup.deploy(C, app);
  setup.park(C);
  assert.ok(!fs.existsSync(BASE + '/runtime/launch.cjs') && fs.existsSync(BASE + '/runtime.parked/launch.cjs'));
  setup.unpark(C);
  assert.ok(fs.existsSync(BASE + '/runtime/launch.cjs') && !fs.existsSync(BASE + '/runtime.parked'));
  const broken = fakeApp('broken');
  fs.writeFileSync(broken + '/core/sing-box', 'tampered');
  setup.park(C);
  assert.throws(() => setup.deploy(C, broken), /core-mismatch/);
  setup.unpark(C);
  assert.ok(fs.existsSync(BASE + '/runtime/launch.cjs'));
  setup.park(C);
  setup.deploy(C, app);
  assert.ok(fs.existsSync(BASE + '/runtime/launch.cjs') && !fs.existsSync(BASE + '/runtime.parked'));
});
test('uninstall removes owned files and the hook, keeps the profile unless asked', () => {
  fs.writeFileSync(BASE + '/profile.json', '{}', { mode: 0o600 });
  const run = (args) =>
    JSON.parse(
      cp.execFileSync(process.execPath, [path.join(BASE, 'runtime/uninstall.cjs'), ...args], {
        env: process.env,
        encoding: 'utf8',
      })
    );
  assert.equal(run([]).profileRetained, true);
  for (const f of ['runtime', 'bin', 'installed.json', 'preferences.json'])
    assert.ok(!fs.existsSync(BASE + '/' + f), f);
  assert.ok(!fs.existsSync(C.HOOK));
  assert.ok(fs.existsSync(BASE + '/profile.json'));
  setup.deploy(C, app);
  assert.equal(run(['--delete-profile']).profileRetained, false);
  assert.ok(!fs.existsSync(BASE + '/profile.json'));
  assert.equal(setup.status(app).current, false);
});
test(
  'secureApp tightens group/other-writable app files and refuses a foreign owner',
  { skip: process.platform === 'win32' },
  () => {
    const loose = fakeApp('loose');
    fs.chmodSync(loose, 0o777);
    fs.chmodSync(loose + '/runtime', 0o777);
    fs.chmodSync(loose + '/runtime/setup.cjs', 0o666);
    secureApp(loose, process.getuid());
    assert.equal(fs.statSync(loose).mode & 0o777, 0o755);
    assert.equal(fs.statSync(loose + '/runtime').mode & 0o777, 0o755);
    assert.equal(fs.statSync(loose + '/runtime/setup.cjs').mode & 0o777, 0o644);
    assert.throws(() => secureApp(loose, process.getuid() + 1), { code: 'package-unsafe' });
    fs.symlinkSync('/etc/hostname', loose + '/runtime/link.cjs');
    assert.throws(() => secureApp(loose, process.getuid()), { code: 'package-unsafe' });
    // A named pipe is not opened: only files and directories are.
    fs.rmSync(loose + '/runtime/link.cjs');
    cp.execFileSync('mkfifo', [loose + '/runtime/pipe']);
    assert.throws(() => secureApp(loose, process.getuid()), { code: 'package-unsafe' });
  }
);
test(
  'secureApp changes nothing reached through a directory swapped for a link',
  { skip: process.platform !== 'linux' },
  () => {
    // A directory of the package swapped for a link after it was checked: the walk then reaches the next entry
    // through the link, into someone else's tree (played here by readdir naming the entry through the link). Opened
    // without following a last link, the file is still not the one at the expected path; /proc/self/fd shows it.
    const outside = path.join(tmp, 'outside'),
      pkg = fs.realpathSync(fakeApp('swapped'));
    fs.mkdirSync(outside);
    fs.writeFileSync(outside + '/victim', '');
    fs.chmodSync(outside + '/victim', 0o666);
    fs.symlinkSync(outside, pkg + '/runtime.link');
    const readdir = fs.readdirSync;
    fs.readdirSync = (p, ...rest) => (p === pkg ? ['runtime.link/victim'] : readdir(p, ...rest));
    try {
      assert.throws(() => secureApp(pkg, process.getuid()), { code: 'package-unsafe' });
    } finally {
      fs.readdirSync = readdir;
    }
    assert.equal(fs.statSync(outside + '/victim').mode & 0o777, 0o666);
  }
);
test(
  'securePackage puts back the modes of the app and of its Luna service beside it',
  { skip: process.platform === 'win32' },
  () => {
    const root = path.join(tmp, 'palm'),
      appDir = path.join(root, 'applications', 'org.example.app'),
      serviceDir = path.join(root, 'services', 'org.example.app.service');
    fs.mkdirSync(appDir, { recursive: true });
    fs.mkdirSync(serviceDir, { recursive: true });
    fs.writeFileSync(appDir + '/appinfo.json', '{}');
    fs.writeFileSync(serviceDir + '/service.js', '');
    // As devmode.sh leaves them after a boot.
    for (const p of [appDir, appDir + '/appinfo.json', serviceDir, serviceDir + '/service.js']) fs.chmodSync(p, 0o777);
    assert.deepEqual(securePackage(appDir, process.getuid()), [true, true]);
    assert.deepEqual(
      [appDir, appDir + '/appinfo.json', serviceDir, serviceDir + '/service.js'].map(
        (p) => fs.statSync(p).mode & 0o777
      ),
      [0o755, 0o644, 0o755, 0o644]
    );
    // One that fails secureApp is left alone; the other is still done.
    fs.symlinkSync('/etc/hostname', serviceDir + '/link');
    fs.chmodSync(appDir, 0o777);
    assert.deepEqual(securePackage(appDir, process.getuid()), [true, false]);
    assert.equal(fs.statSync(appDir).mode & 0o777, 0o755);
    fs.rmSync(serviceDir, { recursive: true });
    assert.deepEqual(securePackage(appDir, process.getuid()), [true, false]);
  }
);
test(
  'write() replaces a link left under the temporary name instead of writing through it',
  { skip: process.platform === 'win32' },
  () => {
    const victim = path.join(tmp, 'victim.txt');
    fs.writeFileSync(victim, 'keep');
    fs.symlinkSync(victim, BASE + '/state.json.tmp');
    C.write('state.json', { a: 1 });
    assert.equal(fs.readFileSync(victim, 'utf8'), 'keep');
    assert.deepEqual(C.read('state.json'), { a: 1 });
    assert.ok(!fs.lstatSync(BASE + '/state.json').isSymbolicLink());
  }
);
test('the installed copy needs --app; --app must be an absolute normalized directory other than BASE', () => {
  setup.deploy(C, app);
  const run = (args) =>
    JSON.parse(
      cp
        .execFileSync(process.execPath, [path.join(BASE, 'runtime/setup.cjs'), ...args], {
          env: process.env,
          encoding: 'utf8',
        })
        .trim()
    );
  assert.deepEqual(run(['status']), { ok: false, error: 'app-required' });
  const s = run(['status', '--app', app]);
  assert.equal(s.ok, true);
  assert.equal(s.appVersion, '9.9.9');
  assert.equal(s.current, true);
  for (const bad of ['relative/app', app + path.sep + '..' + path.sep + 'app', BASE])
    assert.deepEqual(run(['status', '--app', bad]), { ok: false, error: 'invalid-action' }, bad);
  assert.deepEqual(run(['install', '--app']), { ok: false, error: 'invalid-action' });
});
test('after park() the installed copy finds its siblings in runtime.parked', () => {
  assert.equal(setup.runtimeFile(C, 'uninstall.cjs'), path.join(__dirname, '..', 'runtime', 'uninstall.cjs'));
  const installed = require(path.join(BASE, 'runtime/setup.cjs'));
  assert.equal(
    path.resolve(installed.runtimeFile(C, 'uninstall.cjs')),
    path.resolve(BASE, 'runtime.parked', 'uninstall.cjs')
  );
});
test('signed packages: a valid signature installs; unsigned, foreign-key and altered packages are refused before any change', () => {
  const SIG = require('../runtime/signature.cjs');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'),
    other = crypto.generateKeyPairSync('ed25519');
  const signed = (name, key = privateKey) => {
    const a = fakeApp(name, '9.9.20');
    const m = SIG.manifest(a, '9.9.20');
    fs.writeFileSync(a + '/manifest.json', m);
    fs.writeFileSync(a + '/manifest.sig', SIG.sign(m, key));
    return a;
  };
  delete process.env.TVVPN_ALLOW_UNSIGNED;
  try {
    const before = C.read('installed.json');
    assert.throws(() => setup.deploy(C, fakeApp('unsigned', '9.9.20'), { publicKey }), { code: 'package-unsigned' });
    assert.throws(() => setup.deploy(C, signed('foreign', other.privateKey), { publicKey }), {
      code: 'package-signature',
    });
    const altered = signed('altered');
    fs.appendFileSync(altered + '/runtime/supervisor.cjs', '\n// changed after signing\n');
    assert.throws(() => setup.deploy(C, altered, { publicKey }), { code: 'package-mismatch' });
    const extra = signed('extra');
    fs.writeFileSync(extra + '/runtime/added.cjs', '');
    assert.throws(() => setup.deploy(C, extra, { publicKey }), { code: 'package-mismatch' });
    assert.deepEqual(C.read('installed.json'), before);
    assert.ok(!fs.existsSync(BASE + '/runtime.new'));
    setup.deploy(C, signed('good'), { publicKey });
    assert.equal(C.read('installed.json').version, '9.9.20');
    // The real release key is built in, so a package signed with a test key fails without the option.
    assert.throws(() => setup.deploy(C, signed('good2')), { code: 'package-signature' });
  } finally {
    process.env.TVVPN_ALLOW_UNSIGNED = '1';
  }
});
test('the signature covers the Luna service beside the app; files stays what 0.6.x installers count', () => {
  const SIG = require('../runtime/signature.cjs');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  // Laid out as installed: usr/palm/applications/<id> and usr/palm/services/<id>.service.
  const signed = (name) => {
    const root = path.join(tmp, name),
      a = path.join(root, 'applications', 'io.example.tvvpn'),
      s = path.join(root, 'services', 'io.example.tvvpn.service');
    fs.mkdirSync(path.dirname(a), { recursive: true });
    fs.renameSync(fakeApp(name + '-app', '9.9.30'), a);
    fs.writeFileSync(a + '/appinfo.json', JSON.stringify({ id: 'io.example.tvvpn', version: '9.9.30' }));
    fs.mkdirSync(s, { recursive: true });
    fs.writeFileSync(s + '/service.js', 'service');
    fs.writeFileSync(s + '/services.json', '{}');
    const m = SIG.manifest(a, '9.9.30');
    fs.writeFileSync(a + '/manifest.json', m);
    fs.writeFileSync(a + '/manifest.sig', SIG.sign(m, privateKey));
    return { a, s, m: JSON.parse(m) };
  };
  delete process.env.TVVPN_ALLOW_UNSIGNED;
  try {
    const good = signed('svc-good');
    assert.deepEqual(Object.keys(good.m.files), SIG.covered(good.a));
    assert.deepEqual(Object.keys(good.m.service), ['service.js', 'services.json']);
    assert.deepEqual(Object.keys(SIG.verify(good.a, publicKey)), SIG.covered(good.a));
    const altered = signed('svc-altered');
    fs.appendFileSync(altered.s + '/service.js', '\n// changed after signing\n');
    assert.throws(() => setup.deploy(C, altered.a, { publicKey }), { code: 'package-mismatch' });
    const extra = signed('svc-extra');
    fs.writeFileSync(extra.s + '/node_modules.js', '');
    assert.throws(() => SIG.verify(extra.a, publicKey), { code: 'package-mismatch' });
    const missing = signed('svc-missing');
    fs.rmSync(missing.s, { recursive: true });
    assert.throws(() => SIG.verify(missing.a, publicKey), { code: 'package-mismatch' });
  } finally {
    process.env.TVVPN_ALLOW_UNSIGNED = '1';
  }
});
test('secureApp refuses a hard-linked file', { skip: process.platform === 'win32' }, () => {
  const linked = fakeApp('linked');
  fs.linkSync(linked + '/runtime/setup.cjs', linked + '/runtime/twin.cjs');
  assert.throws(() => secureApp(linked, process.getuid()), { code: 'package-unsafe' });
});
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
