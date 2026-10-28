'use strict';
// Signed package manifest. tools/build.cjs lists the SHA256 of every file that root later runs or trusts
// (runtime/, core/, core.lock.json, appinfo.json, and the Luna service) in manifest.json and signs those exact bytes
// with the release key (Ed25519) into manifest.sig. setup.cjs checks the signature with the key below before copying
// anything, then checks each copied file again. The key that counts is the one in the copy already installed in BASE
// (root only).
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');
const PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAVi9ek/UMRREWWDWJckbeRc8chkokoSS6Lq+dX77Hf0c=\n-----END PUBLIC KEY-----\n';
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// Files of an app directory (or staging copy) that the manifest covers, by package-relative path.
function covered(app) {
  const out = [];
  for (const name of ['appinfo.json', 'core.lock.json']) if (fs.existsSync(path.join(app, name))) out.push(name);
  for (const dir of ['runtime', 'core'])
    if (fs.existsSync(path.join(app, dir)))
      for (const f of fs.readdirSync(path.join(app, dir)).sort()) out.push(dir + '/' + f);
  return out;
}
// The package installs its Luna service beside the app: usr/palm/services/<id>.service next to
// usr/palm/applications/<id> (tools/build.cjs stages it the same way). Null when appinfo.json names no usable id.
function serviceDir(app) {
  let id;
  try {
    id = JSON.parse(fs.readFileSync(path.join(app, 'appinfo.json'), 'utf8')).id;
  } catch {}
  return typeof id === 'string' && /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/.test(id)
    ? path.join(app, '..', '..', 'services', id + '.service')
    : null;
}
// Files of the service directory by name; none when there is no service.
function serviceFiles(app) {
  const dir = serviceDir(app);
  return dir && fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}
// Service files are listed under their own key, not in files: an installed setup.cjs from 0.6.x counts files against
// covered() and would refuse a package listing more.
function manifest(app, version) {
  const files = {},
    service = {};
  for (const f of covered(app)) files[f] = sha(fs.readFileSync(path.join(app, f)));
  for (const f of serviceFiles(app)) service[f] = sha(fs.readFileSync(path.join(serviceDir(app), f)));
  return Buffer.from(JSON.stringify({ version, files, service }) + '\n');
}
function sign(bytes, privateKeyPem) {
  return crypto.sign(null, bytes, privateKeyPem).toString('base64') + '\n';
}
function fail(code) {
  const e = Error(code);
  e.code = code;
  return e;
}
// Every file present must be listed with the same content, and nothing listed may be missing.
function same(listed, present, read) {
  return present.length === Object.keys(listed).length && present.every((f) => listed[f] === sha(read(f)));
}
// The verified file list of app, or an error: package-unsigned, package-signature, package-mismatch.
function verify(app, publicKey = PUBLIC_KEY) {
  let bytes, sig;
  try {
    bytes = fs.readFileSync(path.join(app, 'manifest.json'));
    sig = Buffer.from(fs.readFileSync(path.join(app, 'manifest.sig'), 'utf8').trim(), 'base64');
  } catch {
    throw fail('package-unsigned');
  }
  let ok = false;
  try {
    ok = crypto.verify(null, bytes, publicKey, sig);
  } catch {}
  if (!ok) throw fail('package-signature');
  const m = JSON.parse(bytes.toString('utf8')),
    files = m.files || {};
  if (
    !same(files, covered(app), (f) => fs.readFileSync(path.join(app, f))) ||
    !same(m.service || {}, serviceFiles(app), (f) => fs.readFileSync(path.join(serviceDir(app), f)))
  )
    throw fail('package-mismatch');
  return files;
}
module.exports = { PUBLIC_KEY, sha, covered, serviceDir, serviceFiles, manifest, sign, verify };
