'use strict';
// Signed package manifest. tools/build.cjs lists the SHA256 of every file that root later runs or trusts
// (runtime/, core/, core.lock.json, appinfo.json) in manifest.json and signs those exact bytes with the release key
// (Ed25519) into manifest.sig. setup.cjs checks the signature with the key below before copying anything, then
// checks each copied file again. The key that counts is the one in the copy already installed in BASE (root only).
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
function manifest(app, version) {
  const files = {};
  for (const f of covered(app)) files[f] = sha(fs.readFileSync(path.join(app, f)));
  return Buffer.from(JSON.stringify({ version, files }) + '\n');
}
function sign(bytes, privateKeyPem) {
  return crypto.sign(null, bytes, privateKeyPem).toString('base64') + '\n';
}
function fail(code) {
  const e = Error(code);
  e.code = code;
  return e;
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
  const files = JSON.parse(bytes.toString('utf8')).files || {};
  // Every covered file must be listed with the same content, and nothing listed may be missing.
  const present = covered(app);
  if (
    present.length !== Object.keys(files).length ||
    present.some((f) => files[f] !== sha(fs.readFileSync(path.join(app, f))))
  )
    throw fail('package-mismatch');
  return files;
}
module.exports = { PUBLIC_KEY, sha, covered, manifest, sign, verify };
