import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNotificationList} from '../www/js/parser.js';
import {initStore,getState} from '../www/js/store.js';
import {importSuggestions,importSmsHistory,fetchSuggestions} from '../www/js/notify.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
const sms=(id,ts=1000)=>({pkg:'com.android.mms',title:'900',text:'Покупка 100 ₽ SHOP',ts,key:'sms:'+id,smsId:String(id)});
const native=plugin=>{globalThis.window={Capacitor:{isNativePlatform:()=>true,Plugins:{NotificationListener:plugin}}};};
test('full history paginates and repeat import is idempotent',async()=>{
 initStore(); const calls=[];
 native({readSmsHistory:async p=>{calls.push(p);return p.after==='0'?{items:[sms(1)],after:'1',upper:'2',more:true}:{items:[sms(2,2000)],after:'2',upper:'2',more:false};}});
 assert.deepEqual(await importSmsHistory(),{scanned:2,imported:2,cancelled:false});
 assert.equal(calls[1].upper,'2');
 assert.equal((await importSmsHistory()).imported,0);
 assert.equal(getState().transactions.length,2);
 assert.equal(getState().transactions[0].source,'sms');
});
test('permission denial leaves financial data untouched',async()=>{
 initStore();native({readSmsHistory:async()=>{throw new Error('SMS_PERMISSION_DENIED');}});
 await assert.rejects(importSmsHistory(),/SMS_PERMISSION_DENIED/);
 assert.equal(getState().transactions.length,0);
});
test('interrupted import can resume via a safe full rescan',async()=>{
 initStore();let stop=false;
 native({readSmsHistory:async()=>({items:[sms(1)],after:'1',upper:'2',more:true})});
 const result=await importSmsHistory(()=>{stop=true;},()=>stop);
 assert.equal(result.cancelled,true);assert.equal(getState().transactions.length,1);
});
test('history and captured SMS match one-to-one without merging separate purchases',()=>{
 initStore();
 importSuggestions(parseNotificationList([{...sms(1),smsId:undefined,key:'notification:1'}]));
 assert.equal(importSuggestions(parseNotificationList([sms(1)])),0);
 assert.equal(importSuggestions(parseNotificationList([sms(2,2000)])),1);
 assert.equal(getState().transactions.length,2);
});
test('native queue traverses all pages and acknowledges only consumed messages',async()=>{
 initStore(); const acknowledged=[];
 native({getNotifications:async p=>p.after==='0'?{items:JSON.stringify([{pkg:'other.app',title:'Hello',text:'Hi',queueId:'1'}]),after:'1',more:true}:{items:JSON.stringify([sms(2)]),after:'2',more:false},acknowledgeNotifications:async p=>acknowledged.push(...p.items)});
 const r=await fetchSuggestions();assert.equal(r.suggestions.length,1);assert.equal(r.total,2);assert.equal(acknowledged.length,1);
});
