import test from 'node:test';
import assert from 'node:assert/strict';
import {guessCategory} from '../www/js/categories.js';
import * as S from '../www/js/store.js';
import {prepareStatement,importStatement} from '../www/js/statement.js';
import {importSuggestions} from '../www/js/notify.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
const date='2026-10-01T09:30:00.000Z';
const sms=(hash='sms1',patch={})=>({hash,ts:Date.parse(date),amount:100,type:'expense',accountId:'main',note:'SMS name',categoryId:'uncategorized_exp',smsId:hash,...patch});
const result=(n=1)=>({operations:Array.from({length:n},()=>({date,amount:100,type:'expense',note:'Оплата товаров и услуг YANDEX*PLUS-',categoryId:'subs',raw:'bank row'}))});
test('requested merchants classify directly and keep income semantics',()=>{
 for(const [name,cat] of [['IP LUKANKIN A.A.-','food'],['YANDEX*PLUS-','subs'],['BOOSTY','subs'],['Бусти','subs']]) {
  assert.equal(guessCategory('Оплата товаров и услуг '+name,'expense'),cat);
  assert.equal(guessCategory('Возврат '+name,'income'),'refund');
 }
});
test('statement replaces SMS ignoring description; reimport is idempotent',()=>{
 S.initStore();importSuggestions([sms()]);
 const rows=prepareStatement(result(),'main');
 assert.equal(rows[0].replacesNotification,true);assert.equal(rows[0].possibleDuplicate,false);
 assert.equal(importStatement(rows,'main'),1);
 assert.equal(S.getState().transactions.length,1);
 const tx=S.getState().transactions[0];assert.equal(tx.source,'statement');assert.equal(tx.categoryId,'subs');assert.equal(tx.note,result().operations[0].note);
 assert.equal(importSuggestions([sms()]),0);
 // File name is deliberately absent from operation identity.
 assert.equal(importStatement(prepareStatement({...result(),fileName:'renamed.csv'},'main'),'main'),0);
});
test('statement wins when SMS arrives later, with one-to-one matching',()=>{
 S.initStore();importStatement(prepareStatement(result(),'main'),'main');
 assert.equal(importSuggestions([sms()]),0);assert.equal(S.getState().transactions[0].source,'statement');
 assert.equal(importSuggestions([sms('sms2')]),1);assert.equal(S.getState().transactions.length,2);
});
test('identical real rows stay separate and replace only matching SMS copies',()=>{
 S.initStore();importSuggestions([sms(),sms('sms2')]);
 const rows=prepareStatement(result(3),'main');
 assert.deepEqual(rows.map(r=>r.replacesNotification),[true,true,false]);
 importStatement(rows,'main');assert.equal(S.getState().transactions.length,3);
 assert.ok(S.getState().transactions.every(t=>t.source==='statement'));
});
test('different account, time, amount or direction cannot be silently replaced',()=>{
 for(const patch of [{accountId:'other'},{ts:Date.parse(date)+1000},{amount:101},{type:'income'}]) {
  S.initStore();importSuggestions([sms('sms1',patch)]);
  const rows=prepareStatement(result(),'main');assert.equal(rows[0].replacesNotification,false);
  importStatement(rows,'main');assert.equal(S.getState().transactions.length,2);
 }
});
test('failed save restores replaced SMS and allows safe retry',()=>{
 S.initStore();importSuggestions([sms()]);const rows=prepareStatement(result(),'main');
 localStorage.setItem=()=>{throw Error('quota');};
 assert.throws(()=>importStatement(rows,'main'),/quota/);
 assert.equal(S.getState().transactions.length,1);assert.equal(S.getState().transactions[0].source,'sms');
 localStorage.setItem=()=>{};assert.equal(importStatement(rows,'main'),1);
});

test('existing automatic categories migrate, manual categories survive',()=>{
 S.initStore();const state=S.getState();
 state.transactions=result().operations.map((t,i)=>({...t,id:'old'+i,accountId:'main',categoryId:'fun'}));
 state.transactions.push({...state.transactions[0],id:'manual',categoryManual:true});
 S.importJSON(JSON.stringify(state));
 assert.equal(S.getState().transactions[0].categoryId,'subs');
 assert.equal(S.getState().transactions[1].categoryId,'fun');
});
