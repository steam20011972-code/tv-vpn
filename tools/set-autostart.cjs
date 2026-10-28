'use strict';
const { upload, run } = require('./tv.cjs');
(async () => {
  const value = process.argv[2];
  if (!['on', 'off'].includes(value)) throw Error('Usage: node tools/set-autostart.cjs on|off');
  const mkdir = await run('mkdir -p /var/lib/webosbrew/init.d', null, true);
  if (mkdir.code) throw Error('Cannot create hook directory');
  const put = await upload('runtime/70-tv-vpn', '/var/lib/webosbrew/init.d/70-tv-vpn', '700');
  if (put.code) throw Error('Cannot install hook');
  const result = await run('/usr/bin/node /media/developer/tv-vpn/runtime/ctl.cjs set-autostart ' + value, null, true);
  if (result.code || !JSON.parse(result.out).ok) throw Error('Cannot save autostart preference');
  console.log('Autostart: ' + value);
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
