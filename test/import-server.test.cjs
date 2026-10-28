const { test } = require('node:test'),
  assert = require('node:assert/strict');
const cp = require('child_process'),
  http = require('http'),
  path = require('path');
const SERVER = path.join(__dirname, '../runtime/import-server.cjs');
const { privateSource } = require(SERVER);
// Starts the listener on loopback the way the supervisor does; reply(text) plays the supervisor's import.
function start(reply = () => ({ added: 1, updated: 0, removed: 0, rejected: {} }), ttl) {
  const child = cp.fork(SERVER, ['127.0.0.1', ...(ttl ? [String(ttl)] : [])], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  child.texts = [];
  child.exited = new Promise((r) => child.on('exit', (code) => r(code)));
  child.on('message', (m) => {
    if (m.type === 'import') {
      child.texts.push(m.text);
      child.send({ type: 'result', id: m.id, result: reply(m.text) });
    }
  });
  child.ready = new Promise((resolve, reject) => {
    child.on('message', (m) => {
      if (m.type === 'listening') resolve(new URL(m.url));
    });
    child.on('exit', () => reject(Error('exited')));
  });
  return child;
}
// Default Accept-Language is a Russian phone's.
function request(url, { method = 'GET', body, lang = 'ru-RU,ru;q=0.9,en;q=0.8' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        agent: false,
        headers: {
          ...(lang ? { 'Accept-Language': lang } : {}),
          ...(body !== undefined ? { 'Content-Type': 'text/plain' } : {}),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (b) => (data += b));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const link = 'vless://00000000-0000-4000-8000-000000000001@192.0.2.10:8443?type=tcp#Secret%20name';

test('private sources only', () => {
  for (const ok of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.20', '127.0.0.1', '::ffff:192.168.1.5'])
    assert.equal(privateSource(ok), true, ok);
  for (const bad of [
    '8.8.8.8',
    '172.32.0.1',
    '100.64.0.1',
    '169.254.1.1',
    '::1',
    'fe80::1',
    '192.169.0.1',
    '',
    undefined,
  ])
    assert.equal(privateSource(bad), false, String(bad));
});
test('page needs the 128-bit token, is not cached and sends a strict CSP', async () => {
  const child = start(),
    url = await child.ready;
  assert.match(url.pathname, /^\/[0-9a-f]{32}$/);
  assert.equal((await request(new URL('/', url))).status, 404);
  assert.equal((await request(new URL('/' + '0'.repeat(32), url))).status, 404);
  const page = await request(url);
  assert.equal(page.status, 200);
  assert.match(page.body, /<textarea name="t"/);
  assert.match(page.body, /Добавить профиль/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);
  assert.match((await request(url, { lang: 'en-US,en' })).body, /Add a profile/);
  assert.equal((await request(url, { method: 'PUT' })).status, 405);
  child.kill();
  await child.exited;
});
test('a failed import keeps the page open and does not echo the text; a stored profile closes it for good', async () => {
  let n = 0;
  const child = start(() =>
      ++n === 1
        ? { added: 0, updated: 0, removed: 0, rejected: { 'unsupported-settings': 1 } }
        : { added: 2, updated: 0, removed: 0, rejected: {} }
    ),
    url = await child.ready;
  const first = await request(url, { method: 'POST', body: 't=' + link + '\r\n' });
  assert.equal(first.status, 200);
  assert.match(first.body, /Ничего не добавлено/);
  assert.match(first.body, /настройки не поддерживаются/);
  for (const secret of ['00000000-0000-4000-8000-000000000001', '192.0.2.10', 'Secret'])
    assert.ok(!first.body.includes(secret), secret);
  assert.equal(child.texts[0], link);
  const second = await request(url, { method: 'POST', body: link });
  assert.equal(second.status, 200);
  assert.match(second.body, /Добавлено: 2/);
  assert.equal(child.texts[1], link);
  assert.equal(await child.exited, 0);
  await assert.rejects(request(url));
});
test('bodies over 64 KB are refused without reaching the supervisor', async () => {
  const child = start(),
    url = await child.ready;
  const r = await request(url, { method: 'POST', body: 'x'.repeat(65537) }).catch((e) => ({ status: 'reset' }));
  assert.ok(r.status === 413 || r.status === 'reset');
  assert.equal(child.texts.length, 0);
  child.kill();
  await child.exited;
});
test('at most 10 requests a minute, wrong tokens included', async () => {
  const child = start(),
    url = await child.ready;
  for (let i = 0; i < 10; i++) assert.equal((await request(new URL('/x' + i, url))).status, 404);
  assert.equal((await request(url)).status, 429);
  child.kill();
  await child.exited;
});
test('closes itself when the time is up or the supervisor goes away', async () => {
  const timed = start(undefined, 1),
    url = await timed.ready;
  const t0 = Date.now();
  assert.equal(await timed.exited, 0);
  assert.ok(Date.now() - t0 < 3000);
  await assert.rejects(request(url));
  const orphan = start();
  await orphan.ready;
  orphan.disconnect();
  assert.equal(await orphan.exited, 0);
});
test('refuses to listen on a public address or without a supervisor', async () => {
  const child = cp.fork(SERVER, ['8.8.8.8'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  assert.equal(await new Promise((r) => child.on('exit', r)), 1);
  assert.notEqual(cp.spawnSync(process.execPath, [SERVER, '127.0.0.1']).status, 0);
});
test('the result page explains a link refused for turning off certificate checks', async () => {
  const child = start(() => ({ added: 0, updated: 0, removed: 0, rejected: { 'insecure-tls': 1 } })),
    url = await child.ready;
  const r = await request(url, { method: 'POST', body: 't=' + link + '\r\n', lang: 'en' });
  assert.match(r.body, /the link turns off certificate checks: the server could be impersonated/);
  child.kill();
  await child.exited;
});
