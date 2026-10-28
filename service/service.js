'use strict';
// MEDZH VPN Luna service: the app calls luna://io.github.steam20011972code.tvvpn.service/<method>. Once Homebrew
// Channel's elevate-service has run, the service runs as root and the bus lets any client call it, so every method
// checks, in this order:
//   1. the caller is the MEDZH VPN app (message.sender), else "forbidden";
//   2. the service runs as root, else "not-elevated" (not elevated yet, or an app update reset the elevation);
//   3. the argument, against the same fixed values as runtime/ctl.cjs, else "invalid-action".
// It has no logic of its own: it runs the installed root-only runtime (BASE/runtime: ctl.cjs, setup.cjs) through
// execFile with an argument array, never a shell, and answers with the JSON line that program prints.
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process');
// tools/build.cjs places a copy of runtime/secure-app.cjs here.
const { secureApp } = require('./secure-app.cjs');
const APP_ID = 'io.github.steam20011972code.tvvpn',
  SERVICE_ID = APP_ID + '.service';
// The app's id up to 0.6.4. Luna refuses service names with "-", so the app moved to a new id; the old package
// stays installed beside it until removed, and opened, it would put its own components back over the new ones.
const LEGACY_ID = 'io.github.steam20011972-code.tvvpn';
// By absolute path: a bare name would first search node_modules in every parent directory, and the services
// directory above this one is writable by any user.
const WEBOS_SERVICE = '/usr/lib/node_modules/webos-service';
const DEFAULTS = {
  base: '/media/developer/tv-vpn',
  // The same package installs the app beside this service: usr/palm/applications/<id>, usr/palm/services/<id>.service.
  app: path.join(__dirname, '..', '..', 'applications', APP_ID),
  node: '/usr/bin/node',
  owner: 0,
};
// Luna method → runtime/ctl.cjs action.
const CTL = {
  status: 'status',
  start: 'start',
  stop: 'stop',
  restoreNetwork: 'restore-network',
  setAutostart: 'set-autostart',
  profiles: 'profiles',
  select: 'select',
  delete: 'delete',
  importBegin: 'import-begin',
  importStatus: 'import-status',
  importEnd: 'import-end',
  importUsb: 'import-usb',
  refreshSubscription: 'refresh-subscription',
  diagnostics: 'diagnostics',
};
// Luna method → runtime/setup.cjs action.
const SETUP = { setupStatus: 'status', setupInstall: 'install', setupUninstall: 'uninstall' };
const METHODS = Object.keys(CTL).concat(Object.keys(SETUP));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// The method's argument as ctl.cjs or setup.cjs takes it, or null when it is missing or not an allowed value:
//   setAutostart {enabled: boolean} → on | off;
//   select, delete, refreshSubscription {id}: a profile or subscription id, [a-z0-9]{8,16};
//   setupUninstall {deleteProfile: boolean} → delete-profile | keep-profile.
// Other methods take nothing. Other payload fields are ignored: nothing else reaches the command line.
function argv(method, payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  if (method === 'setAutostart') return typeof p.enabled === 'boolean' ? [p.enabled ? 'on' : 'off'] : null;
  if (['select', 'delete', 'refreshSubscription'].includes(method))
    return typeof p.id === 'string' && /^[a-z0-9]{8,16}$/.test(p.id) ? [p.id] : null;
  if (method === 'setupUninstall')
    return typeof p.deleteProfile === 'boolean' ? [p.deleteProfile ? 'delete-profile' : 'keep-profile'] : null;
  return [];
}
function fail(code) {
  const e = Error(code);
  e.code = code;
  return e;
}
// Whether BASE holds an installed runtime that only root can change: BASE root's and not a link, and the runtime
// directory passing the same check as a package. False when there is none (not installed yet, or an install has
// moved it aside); unsafe-base when it is someone else's.
function installed(o) {
  try {
    const s = fs.lstatSync(o.base);
    if (s.isSymbolicLink() || s.uid !== o.owner) throw fail('unsafe-base');
    secureApp(path.join(o.base, 'runtime'), o.owner);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw fail('unsafe-base');
  }
}
function marked(file) {
  try {
    return fs.readFileSync(file, 'utf8').includes('setup:app-option');
  } catch {
    return false;
  }
}
// Runs node with an argument array (no shell) and takes the last line it prints, which must be a JSON object with a
// boolean ok. Anything else becomes ok:false with the fallback code.
function run(args, timeout, fallback, o) {
  return new Promise((resolve) => {
    (o.execFile || cp.execFile)(o.node, args, { timeout, maxBuffer: 1 << 20 }, (err, stdout) => {
      let r = null;
      try {
        r = JSON.parse(
          String(stdout || '')
            .trim()
            .split('\n')
            .pop()
        );
      } catch {}
      resolve(r && typeof r === 'object' && typeof r.ok === 'boolean' ? r : { ok: false, error: fallback });
    });
  });
}
function ctl(method, args, fallback, o) {
  if (!installed(o)) return { ok: false, error: fallback };
  const action = CTL[method];
  // ctl.cjs gives up on the controller after 15 s, or 60 s for downloads (USB file, subscription).
  const timeout = ['import-usb', 'refresh-subscription'].includes(action) ? 75000 : 30000;
  return run([path.join(o.base, 'runtime', 'ctl.cjs'), action, ...args], timeout, fallback, o);
}
// The installed copy once there is one: it carries the marker "setup:app-option" and takes the package as --app.
// Before that (first install, or components from 0.6.1 or older) the package's own copy, and only after the package
// directory passed secureApp. Install and uninstall get no time limit: they stop the controller and move
// BASE/runtime aside, and cut short they would leave it there.
function setup(method, args, fallback, o) {
  const action = SETUP[method],
    copy = path.join(o.base, 'runtime', 'setup.cjs');
  let script = copy;
  if (!installed(o) || !marked(copy)) {
    try {
      secureApp(o.app, o.owner);
    } catch {
      return { ok: false, error: 'package-unsafe' };
    }
    script = path.join(o.app, 'runtime', 'setup.cjs');
  }
  return run([script, action, ...args, '--app', o.app], action === 'status' ? 30000 : 0, fallback, o);
}
// Before installing components: the package with the old id goes, through the system installer, so that it cannot
// install its components again. Profiles, settings and the boot hook live in BASE and are kept.
async function removeLegacy(o) {
  const dir = path.join(path.dirname(o.app), LEGACY_ID),
    gone = () => !fs.existsSync(dir);
  if (gone()) return;
  await o.removeApp(LEGACY_ID, gone);
  if (!gone()) throw fail('legacy-remove-failed');
}
// appInstallService/dev/remove, the call that removes developer-mode and Homebrew apps along with their Luna files.
// Done when the directory is gone, the installer reports an error, or after 60 s.
function devRemove(id, gone) {
  return new Promise((resolve) => {
    const sub = service.subscribe('luna://com.webos.appInstallService/dev/remove', { id, subscribe: true }),
      poll = setInterval(() => gone() && end(), 500),
      timer = setTimeout(end, 60000);
    function end() {
      clearInterval(poll);
      clearTimeout(timer);
      sub.cancel();
      resolve();
    }
    sub.on('response', (m) => (gone() || (m.payload && m.payload.returnValue === false)) && end());
    sub.on('cancel', end);
  });
}
// One install or uninstall at a time: each stops the controller and replaces BASE/runtime.
let queue = Promise.resolve();
function serial(fn) {
  const next = queue.then(fn);
  queue = next.catch(() => {});
  return next;
}
// One call: the answer, {ok: true, …} or {ok: false, error}. Never rejects. Options are for tests only.
async function handle(method, sender, payload, options) {
  const o = Object.assign({}, DEFAULTS, options);
  if (sender !== APP_ID) return { ok: false, error: 'forbidden' };
  const uid = o.uid !== undefined ? o.uid : process.getuid ? process.getuid() : -1;
  if (uid !== 0) return { ok: false, error: 'not-elevated' };
  const args = own(CTL, method) || own(SETUP, method) ? argv(method, payload) : null;
  if (!args) return { ok: false, error: 'invalid-action' };
  const fallback = own(CTL, method)
    ? 'controller-error'
    : method === 'setupUninstall'
      ? 'uninstall-failed'
      : 'install-failed';
  try {
    if (own(CTL, method)) return await ctl(method, args, fallback, o);
    if (method === 'setupStatus') return await setup(method, args, fallback, o);
    if (method === 'setupInstall')
      return await serial(async () => {
        await removeLegacy(o);
        return setup(method, args, fallback, o);
      });
    return await serial(() => setup(method, args, fallback, o));
  } catch (e) {
    return { ok: false, error: ['unsafe-base', 'legacy-remove-failed'].includes(e.code) ? e.code : fallback };
  }
}
const Service = require(WEBOS_SERVICE),
  service = new Service(SERVICE_ID);
DEFAULTS.removeApp = devRemove;
// What the service does after answering not-elevated (replaced in tests).
const life = { quit: () => process.exit(0) };
for (const method of METHODS)
  service.register(method, (message) =>
    handle(method, message.sender, message.payload)
      .then((r) => {
        message.respond(Object.assign({}, r, { returnValue: r.ok === true }));
        // elevate-service changes how the bus starts this service but leaves a running one as it is, and the bus
        // keeps it for 5 s after each call. Leaving now lets the app's next call, after it has elevated the service,
        // start it again as root.
        if (r.error === 'not-elevated') setTimeout(() => life.quit(), 100);
      })
      // The caller may be gone; nothing else is left to do.
      .catch(() => {})
  );
module.exports = { APP_ID, SERVICE_ID, LEGACY_ID, METHODS, argv, handle, life };
