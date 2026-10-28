const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('fs'),
  path = require('path');
const I18N = require('../app/i18n.js'),
  { language, T } = require('../runtime/import-server.cjs');
const app = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8'),
  html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
const shape = (o) =>
  Object.keys(o)
    .sort()
    .map((k) =>
      typeof o[k] === 'string'
        ? k
        : k + ':' + (Array.isArray(o[k]) && typeof o[k][0] === 'string' ? 'list' : shape(o[k]))
    )
    .join(',');

test('Russian and English have the same keys', () => {
  const { ru, en } = I18N.messages;
  assert.equal(shape(ru), shape(en));
  for (const k of Object.keys(ru.states)) assert.equal(ru.states[k].length, en.states[k].length, k);
});
test('every key the app uses exists', () => {
  const used = new Set();
  for (const m of app.matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
  // Keys picked by a ternary inside t(...): t(x?'a.b':'c.d').
  for (const m of app.matchAll(/\?'(\w+\.[\w.]+)':'(\w+\.[\w.]+)'/g)) {
    used.add(m[1]);
    used.add(m[2]);
  }
  for (const m of html.matchAll(/data-i18n(?:-aria)?="([\w.]+)"/g)) used.add(m[1]);
  for (const m of app.matchAll(/\['(import\.step\d)'/g)) used.add(m[1]);
  assert.ok(used.size > 60, 'found ' + used.size);
  for (const lang of ['ru', 'en'])
    for (const k of used) assert.equal(typeof I18N.messages[lang][k], 'string', lang + ' ' + k);
});
test('all visible text goes through i18n', () => {
  assert.doesNotMatch(app, /[А-Яа-яЁё]/);
  assert.doesNotMatch(html, /[А-Яа-яЁё]/);
});
test('the phone page uses the same rejection reasons and language rule', () => {
  for (const lang of ['ru', 'en']) assert.deepEqual(T[lang].reasons, I18N.messages[lang].reasons, lang);
  for (const [list, want] of [
    [['ru-RU'], 'ru'],
    [['en-US'], 'en'],
    [['de-DE', 'ru'], 'ru'],
    [['de-DE', 'fr'], 'en'],
    [['russian'], 'en'],
    [[''], 'en'],
    [['RU'], 'ru'],
    [['en-GB', 'ru-RU'], 'en'],
  ]) {
    assert.equal(I18N.pick(list), want, list.join());
    assert.equal(language(list.join(',')), want, list.join());
  }
  assert.equal(language(undefined), 'en');
  assert.equal(language('ru-RU,ru;q=0.9,en;q=0.8'), 'ru');
});
test('substitution and plurals', () => {
  const ru = I18N.create('ru'),
    en = I18N.create('en');
  assert.equal(ru.t('sub.name', { n: 2 }), 'Подписка 2');
  assert.equal(en.t('sub.name', { n: 2 }), 'Subscription 2');
  assert.deepEqual(
    [1, 2, 5, 11, 12, 21, 22, 25, 111].map((n) => ru.plural(n, 'profile')),
    [
      '1 профиль',
      '2 профиля',
      '5 профилей',
      '11 профилей',
      '12 профилей',
      '21 профиль',
      '22 профиля',
      '25 профилей',
      '111 профилей',
    ]
  );
  assert.deepEqual(
    [0, 1, 2].map((n) => en.plural(n, 'profile')),
    ['0 profiles', '1 profile', '2 profiles']
  );
  assert.equal(I18N.create('de').lang, 'en');
  assert.equal(en.t('no.such.key'), 'no.such.key');
});
