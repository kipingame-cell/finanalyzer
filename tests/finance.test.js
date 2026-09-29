import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNotification, parseNotificationList, areLikelySamePayment } from '../www/js/parser.js';
import * as store from '../www/js/store.js';

globalThis.localStorage = {
  data: new Map(),
  getItem(k) { return this.data.get(k) ?? null; },
  setItem(k, v) { this.data.set(k, v); },
};

test('two identical purchases at different times stay separate; re-reading does not duplicate', () => {
  const sample = { pkg: 'ru.sberbankmobile', key: 'bank|42', title: 'СберБанк', text: 'Покупка 450,00 ₽, МАГНИТ. Баланс: 1200 ₽' };
  const a = parseNotificationList([{ ...sample, ts: 1000 }, { ...sample, ts: 2000 }], [], []);
  assert.equal(a.length, 2);
  assert.notEqual(a[0].hash, a[1].hash);
  assert.equal(parseNotificationList([{ ...sample, ts: 1000 }], [a[1].hash], []).length, 0);
});

test('balance-only and advertising amounts do not become expenses', () => {
  assert.equal(parseNotification('ru.sberbankmobile', 'Сбер', 'Баланс: 10 000 ₽'), null);
  assert.equal(parseNotification('ru.sberbankmobile', 'Сбер', 'Скидка 500 ₽ сегодня'), null);
  assert.equal(parseNotification('ru.sberbankmobile', 'Сбер', 'Код подтверждения 1234. Покупка 500 ₽'), null);
  assert.equal(parseNotification('ru.sberbankmobile', 'Сбер', 'Покупка 500 ₽, МАГНИТ').amount, 500);
});

test('push and SMS of one payment get a warning, separate purchases stay distinct', () => {
  const push = { pkg: 'ru.sberbankmobile', key: 'bank|1', title: 'Сбер',
    text: 'Покупка 450 ₽ МАГНИТ Карта *1234', ts: 100000 };
  const sms = { pkg: 'com.google.android.apps.messaging', key: 'sms|1', title: '900',
    text: 'Покупка 450 ₽ МАГНИТ Карта *1234', ts: 110000 };
  const [a, b] = parseNotificationList([push, sms], [], []);
  assert.equal(a.possibleDuplicate, true);
  assert.equal(b.possibleDuplicate, true);
  assert.equal(areLikelySamePayment(a, { ...b, ts: 220000 }), false);
  assert.equal(areLikelySamePayment(a, { ...b, last4: '5678' }), false);
  assert.equal(areLikelySamePayment(a, { ...b, sourceChannel: a.sourceChannel }), false);
});

test('backup removes API token, including when restoring an older backup', () => {
  store.initStore();
  store.setSetting('aiToken', 'secret-test-value');
  assert.equal(JSON.parse(store.exportJSON()).settings.aiToken, '');
  assert.equal(JSON.parse(localStorage.getItem('finanalyzer_data_v1')).settings.aiToken, '');
  const old = JSON.parse(store.exportJSON());
  old.settings.aiToken = 'old-secret';
  store.importJSON(JSON.stringify(old));
  assert.equal(store.getSettings().aiToken, '');
  assert.throws(() => store.importJSON('{"transactions":{},"categories":[]}'));
});

test('invalid or repeated operations cannot enter the ledger', () => {
  store.wipeAll();
  assert.throws(() => store.addTransaction({ type: 'expense', amount: Infinity }));
  store.addTransaction({ type: 'expense', amount: 450, date: new Date().toISOString(), hash: 'one' });
  assert.throws(() => store.addTransaction({ type: 'expense', amount: 450, date: new Date().toISOString(), hash: 'one' }));
});
