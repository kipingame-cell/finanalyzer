import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStatementText,statementDate,prepareStatement,importStatement,csvRows} from '../www/js/statement.js';
import {pdfItemsToLines,readStatementFile} from '../www/js/statement-file.js';
import * as S from '../www/js/store.js';
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
test('CSV signed amounts and multiline quoted description',()=>{
 const r=parseStatementText('Дата;Сумма;Описание;Валюта\n01.10.2026 12:30;-1 234,56;"Оплата\nSHOP";RUB\n02.10.2026;+200,00;Возврат;RUB');
 assert.equal(r.operations.length,2);assert.equal(r.operations[0].amount,1234.56);assert.equal(r.operations[0].date,'2026-10-01T09:30:00.000Z');assert.equal(r.operations[1].type,'income');
});
test('separate debit and credit columns, invalid and foreign rows reported',()=>{
 const r=parseStatementText('Дата;Расход;Приход;Описание;Валюта\n01.10.2026;100;;SHOP;RUB\n02.10.2026;;200;Зачисление;RUB\n03.10.2026;100;100;BAD;RUB\n04.10.2026;300;;FOREIGN;USD');
 assert.equal(r.operations.length,2);assert.equal(r.rejected.length,2);
});
test('unsigned unclassified CSV amount is not assumed expense',()=>assert.equal(parseStatementText('Дата;Сумма;Описание\n01.10.2026;500;SHOP').rejected.length,1));
test('cancelled and contradictory CSV rows rejected',()=>{
 const r=parseStatementText('Дата;Сумма;Описание;Статус\n01.10.2026;-500;Покупка;Отменена\n02.10.2026;-500;Возврат;Исполнена');assert.equal(r.operations.length,0);assert.equal(r.rejected.length,2);
});
test('dated PDF text and wrapped merchant',()=>{
 const r=parseStatementText('Выписка\n01.10.2026 12:00 -500,00 RUB SHOP\nMOSCOW\n02.10.2026 Пополнение 1000 ₽\nИтого 1500 ₽');
 assert.equal(r.operations.length,2);assert.equal(r.operations[0].note,'SHOP MOSCOW');assert.equal(r.operations[1].amount,1000);
});
test('card suffix cannot be mistaken for signed amount',()=>{
 const r=parseStatementText('01.10.2026 MIR-1234 Покупка 450 ₽ SHOP');assert.equal(r.operations[0].amount,450);
});
test('invalid dates and foreign currency text rejected',()=>{
 assert.equal(statementDate('31.02.2026'),null);assert.equal(statementDate('01.13.2026'),null);assert.equal(statementDate('01.10.2026 28:00'),null);
 assert.equal(parseStatementText('01.10.2026 -100 USD SHOP').operations.length,0);
});
test('repeat import is idempotent and legitimate identical rows preserved',()=>{
 S.initStore();const r=parseStatementText('Дата;Сумма;Описание\n01.10.2026;-100;SHOP\n01.10.2026;-100;SHOP');
 let rows=prepareStatement(r,'main');assert.notEqual(rows[0].statementKey,rows[1].statementKey);
 assert.equal(importStatement(rows,'main'),2);assert.equal(importStatement(prepareStatement(r,'main'),'main'),0);
});
test('possible existing operation is flagged rather than silently deleted',()=>{
 S.initStore();S.addTransaction({date:'2026-10-01T12:00:00.000Z',amount:100,type:'expense',note:'SHOP',accountId:'main'});
 const rows=prepareStatement(parseStatementText('Дата;Сумма;Описание\n01.10.2026;-100;SHOP'),'main');
 assert.equal(rows[0].possibleDuplicate,true);assert.equal(rows[0].duplicate,false);
});
test('storage failure rolls back full statement batch',()=>{
 S.initStore();const rows=prepareStatement(parseStatementText('Дата;Сумма;Описание\n01.10.2026;-100;SHOP'),'main');
 globalThis.localStorage.setItem=()=>{throw new Error('quota');};assert.throws(()=>importStatement(rows,'main'),/quota/);assert.equal(S.getState().transactions.length,0);globalThis.localStorage.setItem=()=>{};
});
test('PDF fragments sorted geometrically',()=>assert.deepEqual(pdfItemsToLines([{str:'SHOP',transform:[1,0,0,1,200,500]},{str:'01.10.2026',transform:[1,0,0,1,10,500]},{str:'next',transform:[1,0,0,1,10,480]}]),['01.10.2026 SHOP','next']));
test('CSV escaped quotes and delimiters',()=>assert.deepEqual(csvRows('"one;two";"quote ""inside"""',';'),[['one;two','quote "inside"']]));
// Minimal in-memory PDF fixture exercises the actual bundled PDF.js worker.
function pdfFixture(){
 const stream='BT /F1 12 Tf 50 700 Td (01.10.2026 -123.45 RUB SHOP) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let data='%PDF-1.4\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(data.length);data+=`${i+1} 0 obj\n${o}\nendobj\n`;});const start=data.length;
 data+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
 return new TextEncoder().encode(data);
}
test('real PDF text extraction and parsing',async()=>{
 const data=pdfFixture();const text=await readStatementFile({name:'fixture.pdf',size:data.length,arrayBuffer:async()=>data.buffer});
 assert.match(text,/SHOP/);const parsed=parseStatementText(text);assert.equal(parsed.operations.length,1);assert.equal(parsed.operations[0].amount,123.45);
});

test('dated balance and multi-amount text cannot become a purchase',()=>{
 assert.equal(parseStatementText('01.10.2026 Остаток -500 ₽').operations.length,0);
 assert.equal(parseStatementText('01.10.2026 Покупка -100 ₽ комиссия 10 ₽').operations.length,0);
});
// Synthetic data reproduces the observed PDF layout; no personal screenshot data.
const yandexLayout = `Исходящий перевод СБП, Получатель 21.04.2026
21.04.2026 -400,00 ₽ -400,00 ₽
Тестовый П., +7 900 000-00-00, в 12:03
Сбербанк
Оплата товаров и услуг DIXY- 19.04.2026
21.04.2026 *3222 -289,90 ₽ -289,90 ₽
78325D в 13:54`;
test('Yandex interleaved two-date two-amount rows',()=>{
 const r=parseStatementText(yandexLayout);assert.equal(r.format,'yandex-pdf');assert.equal(r.operations.length,2);assert.equal(r.rejected.length,0);
 assert.equal(r.operations[0].amount,400);assert.equal(r.operations[1].amount,289.9);
 assert.equal(r.operations[1].date,'2026-04-19T10:54:00.000Z');assert.equal(r.operations[1].postingDate,'2026-04-21T09:00:00.000Z');
 assert.match(r.operations[1].note,/DIXY/);assert.match(r.operations[1].note,/78325D/);
 assert.ok(!r.operations[1].note.includes('289,90'));
});
test('Yandex same layout flattened to one line',()=>assert.equal(parseStatementText(yandexLayout.replace(/\n/g,' ')).operations.length,2));
test('Yandex positive incoming transfer and unicode minus',()=>{
 const r=parseStatementText('Входящий перевод СБП 01.10.2026\n01.10.2026 +1 234,56 ₽ +1 234,56 ₽ в 10:20\n'+yandexLayout.replace(/-/g,'−'));
 assert.equal(r.operations.length,3);assert.equal(r.operations[0].type,'income');assert.equal(r.operations[0].amount,1234.56);
});
test('Yandex unequal monetary columns remain visible for review',()=>{
 const r=parseStatementText(yandexLayout.replace('-400,00 ₽ -400,00 ₽','-400,00 ₽ -401,00 ₽'));
 assert.equal(r.operations.length,1);assert.equal(r.rejected.length,1);
});
test('unknown extracted text is reported rather than zero/zero',()=>{
 const r=parseStatementText('Неизвестный шаблон выписки с текстом');assert.equal(r.operations.length,0);assert.equal(r.rejected.length,1);
});
const qrTable=`Входящий перевод СБП, Тест 25.09.2025
25.09.2025 +20,00 ₽ +20,00 ₽ в 11:49
Оплата СБП QR (YANDEX.TAXI) 25.09.2025
25.09.2025 -12,00 ₽ -12,00 ₽
в 12:00
Оплата СБП QR (оплата ж/д 04.03.2026
04.03.2026 -1 449,50 ₽ -1 449,50 ₽
перевозок) в 11:26
Возврат средств СБП QR (оплата 04.03.2026
04.03.2026 +1 449,50 ₽ +1 449,50 ₽
ж/д перевозок) в 11:28
Оплата СБП QR 08.06.2026 08.06.2026 -1,00 ₽ -
1,00 ₽
(https://example.invalid) в 14:39
Продолжение на следующей странице
Страница 63 из 96
Описание операции Дата и время Дата Карта
Сумма в валюте Сумма в валюте
операции обработки операции ЭСП
МСК МСК
Оплата СБП QR (skvn) 08.06.2026 08.06.2026 -
10,00 ₽ -10,00 ₽ в 15:17
Всего расходных операций -1 472,50 ₽
Всего приходных операций +1 469,50 ₽
С уважением,
Начальник отдела
Страница 96 из 96`;
test('QR payments/refunds split from neighbouring transfers and own descriptions',()=>{
 const r=parseStatementText(qrTable);assert.equal(r.operations.length,6);assert.equal(r.rejected.length,0);
 assert.deepEqual(r.operations.map(x=>[x.type,x.amount]),[['income',20],['expense',12],['expense',1449.5],['income',1449.5],['expense',1],['expense',10]]);
 assert.ok(r.operations.every(x=>!x.note.includes('Страница')&&!x.note.includes('Всего')&&!x.note.includes('МСК МСК')));
 assert.equal(r.reconciliation.income.difference,0);assert.equal(r.reconciliation.expense.difference,0);
});
test('mismatched statement totals are reported independently of selection',()=>{
 const r=parseStatementText(qrTable.replace('+1 469,50 ₽','+1 500,00 ₽'));
 assert.equal(r.reconciliation.income.difference,-30.5);
});
test('page break inside a transaction preserves continuation',()=>{
 const r=parseStatementText('Оплата СБП QR (SHOP) 08.06.2026\nПродолжение на следующей странице\nСтраница 1 из 2\nОписание операции Дата и время Дата Карта\nСумма в валюте Сумма в валюте\nоперации обработки операции ЭСП\nМСК МСК\n08.06.2026 -12,00 ₽ -12,00 ₽ в 15:17');
 assert.equal(r.operations.length,1);assert.equal(r.operations[0].amount,12);
});
test('missing totals are not presented as a successful reconciliation',()=>{
 const r=parseStatementText(yandexLayout);assert.equal(r.reconciliation.income.expected,null);assert.equal(r.reconciliation.expense.difference,null);
});

// Anonymized regression cases for all 19 reported joined blocks.
const joinedCases=[
 ['income',500,[863.93]],['expense',3183.94,[199],'transfer'],
 ['income',400,[230],'transfer'],['expense',177,[109.98,179.99]],
 ['expense',420,[151,167]],['expense',310,[644.94]],
 ['expense',35,[126]],['expense',35,[116]],['income',2000,[200]],
 ['expense',460,[294]],['expense',160,[497.94,99.99]],
 ['expense',700,[174.99]],['income',1367,[156]],['income',135,[414.97]],
 ['expense',897.15,[401.16]],['expense',40,[600]],
 ['expense',1975,[548],'reversal'],['income',360,[15],'transfer'],
 ['expense',632,[],'balance']
];
function tableRow(label,amount,type,time='16:45') {
 const sum=(type==='income'?'+':'–')+amount.toFixed(2).replace('.',',');
 return `${label} 05.10.2025 06.10.2025 ${sum} ₽ ${sum} ₽ в ${time}`;
}
test('all reported joined block shapes preserve every operation, sign and time',()=>{
 for(const [type,amount,next,variant] of joinedCases) {
  const first=tableRow(type==='income'?'Входящий перевод СБП, Тест':'Оплата товаров и услуг SHOP',amount,type);
  const label=variant==='transfer'?'Внутрибанковский перевод на +7 900 000-00-00, Тест':variant==='reversal'?'Отмена оплаты услуг TEST':'Оплата Сбер QR (SHOP_P_QR)';
  const nextType=variant==='reversal'?'income':'expense';
  const text=[first,...next.map(n=>tableRow(label,n,nextType,'16:46')),variant==='balance'?'Исходящий остаток за 03.10.2026 55 378,30 ₽':''].join(' ');
  const r=parseStatementText(text);
  assert.equal(r.rejected.length,0,text);
  assert.deepEqual(r.operations.map(o=>[o.type,o.amount]),[[type,amount],...next.map(n=>[nextType,n])]);
  assert.equal(r.operations[0].date,'2025-10-05T13:45:00.000Z');
  assert.ok(r.operations.slice(1).every(o=>o.date==='2025-10-05T13:46:00.000Z'));
  assert.ok(r.operations.every(o=>!o.note.includes('остаток')));
 }
});
test('Sber QR and internal transfer labels can wrap across PDF lines',()=>{
 const r=parseStatementText(tableRow('Оплата\nСбер QR (SHOP)',109.98,'expense')+'\n'+tableRow('Внутрибанковский\nперевод на +7 900 000-00-00',199,'expense'));
 assert.deepEqual(r.operations.map(o=>o.amount),[109.98,199]);assert.equal(r.rejected.length,0);
});
test('payment reversal requires explicit matching positive booked amounts',()=>{
 for(const sums of ['–548,00 ₽ –548,00 ₽','548,00 ₽ 548,00 ₽','+548,00 ₽ +549,00 ₽']) {
  const r=parseStatementText('Отмена оплаты услуг SHOP 04.04.2026 04.04.2026 '+sums+' в 19:48');
  assert.equal(r.operations.length,0);assert.equal(r.rejected.length,1);
 }
 const r=parseStatementText(tableRow('Оплата товаров и услуг SHOP отменена',548,'expense'));
 assert.equal(r.operations.length,0);assert.equal(r.rejected.length,1);
});
test('balance furniture does not consume next operation or bank totals',()=>{
 const r=parseStatementText('Входящий остаток за 01.10.2026 100,00 ₽ '+tableRow('Оплата Сбер QR SHOP',10,'expense')+' Исходящий остаток за 03.10.2026 90,00 ₽ '+tableRow('Отмена оплаты услуг SHOP',5,'income')+' Всего расходных операций –10,00 ₽ Всего приходных операций +5,00 ₽');
 assert.equal(r.operations.length,2);assert.equal(r.rejected.length,0);
 assert.equal(r.reconciliation.expense.difference,0);assert.equal(r.reconciliation.income.difference,0);
});
