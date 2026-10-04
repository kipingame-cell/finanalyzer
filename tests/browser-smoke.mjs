// Optional browser integration: npm install --no-save playwright; npx playwright install chromium.
// Or set PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE_PATH to existing local installations.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const webroot=new URL('../www/',import.meta.url).pathname;
const server=http.createServer((req,res)=>{const file=path.join(webroot,req.url==='/'?'index.html':decodeURI(req.url));try{const data=fs.readFileSync(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(8766,'127.0.0.1',r));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
try {
const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'America/Los_Angeles'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8766')?r.continue():r.abort());
await page.goto('http://127.0.0.1:8766');
await page.evaluate(async()=>{
 const S=await import('/js/store.js');const data=JSON.parse(S.exportJSON());
 data.accounts.push({id:'second',name:'Второй счёт',bankId:'yandex',balance:null});
 const tx=(id,type,amount,date,note,extra={})=>({id,type,amount,date,note,categoryId:'other_exp',accountId:'main',source:'statement',...extra});
 data.transactions=[tx('salary','income',50000,'2026-07-01T09:00:00Z','Зарплата',{categoryId:'salary'}),tx('food','expense',1234.56,'2026-07-15T12:00:00Z','PYATEROCHKA'),tx('copy','expense',1234.56,'2026-07-15T12:00:00Z','PYATEROCHKA',{source:'notification'}),tx('selfout','expense',1000000,'2026-07-15T13:00:00Z','Перевод себе',{ownTransfer:true}),tx('selfin','income',1000000,'2026-07-15T13:00:00Z','Перевод себе',{ownTransfer:true,accountId:'second'}),tx('unknown','expense',75,'2026-07-31T21:05:00Z','IP TEST'),...Array.from({length:300},(_,i)=>tx('t'+i,'expense',10,'2026-07-20T10:00:00Z','STOLOVAYA '+i))];
 S.importJSON(JSON.stringify(data));
});
await page.reload();await page.locator('#selected-month').fill('2026-07');await page.locator('#selected-month').dispatchEvent('change');
assert.ok(!(await page.locator('#view').textContent()).includes('Прочее'));
assert.ok(!(await page.locator('.tx-name').allTextContents()).includes('IP TEST'));
await page.waitForTimeout(500);await page.screenshot({path:'/tmp/audit-home.png',fullPage:true});
await page.locator('#show-month-ops').click();assert.equal(await page.locator('.tx-row').count(),50);
await page.locator('#ops-next').click();assert.equal(await page.locator('.tx-row').count(),50);
await page.locator('#ops-audit').selectOption('duplicates');await page.locator('[data-select="copy"]').check();await page.locator('details').first().locator('summary').click();await page.locator('#exclude-selected').click();
const totals=await page.evaluate(async()=>(await import('/js/store.js')).monthTotals('2026-07'));assert.deepEqual(totals,{income:50000,expense:4234.56});
await page.locator('#ops-audit').selectOption('excluded');await page.locator('[data-select="copy"]').check();await page.locator('details > summary').first().click();await page.locator('#restore-selected').click();
assert.equal(await page.evaluate(async()=>(await import('/js/store.js')).monthTotals('2026-07').expense),5469.12);
await page.locator('#ops-audit').selectOption('duplicates');await page.locator('[data-select="copy"]').check();await page.locator('details > summary').first().click();await page.locator('#exclude-selected').click();

await page.locator('[data-tab="home"]').click();await page.locator('#next-m').click();assert.equal(await page.locator('.tx-row').count(),1);
await page.locator('[data-quality="unassigned"]').click();await page.locator('details > summary').first().click();await page.locator('#select-visible').click();await page.locator('#batch-category').selectOption('cafe');await page.locator('#batch-apply').click();assert.equal(await page.locator('.tx-row').count(),0);
await page.locator('[data-tab="home"]').click();await page.locator('#fab').click();await page.locator('#f-amount').fill('1 500,50');await page.locator('#f-note').fill('MANUAL TEST');await page.locator('#f-date').fill('2026-08-02T00:30');await page.locator('[data-id="food"]').click();await page.locator('#tx-save').click();
let tx=await page.evaluate(async()=>(await import('/js/store.js')).getState().transactions.find(t=>t.note==='MANUAL TEST'));assert.equal(tx.amount,1500.5);assert.equal(tx.date,'2026-08-01T21:30:00.000Z');
await page.locator('.tx-row').filter({hasText:'MANUAL TEST'}).click();assert.equal(await page.locator('#f-date').inputValue(),'2026-08-02T00:30');await page.locator('#f-amount').fill('1500garbage');await page.locator('#tx-save').click();assert.equal(await page.locator('#tx-save').count(),1);await page.locator('#f-amount').fill('1500,50');await page.locator('#tx-save').click();
for(const tab of ['stats','ai','more','home']){await page.locator(`[data-tab="${tab}"]`).click();assert.ok((await page.locator('#view').textContent()).length>20);}
await page.locator('[data-tab="more"]').click();await page.locator('#m-cats').click();assert.ok(!(await page.locator('.modal').textContent()).includes('Прочее'));await page.locator('#cat-close').click();
await page.locator('[data-tab="stats"]').click();await page.waitForTimeout(2400);await page.screenshot({path:'/tmp/audit-stats.png',fullPage:true});
for(const width of [360,390,560]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'horizontal overflow '+width);}
await page.locator('[data-tab="more"]').click();await page.locator('#m-statement').click();
await page.locator('#st-account').selectOption('main');await page.locator('#st-file').setInputFiles({name:'test.csv',mimeType:'text/csv',buffer:Buffer.from('Дата;Сумма;Описание\n02.09.2026;-25,50;DIXY\n03.09.2026;+100;Возврат')});await page.locator('#st-import').waitFor();assert.equal(await page.locator('[data-row]').count(),2);await page.locator('#st-import').click();assert.equal(await page.locator('#st-import').isDisabled(),true);await page.locator('#st-close').click();
await page.locator('#m-backup').click();const backup=await page.evaluate(async()=>(await import('/js/store.js')).exportJSON());await page.locator('#b-text').fill(backup);page.once('dialog',d=>d.accept());await page.locator('#b-import').click();assert.deepEqual(await page.evaluate(async()=>(await import('/js/store.js')).monthTotals('2026-09')),{income:100,expense:25.5});
assert.deepEqual(errors,[]);console.log('Browser tests passed: pagination, duplicates, category repair, Moscow dates, grouped decimal input, validation, all tabs, narrow layouts.');
} finally { await browser.close();server.close(); }
