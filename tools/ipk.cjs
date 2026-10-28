'use strict';
// Minimal IPK reader (ar archive holding data.tar.gz) so checks do not depend on the host tar.
const fs = require('fs'),
  zlib = require('zlib');
function ar(buf) {
  if (buf.toString('latin1', 0, 8) !== '!<arch>\n') throw Error('Not an ar archive');
  const out = {};
  for (let p = 8; p + 60 <= buf.length;) {
    const name = buf
        .toString('latin1', p, p + 16)
        .trim()
        .replace(/\/$/, ''),
      size = Number(buf.toString('latin1', p + 48, p + 58).trim());
    out[name] = buf.subarray(p + 60, p + 60 + size);
    p += 60 + size + (size % 2);
  }
  return out;
}
function tar(buf) {
  const out = {};
  let long = null;
  for (let p = 0; p + 512 <= buf.length;) {
    const h = buf.subarray(p, p + 512);
    if (h.every((b) => b === 0)) break;
    const field = (a, b) => h.toString('utf8', a, b).replace(/\0.*$/s, '');
    const size = parseInt(field(124, 136).trim() || '0', 8),
      type = field(156, 157),
      body = buf.subarray(p + 512, p + 512 + size);
    let name = field(345, 500) ? field(345, 500) + '/' + field(0, 100) : field(0, 100);
    p += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') {
      long = body.toString('utf8').replace(/\0.*$/s, '');
      continue;
    }
    if (type === 'x') {
      const m = body.toString('utf8').match(/\d+ path=([^\n]*)\n/);
      if (m) long = m[1];
      continue;
    }
    if (long) {
      name = long;
      long = null;
    }
    if (type === '0' || type === '') out[name.replace(/^\.\//, '')] = body;
  }
  return out;
}
function files(ipk) {
  return tar(zlib.gunzipSync(ar(fs.readFileSync(ipk))['data.tar.gz']));
}
// Mode of every tar entry by name (directories end with "/").
function modes(buf) {
  const out = {};
  for (let p = 0; p + 512 <= buf.length;) {
    const h = buf.subarray(p, p + 512);
    if (h.every((b) => b === 0)) break;
    const size = parseInt(h.toString('latin1', 124, 136).replace(/\0.*$/s, '').trim() || '0', 8);
    out[h.toString('utf8', 0, 100).replace(/\0.*$/s, '')] =
      parseInt(h.toString('latin1', 100, 108).replace(/\0.*$/s, '').trim() || '0', 8) & 0o7777;
    p += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}
// Owner of every tar entry by name: "uid:gid", plus ":uname:gname" when names are set.
function owners(buf) {
  const out = {};
  for (let p = 0; p + 512 <= buf.length;) {
    const h = buf.subarray(p, p + 512);
    if (h.every((b) => b === 0)) break;
    const f = (a, b) => h.toString('latin1', a, b).replace(/\0.*$/s, '').trim(),
      size = parseInt(f(124, 136) || '0', 8),
      names = f(265, 297) + f(297, 329) ? ':' + f(265, 297) + ':' + f(297, 329) : '';
    out[h.toString('utf8', 0, 100).replace(/\0.*$/s, '')] =
      parseInt(f(108, 116) || '0', 8) + ':' + parseInt(f(116, 124) || '0', 8) + names;
    p += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}
// ares-package stores files as 0666 and directories as 0777, and the TV installer keeps those modes: any process
// could then rewrite runtime/setup.cjs, which the app runs as root. Every entry becomes 0644 (directories 0755).
// The installer also keeps the builder's owner (uid 1001 "runner" on GitHub Actions), and setup.cjs refuses a
// package not owned by root (package-unsafe). Every entry becomes 0:0 with no user or group name.
function normalizeTar(buf) {
  const out = Buffer.from(buf);
  for (let p = 0; p + 512 <= out.length;) {
    const h = out.subarray(p, p + 512);
    if (h.every((b) => b === 0)) break;
    const size = parseInt(h.toString('latin1', 124, 136).replace(/\0.*$/s, '').trim() || '0', 8),
      type = String.fromCharCode(h[156]);
    h.write((type === '5' ? '0000755' : '0000644') + '\0', 100, 8, 'latin1');
    h.write('0000000\0', 108, 8, 'latin1');
    h.write('0000000\0', 116, 8, 'latin1');
    h.fill(0, 265, 329);
    h.fill(0x20, 148, 156);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1');
    p += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}
// Replaces fields of the "control" file in a control tar (other entries untouched). ares-package writes
// "Architecture: all" even with an ARM binary inside, a placeholder Maintainer and Description. A field missing from
// the file is appended. Header checksums are left to normalizeTar.
function setControl(buf, fields) {
  for (const [k, v] of Object.entries(fields))
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(k) || /[\r\n]/.test(v) || !String(v).trim())
      throw Error('Bad control field: ' + k);
  const parts = [];
  let found = false;
  for (let p = 0; p + 512 <= buf.length;) {
    const h = Buffer.from(buf.subarray(p, p + 512));
    if (h.every((b) => b === 0)) {
      parts.push(buf.subarray(p));
      break;
    }
    const size = parseInt(h.toString('latin1', 124, 136).replace(/\0.*$/s, '').trim() || '0', 8),
      name = h.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    let body = buf.subarray(p + 512, p + 512 + size);
    p += 512 + Math.ceil(size / 512) * 512;
    if (name.replace(/^\.\//, '') === 'control' && String.fromCharCode(h[156]) === '0') {
      let text = body.toString('utf8');
      for (const [k, v] of Object.entries(fields)) {
        const line = new RegExp('^' + k + ':.*$', 'm');
        text = line.test(text)
          ? text.replace(line, () => k + ': ' + v)
          : text.replace(/\n?$/, '\n' + k + ': ' + v + '\n');
      }
      body = Buffer.from(text);
      h.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'latin1');
      found = true;
    }
    parts.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  if (!found) throw Error('No control file in control.tar.gz');
  return Buffer.concat(parts);
}
// Rewrites an IPK in place with those modes and owners, and with the given control fields. Each ar header is kept
// byte for byte except its size field, so member names and order stay exactly as ares-package wrote them.
function normalize(ipk, fields = {}) {
  const buf = fs.readFileSync(ipk),
    parts = [buf.subarray(0, 8)];
  if (buf.toString('latin1', 0, 8) !== '!<arch>\n') throw Error('Not an ar archive');
  for (let p = 8; p + 60 <= buf.length;) {
    const header = Buffer.from(buf.subarray(p, p + 60)),
      name = header.toString('latin1', 0, 16).trim().replace(/\/$/, ''),
      size = Number(header.toString('latin1', 48, 58).trim());
    let data = buf.subarray(p + 60, p + 60 + size);
    p += 60 + size + (size % 2);
    if (/\.tar\.gz$/.test(name)) {
      let body = zlib.gunzipSync(data);
      if (name === 'control.tar.gz' && Object.keys(fields).length) body = setControl(body, fields);
      data = zlib.gzipSync(normalizeTar(body), { level: 9 });
      header.write(String(data.length).padEnd(10), 48, 10, 'latin1');
    }
    parts.push(header, data);
    if (data.length % 2) parts.push(Buffer.from('\n'));
  }
  fs.writeFileSync(ipk, Buffer.concat(parts));
}
function packageModes(ipk) {
  const m = ar(fs.readFileSync(ipk));
  return { ...modes(zlib.gunzipSync(m['control.tar.gz'])), ...modes(zlib.gunzipSync(m['data.tar.gz'])) };
}
function packageOwners(ipk) {
  const m = ar(fs.readFileSync(ipk));
  return { ...owners(zlib.gunzipSync(m['control.tar.gz'])), ...owners(zlib.gunzipSync(m['data.tar.gz'])) };
}
// Text of the package's control file.
function control(ipk) {
  const t = tar(zlib.gunzipSync(ar(fs.readFileSync(ipk))['control.tar.gz']));
  if (!t.control) throw Error('No control file in control.tar.gz');
  return t.control.toString('utf8');
}
module.exports = { files, modes, owners, normalizeTar, setControl, normalize, control, packageModes, packageOwners };
