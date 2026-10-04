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
export function parseStatementText(text) {
  if(String(text).length>10000000)throw new Error('Слишком большой текст. Разделите выписку по периодам.');
  const tabular=parseCsv(String(text));if(tabular)return tabular;
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
  return {operations,rejected,format:'text'};
}
export function prepareStatement(result,accountId,state=getState()) {
  const counts=new Map();
  return result.operations.map(op=>{
    // Full canonical key avoids hash collisions; occurrence preserves identical rows.
    const base=JSON.stringify(op.externalId ? [accountId,'id',op.externalId] : [accountId,op.date,op.type,op.amount,op.note.toLowerCase()]);
    const occurrence=op.externalId?1:(counts.get(base)||0)+1;counts.set(base,occurrence);
    const statementKey=base+'#'+occurrence;
    const duplicate=state.transactions.some(t=>t.statementKey===statementKey);
    const possibleDuplicate=!duplicate && state.transactions.some(t=>t.accountId===accountId&&t.type===op.type&&t.amount===op.amount&&String(t.date).slice(0,10)===op.date.slice(0,10));
    return {...op,statementKey,accountId,duplicate,possibleDuplicate};
  });
}
export function importStatement(rows,accountId) {
  const st=getState(),snapshot=JSON.parse(JSON.stringify(st));
  if(!st.accounts.some(a=>a.id===accountId))throw new Error('Выберите существующий счёт');
  let count=0;
  try {
    for(const row of rows) {
      if(row.accountId!==accountId || !operation(row.date,row.amount,row.type,row.note,row.raw))throw new Error('Неверная операция');
      if(st.transactions.some(t=>t.statementKey===row.statementKey))continue;
      st.transactions.unshift({id:'st_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2),
        date:row.date,type:row.type,amount:row.amount,note:row.note,categoryId:row.categoryId,accountId,
        source:'statement',statementKey:row.statementKey});count++;
    }
    if(count)save();return count;
  }catch(error){Object.assign(st,snapshot);throw error;}
}
