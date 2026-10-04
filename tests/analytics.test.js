import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../www/js/store.js';
let saved=null;
globalThis.localStorage={getItem:()=>saved,setItem:(k,v)=>{saved=v;}};
function reset(){saved=null;S.initStore();}
function tx(type,amount,extra={}){return S.addTransaction({type,amount,date:'2026-01-15T12:00:00Z',accountId:'main',categoryId:type==='income'?'salary':'food',note:'SHOP',...extra});}
test('million-ruble transfers do not inflate earnings, spending, categories or merchants',()=>{
 reset();tx('income',50000);tx('expense',1000);
 tx('expense',1000000,{ownTransfer:true});tx('income',1000000,{ownTransfer:true,accountId:'second'});
 assert.deepEqual(S.monthTotals('2026-01'),{income:50000,expense:1000});
 assert.deepEqual(S.transferTotals('2026-01'),{income:1000000,expense:1000000,count:2});
 assert.equal(S.byCategory('2026-01')[0].sum,1000);
 assert.equal(S.topMerchants('2026-01')[0].sum,1000);
 assert.equal(S.balance(),49000);assert.equal(S.balance('second'),1000000);
});
test('one-sided transfer keeps cash flow but not spending',()=>{
 reset();tx('expense',500,{note:'Перевод себе'});
 assert.equal(S.monthTotals('2026-01').expense,0);assert.equal(S.balance(),-500);
 assert.equal(S.transferTotals('2026-01').expense,500);
});
test('ordinary SBP and internal transfers must not be inferred to belong to owner',()=>{
 reset();tx('expense',500,{note:'Внутрибанковский перевод на +7 900 000-00-00'});
 tx('income',700,{note:'Входящий перевод СБП, Тест'});
 assert.deepEqual(S.monthTotals('2026-01'),{income:700,expense:500});
});
test('bulk classification updates existing history and can be reversed without losing original category',()=>{
 reset();const a=tx('expense',20),b=tx('income',30);
 S.setOwnTransfers([a.id,b.id],true);assert.deepEqual(S.monthTotals('2026-01'),{income:0,expense:0});
 S.initStore();assert.equal(S.transferTotals('2026-01').count,2);
 S.setOwnTransfers([a.id,b.id],false);assert.deepEqual(S.monthTotals('2026-01'),{income:30,expense:20});
 assert.equal(S.getState().transactions.find(t=>t.id===a.id).categoryId,'food');
});
test('explicit opt-out overrides automatic self-transfer detection',()=>{
 reset();tx('expense',10,{note:'Перевод себе',ownTransfer:false});assert.equal(S.monthTotals('2026-01').expense,10);
});
test('historical chart respects account, end month and year rollover',()=>{
 reset();tx('expense',10,{date:'2025-12-15T12:00:00Z'});tx('expense',20);tx('expense',900,{accountId:'second'});
 const months=S.lastNMonths(3,'main','2026-01');
 assert.deepEqual(months.map(m=>[m.mk,m.expense]),[['2025-11',0],['2025-12',10],['2026-01',20]]);
});
test('decimal totals use cents and imported numeric strings cannot concatenate',()=>{
 reset();tx('income',0.1);tx('income',0.2);S.getState().transactions[0].amount='0.20';
 assert.equal(S.monthTotals('2026-01').income,0.3);assert.equal(S.balance(),0.3);
});
test('failed batch save restores previous classification',()=>{
 reset();const a=tx('expense',10,{note:'Перевод себе'});const original=localStorage.setItem;
 localStorage.setItem=()=>{throw Error('quota');};
 assert.throws(()=>S.setOwnTransfers([a.id],false),/quota/);
 assert.equal(a.ownTransfer,undefined);assert.equal(S.isOwnTransfer(a),true);localStorage.setItem=original;
});

test('self-transfer marker survives notification merchant extraction and import',async()=>{
 reset();
 const {parseNotification}=await import('../www/js/parser.js');
 const {importSuggestions}=await import('../www/js/notify.js');
 const p=parseNotification('ru.yandex.bank','Яндекс Банк','Перевод себе 500 ₽. Баланс 1000 ₽');
 assert.ok(p);assert.equal(p.ownTransfer,true);
 p.ts=Date.parse('2026-01-15T12:00:00Z');
 assert.equal(importSuggestions([p]),1);
 assert.equal(S.monthTotals('2026-01').expense,0);assert.equal(S.transferTotals('2026-01').expense,500);
});
