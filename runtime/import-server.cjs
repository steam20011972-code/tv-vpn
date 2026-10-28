'use strict';
// One-shot LAN listener for adding profiles from a phone: import-server.cjs <TV LAN IPv4> [ttl seconds].
// Forked by the supervisor with an IPC channel. It touches neither the profile store nor routing:
// the pasted text goes to the supervisor, which imports it and answers with counters only.
// Open at most TTL (5 min), closed after the first import that stored a profile, gone with the supervisor.
// Plain HTTP inside the LAN; the 128-bit token in the URL is the only credential.
const http = require('http'),
  crypto = require('crypto');
const host = process.argv[2],
  TTL = Math.min(Number(process.argv[3]) || 300, 300) * 1000,
  MAX_BODY = 65536,
  RATE = 10;
const token = crypto.randomBytes(16).toString('hex'),
  expiresAt = Date.now() + TTL,
  recent = [];
let busy = false,
  seq = 0;
const waiting = new Map();
// Forked by the root supervisor. Once the socket is bound it needs no privilege, so it gives up root for a uid and
// gid that no account or running process on the TV had (2026-10-28: accounts up to 7010, jailed apps 5261–7010);
// the socket and the IPC channel stay open. It answers nothing before that.
const UNPRIVILEGED = 65532;
function dropRoot(p = process) {
  if (!p.getuid || p.getuid() !== 0) return;
  p.setgroups([]);
  p.setgid(UNPRIVILEGED);
  p.setuid(UNPRIVILEGED);
  if (p.getuid() !== UNPRIVILEGED || p.getgid() !== UNPRIVILEGED) throw Error('still privileged');
}
function privateSource(address) {
  const m = String(address)
    .replace(/^::ffff:/, '')
    .match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!m) return false;
  const a = Number(m[1]),
    b = Number(m[2]);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
const T = {
  ru: {
    title: 'Добавить профиль',
    lead: 'Вставьте ссылку (vless, vmess, trojan, ss, hysteria2, tuic), несколько ссылок или адрес подписки.',
    add: 'Добавить',
    note: 'Данные идут по домашней сети без шифрования. Страница работает до 5 минут и только добавляет профили.',
    done: 'Готово',
    doneText: 'Можно закрыть страницу: профили уже на телевизоре.',
    none: 'Ничего не добавлено',
    again: 'Попробовать ещё раз',
    added: 'Добавлено',
    updated: 'Обновлено',
    rejected: 'Отклонено',
    busy: 'Телевизор ещё обрабатывает прошлый запрос. Повторите через несколько секунд.',
    failed: 'Не удалось сохранить профили.',
    reasons: {
      'invalid-link': 'ошибка в ссылке',
      'unsupported-protocol': 'протокол пока не поддерживается',
      'unsupported-settings': 'такие настройки не поддерживаются',
      'unsupported-by-core': 'не поддерживается sing-box (xhttp, kcp и т. п.)',
      'insecure-tls': 'ссылка отключает проверку сертификата — сервер можно подменить',
      'unrecognized-format': 'непонятный формат',
      'subscription-failed': 'подписка не загрузилась',
      'subscription-empty': 'в подписке нет подходящих профилей',
      'subscription-no-data': 'сервер подписки вернул пустой ответ',
      'too-large': 'слишком много текста',
      'too-many': 'слишком много ссылок',
      empty: 'пустой текст',
    },
  },
  en: {
    title: 'Add a profile',
    lead: 'Paste a link (vless, vmess, trojan, ss, hysteria2, tuic), several links or a subscription URL.',
    add: 'Add',
    note: 'Data travels over your home network unencrypted. This page works for up to 5 minutes and can only add profiles.',
    done: 'Done',
    doneText: 'You can close this page: the profiles are on the TV.',
    none: 'Nothing was added',
    again: 'Try again',
    added: 'Added',
    updated: 'Updated',
    rejected: 'Rejected',
    busy: 'The TV is still handling the previous request. Try again in a few seconds.',
    failed: 'Could not save the profiles.',
    reasons: {
      'invalid-link': 'malformed link',
      'unsupported-protocol': 'protocol not supported yet',
      'unsupported-settings': 'settings not supported',
      'unsupported-by-core': 'not supported by sing-box (xhttp, kcp, etc.)',
      'insecure-tls': 'the link turns off certificate checks: the server could be impersonated',
      'unrecognized-format': 'unrecognized format',
      'subscription-failed': 'subscription did not load',
      'subscription-empty': 'no usable profiles in the subscription',
      'subscription-no-data': 'the subscription server returned an empty response',
      'too-large': 'too much text',
      'too-many': 'too many links',
      empty: 'empty text',
    },
  },
};
// First listed language we have, English otherwise: the same rule as the TV app (app/i18n.js).
function language(header) {
  for (const part of String(header || '').split(',')) {
    const m = /^\s*([a-z]{2})(?![a-z])/i.exec(part);
    if (m && T[m[1].toLowerCase()]) return m[1].toLowerCase();
  }
  return 'en';
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
function page(t, body) {
  return (
    '<!doctype html><html lang="' +
    (t === T.ru ? 'ru' : 'en') +
    '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MEDZH VPN</title><style>' +
    'body{margin:0;font:17px/1.45 system-ui,sans-serif;background:#0b1220;color:#eef3ff}main{max-width:560px;' +
    'margin:0 auto;padding:24px 16px}h1{font-size:24px;margin:0 0 8px}' +
    'textarea{box-sizing:border-box;width:100%;min-height:180px;margin:16px 0;padding:12px;border-radius:12px;' +
    'border:1px solid #33415c;background:#111b2e;color:inherit;font:15px/1.4 ui-monospace,monospace}' +
    'button,a.button{display:block;width:100%;box-sizing:border-box;padding:14px;border:0;border-radius:12px;' +
    'background:#1a74f0;color:#fff;font:600 17px system-ui,sans-serif;text-align:center;text-decoration:none}' +
    '.note{color:#9fb0cc;font-size:14px}ul{padding-left:20px}.brand{color:#9fb0cc;font-size:13px;' +
    'letter-spacing:.08em}</style></head><body><main><div class="brand">MEDZH VPN</div>' +
    body +
    '</main></body></html>'
  );
}
function form(t) {
  return page(
    t,
    '<h1>' +
      esc(t.title) +
      '</h1><p>' +
      esc(t.lead) +
      '</p><form method="post" enctype="text/plain"><textarea name="t" required autofocus spellcheck="false" ' +
      'autocomplete="off" autocapitalize="off"></textarea><button>' +
      esc(t.add) +
      '</button></form><p class="note">' +
      esc(t.note) +
      '</p>'
  );
}
function report(t, r) {
  const stored = (r.added || 0) + (r.updated || 0),
    reasons = Object.keys(r.rejected || {}),
    rejected = reasons.reduce((n, k) => n + r.rejected[k], 0);
  let body =
    '<h1>' +
    esc(stored ? t.done : t.none) +
    '</h1><ul><li>' +
    esc(t.added) +
    ': ' +
    (r.added || 0) +
    '</li>' +
    (r.updated ? '<li>' + esc(t.updated) + ': ' + r.updated + '</li>' : '') +
    (rejected
      ? '<li>' +
        esc(t.rejected) +
        ': ' +
        rejected +
        ' (' +
        reasons.map((k) => esc((t.reasons[k] || k) + (r.rejected[k] > 1 ? ' ×' + r.rejected[k] : ''))).join(', ') +
        ')</li>'
      : '') +
    '</ul>';
  body += stored
    ? '<p>' + esc(t.doneText) + '</p>'
    : '<a class="button" href="/' + token + '">' + esc(t.again) + '</a>';
  return page(t, body);
}
function send(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    Connection: 'close',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  });
  res.end(html);
}
// Text forms arrive as "t=<value>\r\n"; a raw body (curl) is taken as is.
function text(body) {
  return body.startsWith('t=') ? body.slice(2).replace(/\r?\n$/, '') : body;
}
function ask(value) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(Error('timeout'));
    }, 60000);
    waiting.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    process.send({ type: 'import', id, text: value });
  });
}
process.on('message', (m) => {
  if (m && m.type === 'result' && waiting.has(m.id)) {
    const done = waiting.get(m.id);
    waiting.delete(m.id);
    done(m.result);
  }
});
const server = http.createServer((req, res) => {
  if (!privateSource(req.socket.remoteAddress)) {
    req.socket.destroy();
    return;
  }
  const now = Date.now();
  while (recent.length && now - recent[0] > 60000) recent.shift();
  if (recent.length >= RATE) {
    res.writeHead(429, { 'Retry-After': '60', Connection: 'close' });
    res.end();
    req.socket.destroy();
    return;
  }
  recent.push(now);
  const t = T[language(req.headers['accept-language'])];
  if (req.url !== '/' + token) {
    res.writeHead(404, { Connection: 'close' });
    res.end();
    return;
  }
  if (req.method === 'GET') return send(res, 200, form(t));
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'GET, POST', Connection: 'close' });
    res.end();
    return;
  }
  if (busy) return send(res, 503, page(t, '<p>' + esc(t.busy) + '</p>'));
  busy = true;
  const chunks = [];
  let size = 0,
    over = false;
  req.on('data', (b) => {
    size += b.length;
    if (size > MAX_BODY) {
      over = true;
      busy = false;
      send(res, 413, report(t, { rejected: { 'too-large': 1 } }));
      req.socket.destroy();
    } else chunks.push(b);
  });
  req.on('end', async () => {
    if (over) return;
    try {
      const r = await ask(text(Buffer.concat(chunks).toString('utf8')));
      busy = false;
      if (r.error) return send(res, 500, page(t, '<p>' + esc(t.failed) + '</p>'));
      send(res, 200, report(t, r));
      // Single use: once something is stored the token dies with the process.
      if (r.added || r.updated)
        res.on('finish', () => {
          server.close();
          setTimeout(() => process.exit(0), 200);
        });
    } catch {
      busy = false;
      send(res, 500, page(t, '<p>' + esc(t.failed) + '</p>'));
    }
  });
});
server.headersTimeout = 15000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 1000;
if (require.main === module) {
  if (!process.send || !privateSource(host)) {
    console.error('import-server: needs an IPC parent and a private LAN IPv4 address');
    process.exit(1);
  }
  const parent = process.ppid;
  server.on('error', () => {
    try {
      process.send({ type: 'error' });
    } catch {}
    process.exit(1);
  });
  server.listen(0, host, () => {
    try {
      dropRoot();
    } catch {
      server.emit('error', Error('drop-root'));
      return;
    }
    process.send({ type: 'listening', url: 'http://' + host + ':' + server.address().port + '/' + token, expiresAt });
  });
  setTimeout(() => process.exit(0), TTL).unref();
  process.on('disconnect', () => process.exit(0));
  setInterval(() => {
    if (process.ppid !== parent) process.exit(0);
  }, 1000).unref();
}
module.exports = { UNPRIVILEGED, dropRoot, privateSource, language, T };
