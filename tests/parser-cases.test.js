import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNotification, parseNotificationList, parsePastedText } from '../www/js/parser.js';

const cases = [
  ['Ozon top-up with balance', 'ru.ozon.app.android', 'Ozon Банк', 'Пополнение через СБП на 3 000 ₽. Баланс 3 072.26 ₽', 'income', 3000, 'ozon'],
  ['balance before purchase', 'ru.sberbankmobile', 'Сбер', 'Баланс 10 000 ₽. Покупка 450 ₽ МАГНИТ', 'expense', 450, 'sber'],
  ['balance in same sentence', 'ru.sberbankmobile', 'Сбер', 'Баланс 10 000 ₽ Покупка 450 ₽ МАГНИТ', 'expense', 450, 'sber'],
  ['Sber SMS', 'com.google.android.apps.messaging', '900', 'Карта *1234. Покупка 40р в МАГНИТ. Остаток 560р', 'expense', 40, 'sber'],
  ['salary', 'ru.vtb24.mobilebanking.android', 'ВТБ', 'Зачислена зарплата 52 000,50 руб. Баланс 60 000 руб.', 'income', 52000.5, 'vtb'],
  ['incoming transfer', 'ru.sberbankmobile', 'Сбер', 'Перевод 1 500 ₽ от ИВАН И.', 'income', 1500, 'sber'],
  ['outgoing transfer', 'ru.sberbankmobile', 'Сбер', 'Перевод 1 500 ₽ на карту *5678', 'expense', 1500, 'sber'],
  ['refund', 'ru.sberbankmobile', 'Сбер', 'Возврат покупки 799 ₽. Баланс 2000 ₽', 'income', 799, 'sber'],
  ['cashback', 'ru.sberbankmobile', 'Сбер', 'Кэшбэк 27 ₽ за покупки', 'income', 27, 'sber'],
  ['commission', 'ru.sberbankmobile', 'Сбер', 'Комиссия 15 ₽ за перевод', 'expense', 15, 'sber'],
  ['foreign merchant is not bank', 'ru.sberbankmobile', 'Сбер', 'Покупка 490 ₽ OZON. Баланс 3000 ₽', 'expense', 490, 'sber'],
  ['grouped dots', 'ru.sberbankmobile', 'Сбер', 'Покупка 1.234,56 ₽ МАГНИТ', 'expense', 1234.56, 'sber'],
  ['decimal dot', 'ru.sberbankmobile', 'Сбер', 'Оплата 1234.56 RUB в кафе', 'expense', 1234.56, 'sber'],
  ['paid', 'ru.sberbankmobile', 'Сбер', 'Оплачено 560 ₽ в кафе', 'expense', 560, 'sber'],
  ['debited', 'ru.sberbankmobile', 'Сбер', 'Списали 100 ₽ за проезд', 'expense', 100, 'sber'],
];
for (const [name,pkg,title,body,type,amount,bankId] of cases) test(name, () => {
  const p = parseNotification(pkg,title,body);
  assert.ok(p, name);
  assert.equal(p.type,type); assert.equal(p.amount,amount); assert.equal(p.bankId,bankId);
});

for (const [name,body] of [
  ['balance only','Баланс 10 000 ₽'],
  ['OTP','Код подтверждения 1234. Покупка 500 ₽'],
  ['short OTP','Код 123456. Покупка 500 ₽'],
  ['advertisement','Скидка на покупку 500 ₽, успейте!'],
  ['failed','Покупка 500 ₽ не прошла: недостаточно средств'],
  ['number without currency','Покупка 500. Карта 1234'],
]) test('reject '+name, () => assert.equal(parseNotification('ru.sberbankmobile','Сбер',body),null));

test('ambiguous transfer and unknown bank require review', () => {
  const t = parseNotification('ru.sberbankmobile','Сбер','Перевод 500 ₽');
  assert.equal(t.type,'expense'); assert.equal(t.confidence,'review');
  const u = parseNotification('unknown.bank','Банк','Покупка 200 ₽ в кафе');
  assert.equal(u.confidence,'review');
});
test('amount separated from balance and incidental commission', () => {
  const p=parseNotification('ru.sberbankmobile','Сбер','Покупка 500 ₽. Комиссия 5 ₽. Баланс 1000 ₽');
  assert.equal(p.amount,500); assert.equal(p.balance,1000);
});
test('merchant and category come from transaction, not bank title', () => {
  const p=parseNotification('ru.ozon.app.android','Ozon Банк','Покупка 450 ₽ МАГНИТ. Баланс 1000 ₽');
  assert.match(p.note,/магнит/i); assert.equal(p.categoryId,'food');
});
test('pasted independent messages remain independent', () => {
  const p=parsePastedText('Покупка 500 ₽ МАГНИТ\n\nПокупка 500 ₽ МАГНИТ');
  assert.equal(p.length,2); assert.notEqual(p[0].hash,p[1].hash);
});
test('same native event is idempotent, later purchase stays separate', () => {
  const base={pkg:'ru.sberbankmobile',title:'Сбер',text:'Покупка 500 ₽ МАГНИТ',key:'key'};
  const p=parseNotificationList([{...base,ts:100000},{...base,ts:100000},{...base,ts:200000}],[],[]);
  assert.equal(p.length,2);
});
