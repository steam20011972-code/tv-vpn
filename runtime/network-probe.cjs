'use strict';
const dns = require('dns').promises,
  dgram = require('dgram'),
  crypto = require('crypto'),
  C = require('./common.cjs');
async function stun() {
  const addresses = await dns.resolve4('stun.l.google.com');
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4'),
      tx = crypto.randomBytes(12),
      b = Buffer.alloc(20);
    b.writeUInt16BE(1, 0);
    b.writeUInt32BE(0x2112a442, 4);
    tx.copy(b, 8);
    let finished = false;
    const done = (r) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.close();
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, reason: 'timeout' }), 7000);
    socket.on('error', () => done({ ok: false, reason: 'socket-error' }));
    socket.on('message', (m) => {
      if (m.length < 20 || !m.subarray(8, 20).equals(tx)) return;
      let ip = null;
      for (let i = 20; i + 4 <= m.length;) {
        const type = m.readUInt16BE(i),
          len = m.readUInt16BE(i + 2);
        if (type === 0x20 && len >= 8 && m[i + 5] === 1) {
          const n = (m.readUInt32BE(i + 8) ^ 0x2112a442) >>> 0;
          ip = [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
        }
        i += 4 + Math.ceil(len / 4) * 4;
      }
      done({ ok: !!ip, egressMatchesServer: ip === C.read('profile.json').outbound.server });
    });
    socket.send(b, 19302, addresses[0]);
  });
}
(async () => {
  const r = {};
  try {
    r.dns = (await dns.resolve4('www.wikipedia.org')).length > 0;
  } catch {
    r.dns = false;
  }
  try {
    r.udpStun = await stun();
  } catch {
    r.udpStun = { ok: false, reason: 'resolution-error' };
  }
  console.log(JSON.stringify(r));
})().catch(() => process.exit(1));
