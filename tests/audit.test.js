import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import * as S from '../www/js/store.js';
import {guessCategory} from '../www/js/categories.js';
import {bankDateKey,bankInput,fromBankInput} from '../www/js/dates.js';
import {prepareStatement,importStatement,parseStatementText} from '../www/js/statement.js';
import {offlineInsights} from '../www/js/ai.js';
const saved=new Map();globalThis.localStorage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};
function reset(){saved.clear();S.initStore();}
const row=(id,type,amount,extra={})=>({id,type,amount,date:'2026-07-15T12:00:00Z',categoryId:type==='income'?'salary':'food',accountId:'main',note:'SHOP',source:'statement',...extra});
test('specific categories for actual bank merchant spellings and transfer purpose',()=>{
 for(const [note,expected] of [['PYATEROCHKA 9767','food'],['MAGNIT MM','food'],['DIXY-78325D','food'],['STOLOVAYA','cafe'],['PEKARNYA SDOBUSHKA','cafe'],['JETI PICCA','cafe'],['VKUSNO-I','cafe'],['APTEKA AIBOLIT','health'],['Оплата СБП QR YANDEX.TAXI','transport'],['Оплата ж/д перевозок','transport'],['Yandex*4112*RASP','transport'],['Исходящий перевод СБП, Тест, Озон Банк (Ozon)','transfer_out'],['Внутрибанковский перевод на +7 900 000-00-00','transfer_out'],['Комиссия банка','fees'],['Снятие наличных','cash'],['OZON','market']])assert.equal(guessCategory(note,'expense'),expected,note);
 assert.equal(guessCategory('Неизвестный получатель','expense'),'uncategorized_exp');
 assert.equal(guessCategory('Возврат средств СБП QR','income'),'refund');
});
test('migration replaces legacy unspecified categories, preserves manual choices and saves original backup',()=>{
 reset();const data=S.getState();data.categories.push({id:'other_exp',name:'Прочее',type:'expense'});data.transactions=[row('1','expense',10,{categoryId:'other_exp',note:'STOLOVAYA'}),row('2','expense',20,{categoryId:'gifts',categoryManual:true,note:'PYATEROCHKA'}),row('3','expense',30,{categoryId:'market',note:'Исходящий перевод СБП Ozon Банк'})];delete data.categorySchemaVersion;
 S.save();S.initStore();assert.ok(saved.get('finanalyzer_data_v1_before_160'));
 assert.deepEqual(S.getState().transactions.map(t=>t.categoryId),['cafe','gifts','transfer_out']);assert.ok(S.getCategories().every(c=>!c.name.includes('Проч')));
});
test('Moscow midnight, month/year boundary and edit round trip stay consistent',()=>{
 assert.equal(bankDateKey('2025-12-31T21:05:00Z'),'2026-01-01');assert.equal(S.monthKey('2026-07-31T21:30:00Z'),'2026-08');
 assert.equal(fromBankInput(bankInput('2026-07-31T21:30:00Z')),'2026-07-31T21:30:00.000Z');assert.equal(fromBankInput('2026-02-31T12:00'),null);
 assert.equal(S.monthKey(new Date('invalid')),'');
});
test('same report excludes self transfers and excluded copies consistently while keeping cash flow',()=>{
 reset();const data=S.getState();data.transactions=[row('salary','income',50000),row('food','expense',1234.56),row('copy','expense',1234.56,{source:'notification'}),row('out','expense',1000000,{ownTransfer:true}),row('in','income',1000000,{accountId:'second',ownTransfer:true})];S.save();
 assert.deepEqual([...S.duplicateCandidates()].sort(),['copy','food']);
 S.setExcluded(['copy'],true);
 assert.deepEqual(S.monthTotals('2026-07'),{income:50000,expense:1234.56});assert.equal(S.byCategory('2026-07')[0].sum,1234.56);assert.equal(S.topMerchants('2026-07')[0].sum,1234.56);assert.equal(S.lastNMonths(1,undefined,'2026-07')[0].expense,1234.56);assert.equal(S.balance(),48765.44);
 assert.equal(S.transferTotals('2026-07').count,2);S.setExcluded(['copy'],false);assert.equal(S.monthTotals('2026-07').expense,2469.12);
});
test('invalid imported rows are preserved for review but cannot poison totals',()=>{
 reset();const data=JSON.parse(S.exportJSON());data.transactions=[row('ok','expense',10),row('bad','expense',null),row('bad-date','expense',50,{date:'bad'})];S.importJSON(JSON.stringify(data));assert.equal(S.monthTotals('2026-07').expense,10);assert.equal(S.getState().transactions.length,3);
});
test('bad backup and failed edit do not mutate saved history',()=>{
 reset();const t=S.addTransaction(row('1','expense',10));const before=S.exportJSON();assert.throws(()=>S.importJSON('{"transactions":3,"categories":[]}'));assert.equal(S.exportJSON(),before);
 const orig=localStorage.setItem;localStorage.setItem=()=>{throw Error('quota');};assert.throws(()=>S.updateTransaction(t.id,{amount:100}));assert.equal(S.getState().transactions[0].amount,10);assert.throws(()=>S.deleteTransaction(t.id));assert.equal(S.getState().transactions.length,1);localStorage.setItem=orig;
});
test('bulk category assignment keeps original amounts and rejects mixed income/expense selection',()=>{
 reset();S.getState().transactions=[row('1','expense',10),row('2','income',20)];S.save();assert.throws(()=>S.classifyTransactions(['1','2'],'cafe'));S.classifyTransactions(['1'],'cafe');assert.equal(S.getState().transactions[0].categoryManual,true);assert.deepEqual(S.monthTotals('2026-07'),{income:20,expense:10});
});
test('advisor follows selected historical month and account',()=>{
 reset();S.getState().transactions=[row('1','income',50000),row('2','expense',100000,{accountId:'second'})];S.save();assert.ok(!offlineInsights('2026-07','main').some(t=>t.title.includes('превышают')));assert.match(offlineInsights('2026-06','main')[0].text,/нет учтённых/);
});
test('statement duplicate preview works across accounts and uses Moscow date',()=>{
 reset();S.getState().transactions=[row('n','expense',100,{source:'notification',date:'2026-07-31T21:30:00Z',accountId:'yandex'})];S.save();const p=prepareStatement(parseStatementText('Дата;Сумма;Описание\n01.08.2026;-100;SHOP'),'main');assert.equal(p[0].possibleDuplicate,true);
});
test('large statement preparation and repeated import use indexes, preserving legitimate rows',()=>{
 reset();const operations=Array.from({length:12000},(_,i)=>({...row(String(i),'expense',(i%100)+0.01),note:'SHOP '+i,externalId:'id-'+i}));const start=performance.now();
 const rows=prepareStatement({operations},'main');assert.equal(importStatement(rows,'main'),12000);assert.equal(importStatement(prepareStatement({operations},'main'),'main'),0);
 assert.equal(S.monthTotals('2026-07').expense,594120);assert.equal(S.getState().transactions.length,12000);
 const elapsed=performance.now()-start;console.log('12,000-row prepare/import/reimport/report: '+Math.round(elapsed)+' ms');assert.ok(elapsed<5000,'unexpected quadratic slowdown');
});
