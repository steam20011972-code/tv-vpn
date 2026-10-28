'use strict';
// Package directory check shared by runtime/setup.cjs, runtime/launch.cjs and the Luna service (tools/build.cjs ships
// a copy of this file next to service/service.js). All run as root and must not run or copy anything from a directory
// others can change.
const fs = require('fs'),
  path = require('path');
const OPEN =
    fs.constants.O_RDONLY |
    (fs.constants.O_NOFOLLOW || 0) |
    (fs.constants.O_NONBLOCK || 0) |
    (fs.constants.O_NOCTTY || 0),
  PROC = '/proc/self/fd/';
function fail(code) {
  const e = Error(code);
  e.code = code;
  return e;
}
// The app directory is root-owned, but earlier packages (0.6.0 and older) put 0666/0777 modes in it, which the
// installer keeps, and devmode.sh makes everything under /media/developer 0777 at every boot. Before anything is
// copied from it: no symlinks, owner root, nothing writable by group or others (tightened here when the owner is
// right). A foreign owner or a link means the package cannot be trusted.
// The directories above are writable by everyone, so a checked path could be swapped before it is changed: each
// entry is opened without following a link, checked and tightened through that descriptor, and /proc/self/fd must
// show it at the expected path (not reached through a directory swapped for a link). Other errors (ENOENT) pass on.
function secureApp(dir, owner = 0) {
  const proc = fs.existsSync(PROC);
  if (fs.lstatSync(dir).isSymbolicLink()) throw fail('package-unsafe');
  (function walk(p) {
    // Only files and directories are opened: opening a device can have effects of its own.
    const l = fs.lstatSync(p);
    if (!(l.isFile() || l.isDirectory())) throw fail('package-unsafe');
    let fd;
    try {
      fd = fs.openSync(p, OPEN);
    } catch (e) {
      throw e.code === 'ELOOP' ? fail('package-unsafe') : e;
    }
    try {
      // A hard link would let a file from elsewhere pose as part of the package.
      const s = fs.fstatSync(fd);
      if (!(s.isFile() || s.isDirectory()) || s.uid !== owner || (!s.isDirectory() && s.nlink !== 1))
        throw fail('package-unsafe');
      if (proc && fs.readlinkSync(PROC + fd) !== p) throw fail('package-unsafe');
      // Windows (tests only) cannot fchmod a directory.
      if (s.mode & 0o022)
        if (process.platform === 'win32') fs.chmodSync(p, s.isDirectory() ? 0o755 : 0o644);
        else fs.fchmodSync(fd, s.isDirectory() ? 0o755 : 0o644);
      if (s.isDirectory()) for (const e of fs.readdirSync(p)) walk(path.join(p, e));
    } finally {
      fs.closeSync(fd);
    }
  })(fs.realpathSync(dir));
}
// devmode.sh runs chmod -R 777 /media/developer at every boot, the installed app and its Luna service with it, and
// until the next install anyone could change service.js, which runs as root. The boot hook runs after it and puts
// back the installer's modes: the app directory and the service beside it (usr/palm/applications/<id>,
// usr/palm/services/<id>.service). Each is left as it is when it fails secureApp; true for each that passed.
function securePackage(app, owner = 0) {
  return [app, path.join(app, '..', '..', 'services', path.basename(app) + '.service')].map((dir) => {
    try {
      secureApp(dir, owner);
      return true;
    } catch {
      return false;
    }
  });
}
module.exports = { secureApp, securePackage };
