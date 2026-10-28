'use strict';
// Package directory check shared by runtime/setup.cjs and the Luna service (tools/build.cjs ships a copy of this file
// next to service/service.js). Both run as root and must not run or copy anything from a directory others can change.
const fs = require('fs'),
  path = require('path');
function fail(code) {
  const e = Error(code);
  e.code = code;
  return e;
}
// The app directory is root-owned, but earlier packages (0.6.0 and older) put 0666/0777 modes in it, which the
// installer keeps. Before anything is copied from it: no symlinks, owner root, nothing writable by group or others
// (tightened here when the owner is right). A foreign owner or a link means the package cannot be trusted.
function secureApp(dir, owner = 0) {
  (function walk(p) {
    // A hard link would let a file from elsewhere pose as part of the package.
    const s = fs.lstatSync(p);
    if (s.isSymbolicLink() || s.uid !== owner || (!s.isDirectory() && s.nlink !== 1)) throw fail('package-unsafe');
    if (s.mode & 0o022) fs.chmodSync(p, s.isDirectory() ? 0o755 : 0o644);
    if (s.isDirectory()) for (const e of fs.readdirSync(p)) walk(path.join(p, e));
  })(dir);
}
module.exports = { secureApp };
