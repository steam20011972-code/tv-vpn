// Shell commands the app hands to Homebrew Channel exec, which runs them as root. Kept apart from app.js so that
// test/commands.test.cjs can check and run them. Only fixed words, checked ids and plain path characters get in.
(function (root) {
  'use strict';
  var BASE = '/media/developer/tv-vpn',
    PATH = /^\/[A-Za-z0-9._\/-]+$/;
  var CTL = [
    'start',
    'stop',
    'status',
    'set-autostart',
    'diagnostics',
    'restore-network',
    'profiles',
    'select',
    'delete',
    'import-begin',
    'import-status',
    'import-end',
    'import-usb',
    'refresh-subscription',
  ];
  function ctl(action, arg) {
    // Profile and subscription ids are the only free-form argument and are checked as strictly as in runtime/ctl.cjs.
    if (
      CTL.indexOf(action) < 0 ||
      (action === 'set-autostart'
        ? ['on', 'off'].indexOf(arg) < 0
        : ['select', 'delete', 'refresh-subscription'].indexOf(action) >= 0
          ? !/^[a-z0-9]{8,16}$/.test(arg || '')
          : !!arg)
    )
      return null;
    return '/usr/bin/node ' + BASE + '/runtime/ctl.cjs ' + action + (arg ? ' ' + arg : '');
  }
  // setup.cjs runs as root, so it must not come from a directory others can write: the webOS installer leaves app
  // directories 0777. Once installed, the root-only copy in BASE/runtime (0700) runs and gets the package as --app
  // (that copy carries the marker "setup:app-option"). Otherwise (first install, or an update from 0.6.1 or older)
  // the package's own copy runs, and only after root has removed group/other write from the whole app directory and
  // found every entry owned by root, no symlinks and no hard-linked files.
  function setup(appDir, action, arg, o) {
    o = o || {};
    var base = o.base || BASE,
      node = o.node || '/usr/bin/node',
      uid = o.uid === undefined ? 0 : o.uid;
    if (
      ['status', 'install', 'uninstall'].indexOf(action) < 0 ||
      (arg && ['keep-profile', 'delete-profile'].indexOf(arg) < 0)
    )
      return null;
    if (
      !PATH.test(appDir) ||
      /(^|\/)\.\.?(\/|$)/.test(appDir) ||
      !PATH.test(base) ||
      !PATH.test(node) ||
      !/^\d+$/.test(String(uid))
    )
      return null;
    var installed = base + '/runtime/setup.cjs',
      own = appDir + '/runtime/setup.cjs',
      args = ' ' + action + (arg ? ' ' + arg : '') + ' --app ' + appDir;
    return (
      'if grep -qs setup:app-option ' +
      installed +
      '; then exec ' +
      node +
      ' ' +
      installed +
      args +
      '; fi; ' +
      'chmod -R go-w ' +
      appDir +
      ' && [ -z "$(find ' +
      appDir +
      ' -type l)" ] && [ -z "$(find ' +
      appDir +
      ' | while read f; do ' +
      'if [ -d "$f" ]; then [ "$(stat -c %u "$f")" = ' +
      uid +
      ' ] || echo x; else [ "$(stat -c %u:%h "$f")" = ' +
      uid +
      ':1 ] || echo x; fi; done)" ] || ' +
      '{ echo \'{"ok":false,"error":"package-unsafe"}\'; exit 0; }; exec ' +
      node +
      ' ' +
      own +
      args
    );
  }
  var api = { BASE: BASE, ctl: ctl, setup: setup };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TVCommands = api;
})(this);
