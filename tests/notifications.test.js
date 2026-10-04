import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNotification as parse, parseNotificationList, parsePastedText } from '../www/js/parser.js';
const sber = text => parse('ru.sberbankmobile', 'СберБанк', text);
for (const [text,amount,type,balance] of [
  ['Покупка 450,00 ₽, ПЯТЁРОЧКА. Баланс: 12 340,55 ₽',450,'expense',12340.55],
  ['Баланс 9000 ₽. Покупка 300 ₽ OZON',300,'expense',9000],
  ['MIR-1234 Оплата 1\u202f234,56р MAGNIT Остаток: 0р',1234.56,'expense',0],
  ['Перевод 500р от ИВАН И. Баланс 1000р',500,'income',1000],
  ['Перевод 40p OZON Баланс: 3756.33р',40,'expense',3756.33],
  ['Зачисление зарплаты 52 141 RUB. Доступно 60 000 RUB',52141,'income',60000],
  ['Оплата 1,234.56 RUB в SHOP',1234.56,'expense',null],
  ['Возврат 299 ₽ OZON',299,'income',null],
  ['Подписка Яндекс Плюс 299₽',299,'expense',null],
]) test(text,()=>{const p=sber(text);assert.ok(p);assert.equal(p.amount,amount);assert.equal(p.type,type);assert.equal(p.balance,balance);});
for (const text of ['Баланс: 500 ₽','Ваш код: 1234. Оплата 500 ₽','Покупка 500 ₽ отклонена','Скидка на покупку 500 ₽','Покупка 100 ₽ и покупка 200 ₽','Просто 100 ₽','Перевод не выполнен 100 ₽']) test('reject '+text,()=>assert.equal(sber(text),null));
test('reject unrelated app',()=>assert.equal(parse('chat.app','','Оплата 500 ₽'),null));
test('category respects operation type',()=>assert.equal(sber('Возврат 299 ₽ OZON').categoryId,'other_inc'));
test('merchant and card',()=>{const p=sber('MIR-1234 Покупка 450 ₽ ПЯТЁРОЧКА. Баланс 500 ₽');assert.equal(p.note,'ПЯТЁРОЧКА');assert.equal(p.last4,'1234');assert.equal(p.categoryId,'food');});
test('same notification dedup, distinct identical purchases retained',()=>{
 const item={pkg:'ru.sberbankmobile',title:'Сбер',text:'Покупка 100 ₽ SHOP',key:'bank:1',ts:1000};
 const all=parseNotificationList([item,item,{...item,ts:2000}]);assert.equal(all.length,2);
 assert.equal(parseNotificationList([item],[all[1].hash]).length,0);
 assert.deepEqual(parseNotificationList(null),[]);
});
test('pasted separate operations',()=>assert.equal(parsePastedText('Покупка 100 ₽ SHOP\nОплата 200 ₽ CAFE').length,2));
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
const store=await import('../www/js/store.js');
const {importSuggestions}=await import('../www/js/notify.js');
test('automatic import persists once and preserves latest balance',()=>{
 store.initStore();
 const items=[1000,2000].map((ts,i)=>({pkg:'ru.sberbankmobile',title:'Сбер',text:`Покупка 100 ₽ SHOP Баланс ${500-i*100} ₽`,key:'n'+i,ts}));
 const parsed=parseNotificationList(items);
 assert.equal(importSuggestions(parsed),2);assert.equal(importSuggestions(parsed),0);
 assert.equal(store.getState().transactions.length,2);
 assert.equal(store.getState().accounts.find(a=>a.id==='sber').balance,400);
 assert.equal(store.getState().transactions[0].date,new Date(2000).toISOString());
});

test('failed persistence can retry without losing operations',()=>{
 store.initStore();
 const parsed=parseNotificationList([{pkg:'ru.sberbankmobile',title:'Сбер',text:'Покупка 123 ₽ SHOP',key:'retry',ts:3000}]);
 globalThis.localStorage.setItem=()=>{throw new Error('quota');};
 assert.throws(()=>importSuggestions(parsed),/quota/);
 assert.equal(store.getState().transactions.length,0);
 globalThis.localStorage.setItem=()=>{};
 assert.equal(importSuggestions(parsed),1);
 assert.equal(store.addTransaction({...store.getState().transactions[0]}).hash,parsed[0].hash);
 assert.equal(store.getState().transactions.length,1);
});
