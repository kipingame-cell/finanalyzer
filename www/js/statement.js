import {bankDateKey} from './dates.js';
// Explicit, reviewable imports. An unsigned, unclassified amount is never a debit by default.
import {guessCategory, parseNotification} from './parser.js';
import {getState, save} from './store.js';
const norm = s => String(s ?? '').replace(/[\u00a0\u202f]/g,' ').replace(/\s+/g,' ').trim();
const DATE = /\b(\d{2})\.(\d{2})\.(\d{4})(?:[ T]+(\d{2}):(\d{2})(?::(\d{2}))?)?/;
export function statementDate(value) {
  const s=norm(value), m=s.match(DATE);
  let y,mo,d,h=12,mi=0,se=0;
  if(m) { [,d,mo,y]=m; if(m[4]) {h=+m[4];mi=+m[5];se=+(m[6]||0);} }
  else { const iso=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/); if(!iso)return null; [,y,mo,d]=iso; if(iso[4]){h=+iso[4];mi=+iso[5];se=+(iso[6]||0);} }
  y=+y;mo=+mo;d=+d;
  if(y<1900 || mo<1 || mo>12 || d<1 || h>23 || mi>59 || se>59)return null;
  const check=new Date(Date.UTC(y,mo-1,d));
  if(check.getUTCDate()!==d)return null;
  // Bank statement dates are interpreted in Moscow time, independent of phone timezone.
  return new Date(Date.UTC(y,mo-1,d,h-3,mi,se)).toISOString();
}
function money(value) {
  const s=norm(value).replace(/(?:₽|руб\.?|RUB|RUR)/gi,'').replace(/ /g,'').replace(/[−–]/g,'-').replace(',','.');
  if(!/^[+-]?\d+(?:\.\d{1,2})?$/.test(s))return null;
  const n=Number(s);return Number.isFinite(n)&&Number.isSafeInteger(Math.round(n*100))?n:null;
}
function kind(value) {
  const s=norm(value).toLowerCase();
  if(/отмен|отклон|ожида|в процессе|заблокир|cancel|declin|pending|failed|revers/.test(s))return 'skip';
  if(/пополн|зачисл|возврат|доход|приход|поступ|перевод от|income|credit/.test(s))return 'income';
  if(/расход|списан|оплат|покуп|снятие|исходящ|expense|debit|комиссия/.test(s))return 'expense';
  return null;
}
function operation(date,amount,type,note,raw,id='') {
  if(!date || !Number.isFinite(Date.parse(date)) || !Number.isFinite(amount) || amount<=0 || !['income','expense'].includes(type))return null;
  return {date,amount:Math.round(amount*100)/100,type,note:norm(note).slice(0,160),categoryId:guessCategory(note,type),raw,externalId:norm(id)};
}
export function csvRows(text,delimiter) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(c===delimiter&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw new Error('CSV: незакрытые кавычки');
  row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;
}
function headerMap(row) {
  const h=row.map(x=>norm(x).toLowerCase().replace(/^\ufeff/,''));
  const find=re=>h.findIndex(x=>re.test(x));
  return {date:find(/^(дата(?: и время)?(?: совершения)?(?: операции| платежа| проводки)?|date)$/),
    amount:find(/^(сумма(?: операции| в рублях| в валюте сч[её]та)?|amount)$/),
    debit:find(/^(расход|списание|дебет|debit)(?:,? руб\.?)?$/),credit:find(/^(приход|зачисление|кредит|credit)(?:,? руб\.?)?$/),
    note:find(/описание|назначение|наименование|получатель|детали операции|merchant|description/),
    type:find(/^(тип|вид|тип операции|вид операции|type)$/),currency:find(/валюта|currency/),status:find(/статус|status/),id:find(/^(id|идентификатор|номер операции|идентификатор операции)$/)};
}
function parseCsv(text) {
  for(const sep of [';','\t',',']) {
    let rows; try { rows=csvRows(text,sep); } catch { continue; }
    const header=rows.findIndex(r=>{const m=headerMap(r);return m.date>=0&&(m.amount>=0||m.debit>=0||m.credit>=0);});
    if(header<0)continue;
    const map=headerMap(rows[header]), operations=[], rejected=[];
    for(const row of rows.slice(header+1)) {
      if(headerMap(row).date>=0)continue;
      const get=k=>map[k]>=0?row[map[k]]||'':'';
      const raw=row.join(' | '),date=statementDate(get('date'));
      const reject=reason=>rejected.push({raw,reason});
      if(!date){reject('Нет корректной даты');continue;}
      if(get('currency')&&!/^(RUB|RUR|₽|руб\.?|643)$/i.test(norm(get('currency')))){reject('Валюта не RUB');continue;}
      if(kind(get('status'))==='skip'){reject('Операция не завершена');continue;}
      let amount,type;
      if(map.debit>=0||map.credit>=0) {
        const debit=money(get('debit')||'0'),credit=money(get('credit')||'0');
        if(debit===null||credit===null||debit<0||credit<0||Boolean(debit)===Boolean(credit)){reject('Неоднозначные колонки прихода/расхода');continue;}
        type=debit?'expense':'income';amount=debit||credit;
      } else {
        const n=money(get('amount')),hint=kind(get('type')+' '+get('note'));
        if(n===null||n===0){reject('Неверная сумма');continue;}
        type=/^[−–-]/.test(norm(get('amount')))?'expense':/^\+/.test(norm(get('amount')))?'income':hint;
        if(hint==='skip'||(hint&&type&&hint!==type)){reject('Тип операции противоречит сумме');continue;}
        amount=Math.abs(n);
      }
      const op=operation(date,amount,type,get('note'),raw,get('id'));
      if(op)operations.push(op);else reject('Не определён приход или расход');
    }
    return {operations,rejected,format:'table'};
  }
  return null;
}
// Yandex PDF tables can interleave description, operation date, posting date,
// amount in operation currency and amount in account currency on the same line.
function parseYandexBlocks(text) {
  const totals={income:null,expense:null};
  for(const m of norm(text).matchAll(/Всего\s+(приходных|расходных)\s+операций\s+([+−–-]?\s*(?:\d{1,3}(?: \d{3})+|\d+)[.,]\d{2})\s*(?:₽|руб\.?|RUB|RUR|[рp])(?=$|[^a-zа-яё])/gi)) {
    const n=money(m[2]);if(n!==null)totals[m[1].toLowerCase()==='приходных'?'income':'expense']=Math.abs(n);
  }
  // Page furniture can occur inside a wrapped transaction. Remove only known
  // header/footer lines, retaining the continuation of the transaction itself.
  text=text.replace(/^\s*(?:Продолжение на следующей странице|Страница\s+\d+\s+из\s+\d+|Описание операции\s+Дата.*|Сумма в валюте(?:\s+Сумма в валюте)?|операции обработки операции ЭСП|МСК\s+МСК)\s*$/gmi,'');
  // Summary totals and bank signature/address are not transaction rows.
  text=text.split(/(?:Всего\s+(?:приходных|расходных)\s+операций|С уважением,)/i)[0];

  // Balance rows delimit records but are never transactions (also in flattened text).
  text=text.replace(/(?:Входящий|Исходящий)\s+остаток\s+за\s+\d{2}\.\d{2}\.\d{4}\s+[+−–-]?\s*[\d ]+[.,]\d{2}\s*(?:₽|руб\.?|RUB|RUR)/gi,' ');

  const start = /(?:внутрибанковский\s+перевод\s+на|отмена\s+оплаты\s+услуг|исходящий перевод(?:\s+СБП)?|входящий перевод(?:\s+СБП)?|оплата\s+(?:СБП|Сбер)\s+QR|возврат\s+средств(?:\s+СБП\s+QR)?|оплата товаров и услуг|возврат(?:\s+за)?(?:\s+оплаты|\s+покупки|\s+товаров и услуг)|пополнение сч[её]та|зачисление денежных средств|выплата процентов|начисление процентов|снятие наличных)/gi;
  const markers=[...text.matchAll(start)];
  if(!markers.length)return null;
  const datesRe=/\b\d{2}\.\d{2}\.\d{4}\b/g;
  // Activate only for the observed two-date bank table, not ordinary pasted messages.
  if(!markers.some((m,i)=>(text.slice(m.index,markers[i+1]?.index??text.length).match(datesRe)||[]).length>=2))return null;
  const operations=[],rejected=[];
  for(let i=0;i<markers.length;i++) {
    const raw=norm(text.slice(markers[i].index,markers[i+1]?.index??text.length));
    const reject=reason=>rejected.push({raw,reason});
    const dates=[...raw.matchAll(datesRe)];
    if(dates.length!==2){reject('Ожидались две даты одной операции; проверьте разбиение строк');continue;}
    if(!dates.every(d=>statementDate(d[0]))){reject('Некорректная дата операции');continue;}
    if(/USD|EUR|[$€]/i.test(raw)){reject('Разные валюты: требуется сверка суммы в валюте счёта');continue;}
    const reversal=/^отмена\s+оплаты\s+услуг$/i.test(markers[i][0]);
    if(/отклон[а-яё]*|не выполнен/i.test(raw)||(!reversal&&/отмен[а-яё]*/i.test(raw))){reject('Операция не завершена');continue;}
    const amountRe=/([+−–-]?\s*(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)[.,]\d{2})\s*(?:₽|руб\.?|RUB|RUR|[рp])(?=$|[^a-zа-яё])/gi;
    const amounts=[...raw.matchAll(amountRe)];
    if(amounts.length!==2){reject('Ожидались две суммы в колонках выписки');continue;}
    const values=amounts.map(m=>money(m[1]));
    if(values.some(v=>v===null||v===0)||values[0]!==values[1]){reject('Суммы в двух колонках различаются — нужна проверка');continue;}
    const type=reversal||/^(?:входящий|возврат|пополнение|зачисление|выплата|начисление)/i.test(markers[i][0])?'income':'expense';
    if(reversal&&!amounts.every(m=>/^\+/.test(m[1].trim()))){reject('Отмена оплаты требует положительного зачисления в обеих колонках');continue;}
    const signed=amounts.some(m=>/^[+−–-]/.test(m[1].trim()));
    if(signed&&((values[0]<0)!==(type==='expense'))){reject('Знак суммы противоречит типу операции');continue;}
    const time=raw.match(/(?:\sв\s+|\s)(\d{2}:\d{2})(?::(\d{2}))?(?!\d)/);
    const date=statementDate(dates[0][0]+(time?' '+time[1]+(time[2]?':'+time[2]:''):''));
    let note=raw.replace(amountRe,' ').replace(datesRe,' ').replace(/\sв\s+\d{2}:\d{2}(?::\d{2})?/g,' ');
    note=norm(note.replace(/\*\d{4}\b/g,''));
    const op=operation(date,Math.abs(values[0]),type,note,raw);
    if(op){op.postingDate=statementDate(dates[1][0]);operations.push(op);}else reject('Некорректная операция');
  }
  const calculated={income:0,expense:0};
  for(const op of operations)calculated[op.type]+=Math.round(op.amount*100);
  const reconciliation=Object.fromEntries(['income','expense'].map(type=>[type,{
    expected:totals[type],actual:calculated[type]/100,
    difference:totals[type]===null?null:(calculated[type]-Math.round(totals[type]*100))/100
  }]));
  return {operations,rejected,format:'yandex-pdf',reconciliation};
}

export function parseStatementText(text) {
  if(String(text).length>10000000)throw new Error('Слишком большой текст. Разделите выписку по периодам.');
  text=String(text).replace(/[\u00a0\u202f]/g,' ');
  const tabular=parseCsv(text);if(tabular)return tabular;
  const yandex=parseYandexBlocks(text);if(yandex)return yandex;
  const operations=[],rejected=[];let block='';
  const flush=()=>{
    if(!block)return;
    const raw=block.trim(),m=raw.match(DATE),date=statementDate(m?.[0]);
    const body=raw.slice((m?.index||0)+(m?.[0].length||0)).replace(DATE,'').trim();
    const reject=reason=>rejected.push({raw,reason});
    if(!date){reject('Нет корректной даты');return;}
    if(/^(?:баланс|остаток|итого|оборот)/i.test(body)){reject('Итог или остаток, не операция');return;}
    if(kind(body)==='skip'){reject('Операция не завершена');return;}
    if(/USD|EUR|[$€]/i.test(body)){reject('Сумма в другой валюте требует проверки');return;}
    const signed=[...body.matchAll(/(?:^|[\s|;])([+−–-]\s*(?:\d{1,3}(?: \d{3})+|\d+)(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|RUB|RUR)(?=$|[^a-zа-яё])/gi)];
    let op;
    if(signed.length===1) {
      const amounts=[...body.matchAll(/\d[\d ]*(?:[.,]\d{1,2})?\s*(?:₽|руб\.?|RUB|RUR)(?=$|[^a-zа-яё])/gi)];
      if(amounts.length!==1){reject('Несколько денежных сумм: требуется проверка');return;}
      const n=money(signed[0][1]);
      const hint=kind(body);
      if(n!==null && (!hint || hint===(n<0?'expense':'income')))op=operation(date,Math.abs(n),n<0?'expense':'income',body.replace(signed[0][0],'').replace(/[|;]/g,' '),raw);
    } else if(signed.length===0) {
      const p=parseNotification('manual-paste','',body);
      if(p)op=operation(date,p.amount,p.type,p.note||body,raw);
    }
    if(op)operations.push(op);else reject('Нет однозначной суммы и типа операции');
  };
  for(const line of String(text).split(/\r?\n/)) {
    if(/^\s*\d{2}\.\d{2}\.\d{4}\b/.test(line)){flush();block=line;}
    else if(block && line.trim() && !/^(?:итого|всего|остаток|страница|дата операции|АО |выписка|оборот)/i.test(line.trim()))block+=' '+line;
    else if(block){flush();block='';}
  }
  flush();
  if(!operations.length&&!rejected.length&&text.trim())rejected.push({raw:text.trim(),reason:'Текст извлечён, но формат строк не распознан'});
  return {operations,rejected,format:'text'};
}
export function prepareStatement(result,accountId,state=getState()) {
  const counts=new Map();
  const keys=new Set(state.transactions.map(t=>t.statementKey).filter(Boolean));
  const amounts=new Set(state.transactions.filter(t=>!t.excluded).map(t=>[t.type,Math.round(Number(t.amount)*100),bankDateKey(t.date)].join('|')));
  return result.operations.map(op=>{
    // Full canonical key avoids hash collisions; occurrence preserves identical rows.
    const base=JSON.stringify(op.externalId ? [accountId,'id',op.externalId] : [accountId,op.date,op.type,op.amount,op.note.toLowerCase()]);
    const occurrence=op.externalId?1:(counts.get(base)||0)+1;counts.set(base,occurrence);
    const statementKey=base+'#'+occurrence;
    const duplicate=keys.has(statementKey);
    const possibleDuplicate=!duplicate && amounts.has([op.type,Math.round(op.amount*100),bankDateKey(op.date)].join('|'));
    return {...op,statementKey,accountId,duplicate,possibleDuplicate};
  });
}
export function importStatement(rows,accountId) {
  const st=getState(),snapshot=JSON.parse(JSON.stringify(st));
  if(!st.accounts.some(a=>a.id===accountId))throw new Error('Выберите существующий счёт');
  let count=0;
  const keys=new Set(st.transactions.map(t=>t.statementKey).filter(Boolean)),added=[];
  try {
    for(const row of rows) {
      if(row.accountId!==accountId || !operation(row.date,row.amount,row.type,row.note,row.raw))throw new Error('Неверная операция');
      if(!row.statementKey)throw new Error('Не найден ключ операции');
      if(keys.has(row.statementKey))continue;
      keys.add(row.statementKey);
      added.push({id:'st_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2),
        date:row.date,type:row.type,amount:row.amount,note:row.note,categoryId:row.categoryId,accountId,
        source:'statement',statementKey:row.statementKey,postingDate:row.postingDate});count++;
    }
    if(count){st.transactions=[...added.reverse(),...st.transactions];save();}return count;
  }catch(error){Object.assign(st,snapshot);throw error;}
}
