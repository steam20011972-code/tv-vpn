const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('fs'),
  os = require('os'),
  path = require('path'),
  zlib = require('zlib');
const ipk = require('../tools/ipk.cjs');
// Minimal ustar archive and ar container shaped like ares-package output on GitHub Actions (0666 files,
// 0777 directories, owner 1001:1001 "runner").
function header(name, size, mode, type) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100);
  h.write(mode.toString(8).padStart(7, '0') + '\0', 100);
  h.write('0001751\0', 108);
  h.write('0001751\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.fill(0x20, 148, 156);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  h.write('runner', 265);
  h.write('runner', 297);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1');
  return h;
}
function tarOf(entries) {
  const parts = [];
  for (const [name, body] of entries) {
    const data = Buffer.from(body || '');
    parts.push(
      header(name, data.length, body === null ? 0o777 : 0o666, body === null ? '5' : '0'),
      data,
      Buffer.alloc((512 - (data.length % 512)) % 512)
    );
  }
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}
function ar(members) {
  const parts = [Buffer.from('!<arch>\n')];
  for (const [name, data] of members) {
    parts.push(
      Buffer.from(
        name.padEnd(16) +
          '0'.padEnd(12) +
          '0'.padEnd(6) +
          '0'.padEnd(6) +
          '100644'.padEnd(8) +
          String(data.length).padEnd(10) +
          '`\n'
      ),
      data
    );
    if (data.length % 2) parts.push(Buffer.from('\n'));
  }
  return Buffer.concat(parts);
}
const checksumOk = (buf) => {
  for (let p = 0; p + 512 <= buf.length;) {
    const h = Buffer.from(buf.subarray(p, p + 512));
    if (h.every((b) => b === 0)) return true;
    const want = parseInt(h.toString('latin1', 148, 156), 8);
    h.fill(0x20, 148, 156);
    let sum = 0;
    for (const b of h) sum += b;
    if (sum !== want) return false;
    const size = parseInt(h.toString('latin1', 124, 136), 8);
    p += 512 + Math.ceil(size / 512) * 512;
  }
  return true;
};

test('normalize gives every package entry 0644 (directories 0755), owner 0:0, and keeps names, order and contents', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvvpn-ipk-')),
    file = path.join(dir, 'x.ipk');
  const data = tarOf([
    ['usr/', null],
    ['usr/palm/applications/x/runtime/', null],
    ['usr/palm/applications/x/runtime/setup.cjs', 'console.log(1)\n'],
    ['usr/palm/applications/x/core/sing-box', '\x7fELF odd'],
  ]);
  fs.writeFileSync(
    file,
    ar([
      ['debian-binary', Buffer.from('2.0\n')],
      ['control.tar.gz', zlib.gzipSync(tarOf([['control', 'Package: x\n']]))],
      ['data.tar.gz', zlib.gzipSync(data)],
    ])
  );
  const before = ipk.files(file);
  assert.ok(Object.values(ipk.packageModes(file)).some((m) => m & 0o022));
  assert.equal(ipk.packageOwners(file)['usr/palm/applications/x/runtime/setup.cjs'], '1001:1001:runner:runner');
  ipk.normalize(file);
  assert.deepEqual(ipk.packageModes(file), {
    control: 0o644,
    'usr/': 0o755,
    'usr/palm/applications/x/runtime/': 0o755,
    'usr/palm/applications/x/runtime/setup.cjs': 0o644,
    'usr/palm/applications/x/core/sing-box': 0o644,
  });
  assert.deepEqual(Object.values(ipk.packageOwners(file)), Array(5).fill('0:0'));
  assert.deepEqual(ipk.files(file), before);
  const raw = fs.readFileSync(file);
  assert.equal(raw.toString('latin1', 8, 24), 'debian-binary   ');
  assert.ok(checksumOk(ipk.normalizeTar(data)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('normalize rewrites control fields the way ares-package leaves them, keeping the rest of the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvvpn-ipk-')),
    file = path.join(dir, 'x.ipk');
  const control = [
    'Package: x',
    'Version: 1.0.0',
    'Architecture: all',
    'Maintainer: N/A <nobody@example.com>',
    'Description: This is a webOS application.',
    'webOS-Package-Format-Version: 2',
    '',
  ].join('\n');
  fs.writeFileSync(
    file,
    ar([
      ['debian-binary', Buffer.from('2.0\n')],
      [
        'control.tar.gz',
        zlib.gzipSync(
          tarOf([
            ['./', null],
            ['./control', control],
          ])
        ),
      ],
      ['data.tar.gz', zlib.gzipSync(tarOf([['usr/', null]]))],
    ])
  );
  ipk.normalize(file, {
    Architecture: 'arm',
    Maintainer: 'MEDZH VPN contributors <steam20011972-code@users.noreply.github.com>',
    Description: 'VPN client for rooted LG webOS TVs (sing-box)',
    Homepage: 'https://example.org/$1',
  });
  assert.equal(
    ipk.control(file),
    [
      'Package: x',
      'Version: 1.0.0',
      'Architecture: arm',
      'Maintainer: MEDZH VPN contributors <steam20011972-code@users.noreply.github.com>',
      'Description: VPN client for rooted LG webOS TVs (sing-box)',
      'webOS-Package-Format-Version: 2',
      'Homepage: https://example.org/$1',
      '',
    ].join('\n')
  );
  assert.deepEqual(Object.values(ipk.packageOwners(file)), Array(3).fill('0:0'));
  assert.throws(() => ipk.normalize(file, { Description: 'two\nlines' }), /Bad control field/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// The built package, when there is one: arm control, no ares-package placeholders.
const app = require('../app/appinfo.json'),
  built = path.join(__dirname, '..', 'dist', `${app.id}_${app.version}_arm.ipk`);
test(
  'built IPK control says Architecture: arm and has no placeholder maintainer',
  { skip: !fs.existsSync(built) },
  () => {
    const c = ipk.control(built);
    assert.match(c, /^Architecture: arm$/m);
    assert.match(c, new RegExp('^Package: ' + app.id.replace(/\./g, '\\.') + '$', 'm'));
    assert.ok(c.split('\n').includes('Description: ' + app.appDescription));
    assert.doesNotMatch(c, /nobody@example\.com/);
  }
);
test(
  'built IPK holds the app and its Luna service, and only the removal of the old package names the old id',
  { skip: !fs.existsSync(built) },
  () => {
    const files = ipk.files(built),
      old = 'io.github.steam20011972-code.tvvpn',
      service = `usr/palm/services/${app.id}.service/service.js`;
    for (const name of ['service.js', 'services.json', 'package.json', 'secure-app.cjs', 'signature.cjs'])
      assert.ok(files[`usr/palm/services/${app.id}.service/${name}`], name);
    assert.ok(files[`usr/palm/applications/${app.id}/appinfo.json`]);
    assert.ok(Object.keys(ipk.packageModes(built)).every((n) => !n.includes(old)));
    // The service removes the package with the old id (LEGACY_ID); nothing else may name it.
    const named = String(files[service])
      .split('\n')
      .filter((l) => l.includes(old));
    assert.deepEqual(named, [`const LEGACY_ID = '${old}';`]);
    for (const [name, body] of Object.entries(files)) if (name !== service) assert.equal(body.indexOf(old), -1, name);
    assert.ok(!ipk.control(built).includes(old));
  }
);
