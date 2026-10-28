'use strict';
const fs = require('fs'),
  zlib = require('zlib'),
  cp = require('child_process'),
  path = require('path'),
  crypto = require('crypto');
const { fetchCore, lock } = require('./fetch-core.cjs');
function crc(b) {
  let n = 0xffffffff;
  for (const v of b) {
    n ^= v;
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type),
    len = Buffer.alloc(4),
    sum = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  sum.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, sum]);
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
(async () => {
  // Original code-rendered launcher icon; no borrowed branding or raster assets.
  // The letter M drawn as a route TV → server → internet (same geometry as the header mark, 100-unit grid), antialiased by distance.
  const size = 160,
    k = size / 100,
    raw = Buffer.alloc(size * (1 + size * 4)),
    bg = [17, 121, 245],
    route = [
      [22, 74],
      [22, 30],
      [50, 58],
      [78, 30],
      [78, 74],
    ];
  const seg = (px, py, [ax, ay], [bx, by]) => {
      const vx = bx - ax,
        vy = by - ay,
        t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
      return Math.hypot(px - ax - t * vx, py - ay - t * vy);
    },
    cover = (d) => Math.max(0, Math.min(1, 0.5 - d * k));
  for (let y = 0; y < size; y++) {
    let row = y * (1 + size * 4);
    for (let x = 0; x < size; x++) {
      let p = row + 1 + x * 4,
        px = (x + 0.5) / k,
        py = (y + 0.5) / k,
        d = Infinity;
      for (let i = 1; i < route.length; i++) d = Math.min(d, seg(px, py, route[i - 1], route[i]));
      let ink = Math.max(cover(d - 3.5), cover(Math.hypot(px - 22, py - 74) - 8));
      // Server and internet nodes are rings: blue inside, so the line stops at their edge.
      for (const [cx, cy, r, w] of [
        [50, 58, 6.5, 4.5],
        [78, 74, 8, 5],
      ]) {
        const dc = Math.hypot(px - cx, py - cy),
          outer = cover(dc - r - w / 2),
          inner = cover(dc - r + w / 2);
        ink = ink * (1 - outer) + outer - inner;
      }
      for (let c = 0; c < 3; c++) raw[p + c] = Math.round(bg[c] + (255 - bg[c]) * ink);
      raw[p + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  fs.writeFileSync(
    'app/icon.png',
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ])
  );
  const core = await fetchCore(),
    { id, version, appDescription } = require('../app/appinfo.json'),
    serviceId = id + '.service';
  // Stage the package: UI, TV runtime (setup.cjs installs it into /media/developer/tv-vpn) and the pinned core, and
  // the Luna service beside it as on the TV (usr/palm/applications/<id>, usr/palm/services/<id>.service), where the
  // signed manifest (runtime/signature.cjs) looks for it.
  const stage = 'dist/stage/applications/' + id,
    serviceStage = 'dist/stage/services/' + serviceId;
  fs.rmSync('dist', { recursive: true, force: true });
  fs.mkdirSync(stage + '/runtime', { recursive: true });
  fs.mkdirSync(stage + '/core');
  fs.cpSync('app', stage, { recursive: true });
  for (const file of fs.readdirSync('runtime')) fs.copyFileSync('runtime/' + file, stage + '/runtime/' + file);
  fs.copyFileSync(path.join(core, 'sing-box'), stage + '/core/sing-box');
  fs.copyFileSync(path.join(core, 'LICENSE'), stage + '/core/LICENSE');
  // sing-box's LICENSE is only a notice; GPLv3 section 4 asks for the licence text next to the binary.
  fs.copyFileSync('licenses/GPL-3.0.txt', stage + '/core/GPL-3.0.txt');
  fs.copyFileSync('core.lock.json', stage + '/core.lock.json');
  fs.copyFileSync('THIRD_PARTY_NOTICES', stage + '/THIRD_PARTY_NOTICES');
  fs.copyFileSync('LICENSE', stage + '/LICENSE');
  // The service carries its own copy of runtime/secure-app.cjs: it checks the app directory before running anything
  // from it, so it cannot load that check from there.
  const services = require('../service/services.json'),
    servicePackage = require('../service/package.json'),
    serviceAppId = (/APP_ID = '([^']*)'/.exec(fs.readFileSync('service/service.js', 'utf8')) || [])[1];
  if (services.id !== serviceId || servicePackage.name !== serviceId || serviceAppId !== id)
    throw Error('service/ must name ' + serviceId + ' and answer ' + id);
  if (servicePackage.version !== version) throw Error('service/package.json version differs from app/appinfo.json');
  fs.mkdirSync(serviceStage, { recursive: true });
  fs.cpSync('service', serviceStage, { recursive: true });
  fs.copyFileSync('runtime/secure-app.cjs', serviceStage + '/secure-app.cjs');
  // Release signature (runtime/signature.cjs). Key: TVVPN_SIGNING_KEY (CI secret), TVVPN_SIGNING_KEY_FILE or
  // ~/.tvvpn/release-signing.key. Without one the package is unsigned and setup.cjs on the TV refuses to install it.
  const SIG = require('../runtime/signature.cjs'),
    keyFile = process.env.TVVPN_SIGNING_KEY_FILE || path.join(require('os').homedir(), '.tvvpn', 'release-signing.key');
  const key = process.env.TVVPN_SIGNING_KEY || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : null);
  if (!key && process.argv.includes('--require-signature')) throw Error('No signing key: set TVVPN_SIGNING_KEY');
  if (key) {
    const m = SIG.manifest(stage, version);
    fs.writeFileSync(stage + '/manifest.json', m);
    fs.writeFileSync(stage + '/manifest.sig', SIG.sign(m, key));
  }
  const cli = require.resolve('@webos-tools/cli/bin/ares-package.js');
  // --no-minify: files ship exactly as in Git, so vendor/qrcode.js keeps its MIT header.
  cp.execFileSync(process.execPath, [cli, stage, serviceStage, '-o', 'dist', '--no-minify'], { stdio: 'inherit' });
  // ares-package names the file _all and writes "Architecture: all": it reads the ELF header of main only, and main
  // here is index.html. The package carries an ARMv7 sing-box, so control and the file name say arm.
  const file = `${id}_${version}_arm.ipk`,
    ipk = require('./ipk.cjs');
  fs.renameSync(`dist/${id}_${version}_all.ipk`, 'dist/' + file);
  // The installer keeps tar modes and owners: no entry may be writable by group or others, and every entry is root's
  // (runtime/setup.cjs runs as root and refuses anything else).
  ipk.normalize('dist/' + file, {
    Architecture: 'arm',
    Maintainer: 'MEDZH VPN contributors <steam20011972-code@users.noreply.github.com>',
    Description: appDescription,
  });
  const control = ipk.control('dist/' + file);
  if (!/^Architecture: arm$/m.test(control) || /nobody@example.com/.test(control))
    throw Error('Package control was not rewritten');
  const loose = Object.entries(ipk.packageModes('dist/' + file))
    .filter(([, m]) => m & 0o022)
    .map(([n]) => n);
  if (loose.length) throw Error('Writable by group or others in package: ' + loose.join(', '));
  const foreign = Object.entries(ipk.packageOwners('dist/' + file))
    .filter(([, o]) => o !== '0:0')
    .map(([n]) => n);
  if (foreign.length) throw Error('Not owned by root in package: ' + foreign.join(', '));
  // Verify what was actually packaged, not the staging copy.
  const packaged = ipk.files('dist/' + file);
  const inPkg = (name) => {
    const b = packaged[`usr/palm/applications/${id}/${name}`];
    if (!b) throw Error('Missing from package: ' + name);
    return b;
  };
  if (sha(inPkg('core/sing-box')) !== lock.binarySha256) throw Error('Packaged core does not match core.lock.json');
  for (const name of [
    'i18n.js',
    'commands.js',
    'runtime/report.cjs',
    'runtime/setup.cjs',
    'runtime/secure-app.cjs',
    'runtime/supervisor.cjs',
    'runtime/profile.cjs',
    'runtime/protocols.cjs',
    'runtime/profiles.cjs',
    'runtime/importer.cjs',
    'runtime/import-server.cjs',
    'vendor/qrcode.js',
    'fonts/manrope-cyrillic.woff2',
    'fonts/manrope-latin.woff2',
    'fonts/OFL.txt',
    'runtime/watchdog.sh',
    'runtime/70-tv-vpn',
    'core/LICENSE',
    'core/GPL-3.0.txt',
    'core.lock.json',
  ])
    inPkg(name);
  // Shipped unchanged: the third-party notices promise it.
  for (const name of ['vendor/qrcode.js', 'app.js'])
    if (sha(inPkg(name)) !== sha(fs.readFileSync('app/' + name)))
      throw Error('Packaged ' + name + ' differs from the source');
  // The service runs as root: it ships exactly as in Git.
  for (const [name, source] of [
    ['service.js', 'service/service.js'],
    ['services.json', 'service/services.json'],
    ['package.json', 'service/package.json'],
    ['secure-app.cjs', 'runtime/secure-app.cjs'],
  ]) {
    const b = packaged[`usr/palm/services/${serviceId}/${name}`];
    if (!b) throw Error('Missing from package: service ' + name);
    if (sha(b) !== sha(fs.readFileSync(source))) throw Error('Packaged service ' + name + ' differs from ' + source);
  }
  // The signature must hold for the packaged bytes and the key built into runtime/signature.cjs. The app and its
  // service are unpacked side by side, as installed.
  if (key) {
    const check = 'dist/stage/verify';
    for (const [name, body] of Object.entries(packaged))
      if (name.startsWith('usr/palm/')) {
        const f = path.join(check, name.slice('usr/palm/'.length));
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, body);
      }
    try {
      SIG.verify(path.join(check, 'applications', id));
    } catch (e) {
      throw Error('Package signature check failed (' + e.code + '): is the key the one in runtime/signature.cjs?');
    }
  }
  fs.rmSync('dist/stage', { recursive: true, force: true });
  fs.writeFileSync('dist/' + file + '.sha256', sha(fs.readFileSync('dist/' + file)) + '  ' + file + '\n');
  fs.writeFileSync(
    'dist/build.json',
    JSON.stringify(
      {
        version,
        node: process.version,
        core: lock.version,
        coreArch: lock.arch,
        coreSha256: lock.binarySha256,
        runtime: 'Node.js 16',
        packages: [file],
      },
      null,
      2
    )
  );
  console.log(
    'Built dist/' +
      file +
      ' with verified core ' +
      lock.version +
      (key ? ', signed' : ', UNSIGNED (the TV will refuse it)')
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
