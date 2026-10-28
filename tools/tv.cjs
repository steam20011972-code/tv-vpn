'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('ssh2');
const HOST = process.env.TV_HOST;
function quote(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
function connect() {
  if (!HOST) throw new Error('Set TV_HOST to the TV LAN address');
  const keys = fs
    .readFileSync(path.join(os.homedir(), '.ssh/known_hosts'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.split(' ')[0].split(',').includes(HOST))
    .map((l) => l.split(' ')[2]);
  if (!keys.length) throw new Error('TV host key must already be trusted in known_hosts');
  if (!process.env.TV_SSH_PASSWORD) throw new Error('Set TV_SSH_PASSWORD for this process');
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c))
      .on('error', reject)
      .connect({
        host: HOST,
        port: 22,
        username: 'root',
        password: process.env.TV_SSH_PASSWORD,
        hostVerifier: (key) => keys.includes(key.toString('base64')),
        readyTimeout: 8000,
        keepaliveInterval: 5000,
      });
  });
}
async function run(command, input, quiet = false, keepOpen = false) {
  const c = await connect();
  return new Promise((resolve, reject) =>
    c.exec(command, (err, stream) => {
      if (err) {
        c.end();
        return reject(err);
      }
      let out = '',
        stderr = '';
      stream.on('data', (b) => {
        out += b;
        if (!quiet) process.stdout.write(b);
      });
      stream.stderr.on('data', (b) => {
        stderr += b;
        if (!quiet) process.stderr.write(b);
      });
      stream.on('close', (code) => {
        c.end();
        resolve({ code, out, stderr });
      });
      if (input) stream.end(input);
      else if (!keepOpen) stream.end();
    })
  );
}
async function upload(local, remote, mode = '600') {
  return run(`umask 077; cat > ${quote(remote)} && chmod ${mode} ${quote(remote)}`, fs.readFileSync(local));
}
module.exports = { connect, run, upload, quote };
if (require.main === module)
  (async () => {
    const [action, ...args] = process.argv.slice(2);
    let r;
    if (action === 'exec') r = await run(args.join(' '));
    else if (action === 'script') r = await run('sh -s', fs.readFileSync(args[0]));
    else if (action === 'upload') r = await upload(...args);
    else throw new Error('Usage: tv.cjs exec COMMAND | script LOCAL | upload LOCAL REMOTE [MODE]');
    process.exitCode = r.code || 0;
  })().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
