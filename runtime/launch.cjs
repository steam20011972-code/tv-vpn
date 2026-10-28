'use strict';
const C = require('./common.cjs');
// The package the components came from, as setup.cjs recorded it; its modes go back to the installer's at boot.
if (process.argv[2] === 'boot') {
  const app = (C.read('installed.json') || {}).app;
  if (typeof app === 'string' && require('path').isAbsolute(app)) require('./secure-app.cjs').securePackage(app);
}
const old = C.read('run/supervisor.json');
if (old && C.ownedProcess(old.pid, old.identity, C.BASE + '/runtime/supervisor.cjs')) {
  if (process.argv[2] === 'resume') {
    let hb = 0;
    try {
      hb = Number(C.fs.readFileSync(C.RUN + '/heartbeat', 'utf8'));
    } catch {}
    if (require('os').uptime() - hb > 12) C.killOwned(old.pid, old.identity, C.BASE + '/runtime/supervisor.cjs');
    else process.exit(0);
  } else process.exit(0);
}
const log = C.fs.openSync(C.RUN + '/controller.log', 'w', 0o600);
const child = C.cp.spawn('/usr/bin/node', [C.BASE + '/runtime/supervisor.cjs', process.argv[2] || 'manual'], {
  detached: true,
  stdio: ['ignore', log, log],
});
C.fs.closeSync(log);
child.unref();
