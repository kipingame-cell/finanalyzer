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
