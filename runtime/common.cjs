'use strict';
const fs = require('fs'),
  cp = require('child_process'),
  path = require('path');
const BASE = process.env.TVVPN_HOME || '/media/developer/tv-vpn',
  RUN = BASE + '/run';
const HOOK = (process.env.TVVPN_HOOK_DIR || '/var/lib/webosbrew/init.d') + '/70-tv-vpn';
fs.mkdirSync(RUN, { recursive: true, mode: 0o700 });
function read(name, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(BASE + '/' + name, 'utf8'));
  } catch {
    return fallback;
  }
}
// The temporary file is created fresh (wx): a file or link left under its name is removed, never written through.
function write(name, value) {
  const p = BASE + '/' + name;
  try {
    fs.unlinkSync(p + '.tmp');
  } catch {}
  fs.writeFileSync(p + '.tmp', JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  fs.renameSync(p + '.tmp', p);
}
function command(exe, args, allow = false) {
  try {
    return cp
      .execFileSync(exe, args, {
        encoding: 'utf8',
        timeout: 4000,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      .trim();
  } catch (e) {
    if (allow) return '';
    throw Error(exe + ' failed');
  }
}
// A yes/no check such as sing-box check, without blocking the event loop: resolves true when the program exits 0 and
// false when it exits with another code. Rejects when there is no answer (timed out, killed, did not start): after
// boot the TV can be slow enough for that, and it says nothing about what was checked.
function verdict(exe, args, timeout = 30000) {
  return new Promise((resolve, reject) =>
    cp.execFile(exe, args, { timeout, maxBuffer: 1024 * 1024 }, (e) => {
      if (!e) resolve(true);
      else if (typeof e.code === 'number') resolve(false);
      else reject(Error(exe + ' gave no answer'));
    })
  );
}
function processIdentity(pid) {
  try {
    const s = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    return s.slice(s.lastIndexOf(')') + 2).split(' ')[19];
  } catch {
    return null;
  }
}
function ownedProcess(pid, id, needle) {
  try {
    return id && processIdentity(pid) === id && fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').includes(needle);
  } catch {
    return false;
  }
}
function killOwned(pid, id, needle) {
  if (!ownedProcess(pid, id, needle)) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {}
  command('sleep', ['0.3'], true);
  if (ownedProcess(pid, id, needle))
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
}
function rules() {
  return command('ip', ['-4', 'rule', 'show']).split('\n').filter(Boolean);
}
function preferences() {
  return read('preferences.json', { autostart: false, desired: false });
}
function dnsProperties(service) {
  const s = command('connmanctl', ['services', service]);
  const m = s.match(/Nameservers\.Configuration\s*=\s*\[([^\]]*)\]/);
  if (!m) throw Error('Cannot read configured DNS');
  return m[1].split(/[,\s]+/).filter(Boolean);
}
function service() {
  const s = command('connmanctl', ['services']);
  const line = s.split('\n').find((l) => /^\*A[OR]/.test(l));
  const id = line && line.trim().split(/\s+/).pop();
  if (!id || !/^(wifi|ethernet)_[a-zA-Z0-9_]+$/.test(id)) throw Error('No active ConnMan service');
  return id;
}
// /media/developer is world-writable on the TV, so a BASE created there by anyone else (or a link) would hand our
// profiles and root-run runtime to its owner. Running as root, refuse a BASE that root does not own.
function checkBase() {
  if (!process.getuid || process.getuid() !== 0) return;
  const s = fs.lstatSync(BASE);
  if (s.isSymbolicLink() || !s.isDirectory() || s.uid !== 0)
    throw Object.assign(Error('unsafe-base'), { code: 'unsafe-base' });
}
// Files created earlier were observed as 0777 on the TV; restore private modes for our own paths.
function harden() {
  checkBase();
  for (const [p, mode] of [
    ['', 0o700],
    ['/bin', 0o700],
    ['/bin/sing-box', 0o700],
    ['/bin/LICENSE', 0o600],
    ['/runtime', 0o700],
    ['/run', 0o700],
    ['/profile.json', 0o600],
    ['/config.json', 0o600],
    ['/preferences.json', 0o600],
    ['/installed.json', 0o600],
    ['/device-id', 0o600],
    ['/profiles', 0o700],
  ])
    try {
      fs.chmodSync(BASE + p, mode);
    } catch {}
  try {
    for (const f of fs.readdirSync(BASE + '/profiles'))
      if (f.endsWith('.json')) fs.chmodSync(BASE + '/profiles/' + f, 0o600);
  } catch {}
  // Logs, heartbeat and leases in run/ (devmode.sh leaves them 0777 after a boot): plain files only, never through
  // a link.
  try {
    for (const f of fs.readdirSync(RUN)) if (fs.lstatSync(RUN + '/' + f).isFile()) fs.chmodSync(RUN + '/' + f, 0o600);
  } catch {}
}
function log(event) {
  const p = RUN + '/events.log';
  try {
    if (fs.existsSync(p) && fs.statSync(p).size > 65536) {
      try {
        fs.unlinkSync(p + '.1');
      } catch {}
      fs.renameSync(p, p + '.1');
    }
    fs.appendFileSync(p, new Date().toISOString() + ' ' + event + '\n', { mode: 0o600 });
  } catch {}
}
function cleanup() {
  let lock = false;
  try {
    fs.mkdirSync(RUN + '/recovery.lock');
    lock = true;
  } catch {
    const owner = read('run/recovery.lock/owner.json');
    if (owner && processIdentity(owner.pid) === owner.identity) return false;
    try {
      if (!owner && Date.now() - fs.statSync(RUN + '/recovery.lock').mtimeMs < 5000) return false;
      fs.rmSync(RUN + '/recovery.lock', { recursive: true, force: true });
      fs.mkdirSync(RUN + '/recovery.lock');
      lock = true;
    } catch {
      return false;
    }
  }
  write('run/recovery.lock/owner.json', { pid: process.pid, identity: processIdentity(process.pid) });
  try {
    const lease = read('run/lease.json');
    if (!lease) return true;
    let ok = true;
    killOwned(lease.corePid, lease.coreIdentity, BASE + '/bin/sing-box');
    if (lease.reserved)
      for (const pid of command('pidof', ['sing-box'], true).split(/\s+/).filter(Boolean)) {
        try {
          const cmd = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8');
          if (cmd.includes(BASE + '/bin/sing-box') && cmd.includes(BASE + '/config.json'))
            killOwned(Number(pid), processIdentity(pid), BASE + '/bin/sing-box');
        } catch {}
      }
    if (lease.dns) {
      try {
        const current = dnsProperties(lease.dns.service);
        if (current.length === 1 && current[0] === (lease.dns.target || '172.30.247.2'))
          command('connmanctl', ['config', lease.dns.service, '--nameservers', ...lease.dns.previous]);
      } catch {
        ok = false;
      }
    }
    if (lease.reserved) {
      try {
        const normalize = (l) =>
          l
            .replace(/\[(?:detached|unresolved)\]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        const current = rules().filter((l) => parseInt(l) >= 18000 && parseInt(l) < 18100);
        // A killed TUN leaves [detached]/[unresolved] annotations which are not valid selectors.
        // Delete by priority only after every rule sharing that priority matches our lease.
        for (const priority of [...new Set(current.map((l) => parseInt(l)))]) {
          const group = current.filter((l) => parseInt(l) === priority);
          if (lease.rules && group.some((l) => !lease.rules.some((saved) => normalize(saved) === normalize(l)))) {
            ok = false;
            continue;
          }
          for (const line of group) command('ip', ['-4', 'rule', 'del', 'priority', String(priority)]);
        }
      } catch {
        ok = false;
      }
      // This table and interface were verified empty before the lease was acquired.
      command('ip', ['-4', 'route', 'flush', 'table', '20220'], true);
      command('ip', ['link', 'del', 'tvvpn0'], true);
    }
    if (lease.ipv6) {
      for (const prefix of ['::/1', '8000::/1'])
        command('ip', ['-6', 'route', 'del', 'unreachable', prefix, 'metric', '42760', 'proto', '186'], true);
    }
    if (ok) {
      try {
        fs.unlinkSync(RUN + '/lease.json');
      } catch {}
      log('network-restored');
    }
    return ok;
  } finally {
    if (lock)
      try {
        fs.rmSync(RUN + '/recovery.lock', { recursive: true, force: true });
      } catch {}
  }
}
// The package setup.cjs recorded has no appinfo.json: the app was removed from the TV's app menu without "Remove MEDZH
// VPN completely", which leaves BASE and the boot hook behind.
function appRemoved() {
  const app = (read('installed.json') || {}).app;
  return typeof app === 'string' && path.isAbsolute(app) && !fs.existsSync(app + '/appinfo.json');
}
module.exports = {
  fs,
  cp,
  BASE,
  RUN,
  HOOK,
  read,
  write,
  command,
  verdict,
  processIdentity,
  ownedProcess,
  killOwned,
  rules,
  preferences,
  dnsProperties,
  service,
  checkBase,
  harden,
  log,
  cleanup,
  appRemoved,
};
