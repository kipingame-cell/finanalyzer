import { guessCategory } from './categories.js';
export { guessCategory } from './categories.js';
import { isOwnTransfer } from './transfers.js';
// Conservative notification parser: require an operation, never use an account balance as its amount.
import { KNOWN_BANK_PACKAGES } from './config.js';
export const BANKS = [
  { id: 'sber',    name: 'Сбер',           pkgs: ['ru.sberbankmobile'], senders: ['900', 'sberbank', 'сбербанк'], kw: ['сбербанк', 'sberbank', 'мир сбер'] },
  { id: 'vtb',     name: 'ВТБ',            pkgs: ['ru.vtb24.mobilebanking.android'], senders: ['vtb', 'втб'], kw: ['втб', 'vtb'] },
  { id: 'tbank',   name: 'Т-Банк',         pkgs: ['com.idamob.tinkoff.android', 'ru.tinkoff.investing'], senders: ['tinkoff', 'тинькофф', 't-bank', 'т-банк'], kw: ['тинькофф', 'т-банк', 'tinkoff'] },
  { id: 'alfa',    name: 'Альфа-Банк',     pkgs: ['ru.alfabank.mobile.android'], senders: ['alfa-bank', 'alfabank', 'альфа-банк'], kw: ['альфа-банк', 'alfa-bank', 'альфа-банка'] },
  { id: 'yandex',  name: 'Яндекс Банк',    pkgs: ['ru.yandex.bank', 'ru.yandex.pay', 'ru.yandex.money'], senders: ['yandex bank', 'яндекс банк'], kw: ['яндекс банк', 'yandex bank', 'яндекс.банк', 'пэй счёт', 'pay счёт'] },
  { id: 'ozon',    name: 'Ozon Банк',      pkgs: ['ru.ozon.app.android'], senders: ['ozon', 'ozonbank', 'ozon банк', 'озон банк'], kw: ['ozon банк', 'озон банк', 'ozon bank', 'карта ozon'] },
  { id: 'wb',      name: 'WB Банк',        pkgs: ['com.wildberries.ru'], senders: ['wildberries', 'вайлдберриз', 'wb банк'], kw: ['wb банк', 'wildberries банк', 'вб банк'] },
  { id: 'raif',    name: 'Райффайзен',     pkgs: ['ru.ftc.faktura.raiffeisen'], senders: ['raiffeisen', 'райффайзен'], kw: ['райффайзен', 'raiffeisen'] },
  { id: 'gazprom', name: 'Газпромбанк',    pkgs: ['ru.gazprombank.android.mobilebank.app'], senders: ['gazprombank', 'газпромбанк'], kw: ['газпромбанк', 'gazprombank'] },
  { id: 'open',    name: 'Открытие',       pkgs: ['ru.openbank'], senders: ['открытие', 'openbank'], kw: ['банк открытие', 'openbank'] },
  { id: 'sovkom',  name: 'Совкомбанк',     pkgs: ['com.sovkombank.mobile'], senders: ['совкомбанк', 'sovcombank'], kw: ['совкомбанк', 'халва'] },
  { id: 'pochta',  name: 'Почта Банк',     pkgs: ['ru.letobank.Prometheus'], senders: ['почта банк', 'pochtabank'], kw: ['почта банк', 'pochta bank'] },
  { id: 'mts',     name: 'МТС Банк',       pkgs: ['ru.mts.money', 'ru.mtsbank'], senders: ['мтс банк', 'mts bank', 'mts-bank'], kw: ['мтс банк', 'mts bank', 'мтс деньги'] },
  { id: 'otp',     name: 'ОТП Банк',       pkgs: ['ru.otpbank.mobile'], senders: ['отп банк', 'otp bank', 'otpbank'], kw: ['отп банк', 'otp bank'] },
  { id: 'rosbank', name: 'Росбанк',        pkgs: ['ru.rosbank.android'], senders: ['росбанк', 'rosbank'], kw: ['росбанк', 'rosbank'] },
  { id: 'psb',     name: 'Промсвязьбанк',  pkgs: ['ru.psb.mobile'], senders: ['псб', 'psbank', 'psb'], kw: ['промсвязьбанк'] },
  { id: 'ubrr',    name: 'УБРиР',          pkgs: ['ru.ubrr.mobile'], senders: ['убрир', 'ubrr'], kw: ['убрир', 'ubrr'] },
  { id: 'akbars',  name: 'Ак Барс',        pkgs: ['ru.akbars.mobile'], senders: ['ак барс', 'ak bars', 'akbars'], kw: ['ак барс', 'ak bars'] },
  { id: 'rnkb',    name: 'РНКБ',           pkgs: ['ru.rnkb.dbo'], senders: ['рнкб', 'rnkb'], kw: ['рнкб', 'rnkb'] },
  { id: 'domrf',   name: 'ДОМ.РФ',         pkgs: ['ru.dom.rfbank'], senders: ['дом.рф', 'domrf'], kw: ['дом.рф', 'dom.rf'] },
];
const UNKNOWN_BANK = { id: 'other', name: 'Банк' };

function detectBank(pkg, title, fullText) {
  const p = (pkg || '').toLowerCase();
  for (const b of BANKS) if (b.pkgs.some(x => p === x)) return b;
  const t = (title || '').toLowerCase().trim();
  if (t) {
    for (const b of BANKS) if (b.senders.some(s => t === s || t.includes(s))) return b;
  }
  const low = (fullText || '').toLowerCase();
  for (const b of BANKS) if (b.kw.some(k => low.includes(k))) return b;
  return UNKNOWN_BANK;
}


const MONEY = /([+−-]?\s*(?:\d{1,3}(?:[ ,]\d{3})+|\d+)(?:[.,]\d{1,2})?)\s*(₽|руб(?:лей|ля|ль|\.)?|RUB|RUR|[рp])(?=$|[^a-zа-яё])/gi;
const INCOME = /зачислен[a-zа-яё]*|пополнен[a-zа-яё]*|возврат[a-zа-яё]*|к[эе]шб[эе]к|cashback|зарплат[a-zа-яё]*|аванс|преми[a-zа-яё]*|поступлен[a-zа-яё]*|вам перевели|получен перевод|начислен[a-zа-яё]*|перевод\s+от/gi;
const EXPENSE = /списан[a-zа-яё]*|покупк[a-zа-яё]*|оплат[a-zа-яё]*|перевод[a-zа-яё]*|снят[a-zа-яё]*|выдача наличных|плат[её]ж[a-zа-яё]*|удержан[a-zа-яё]*|комиссия|payment|purchase|подписка/gi;
const REJECT = /одноразов|подтверждени|парол|никому не сообщайте|\bOTP\b|(?:^|\s)код(?:\s|:)|отклон[её]н|отказ|не выполнен|не исполнен|не прош[её]л|недостаточно средств|отмен[её]н|оформите|предодобрен|скидк|кредитный лимит|успейте/i;
const BALANCE = /баланс|остаток|доступно|лимит/i;
function normalize(value) { return String(value ?? '').replace(/[\u00a0\u202f\t]/g, ' ').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/ +/g, ' ').trim(); }
export function notifHash(pkg, title, text) {
  const s = `${pkg || ''}|${title || ''}|${text || ''}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(36);
}
function numeric(raw) {
  let s = raw.replace(/[+−\-\s]/g, '');
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function operation(text) {
  if (REJECT.test(text)) return null;
  const markers = [ ...text.matchAll(INCOME)].map(m => ({start:m.index,end:m.index+m[0].length,type:'income'}));
  for (const m of text.matchAll(EXPENSE)) {
    if (!markers.some(x=> m.index >= x.start && m.index < x.end)) markers.push({start:m.index,end:m.index+m[0].length,type:'expense'});
  }
  markers.sort((a,b)=>a.start-b.start);
  if (!markers.length) return null;
  const candidates = [];
  let balance = null;
  for (const m of text.matchAll(MONEY)) {
    const amount = numeric(m[1]);
    const prefix = text.slice(0,m.index);
    const lastBalance = [...prefix.matchAll(/баланс|остаток|доступно|лимит/gi)].pop();
    const before = markers.filter(x=>x.start < m.index).pop();
    if (lastBalance && (!before || lastBalance.index > before.start)) { if (balance === null) balance = amount; continue; }
    if (amount === null || amount <= 0) continue;
    const nearest = before || markers.find(x=>x.start >= m.index && x.start-m.index-m[0].length < 45);
    if (!nearest) continue;
    candidates.push({amount, index:m.index, end:m.index+m[0].length, type:nearest.type, marker:nearest});
  }
  // Multiple operation amounts need review; never silently merge two operations.
  if (candidates.length !== 1) return null;
  const selected = candidates[0];
  if (selected.type === 'expense' && /перевод/i.test(text.slice(selected.marker.start, selected.marker.end)) && /^\s*от\s+/i.test(text.slice(selected.end))) selected.type = 'income';
  return {...selected, balance};
}
export function isFinancialText(text) { return !!operation(normalize(text)); }
function last4(text) {
  const m = text.match(/(?:сч[её]т|карт[аы]|mir|visa|mastercard|мир)\s*[*•xх.\-]*\s*(\d{4,})/i) || text.match(/[*•]{1,4}\s*(\d{4})\b/);
  return m ? m[1].slice(-4) : '';
}
function merchant(text, op) {
  let tail = text.slice(op.end).replace(/^[\s,;:.—–-]+/, '').replace(/^(?:в|на|за|от|получателю)\s+/i, '');
  tail = tail.split(/баланс|остаток|доступно|лимит|карт[аы]|сч[её]т|комиссия|к[эе]шб[эе]к|\n/i)[0];
  tail = tail.replace(/\s+\d{2}[.:]\d{2}.*$/, '').replace(/[\s,;:.]+$/, '').trim();
  if (tail && !/^(?:RUB|RUR|СБП|SBP|выполнен|успешно|зачислен)/i.test(tail)) return tail.slice(0,80);
  const prefix = text.slice(op.marker.end, op.index).replace(/[*•]\d{4}/g,'').replace(/^[\s:;,—–-]+|[\s:;,—–-]+$/g,'');
  return prefix && !/карт|сч[её]т|\d{4}/i.test(prefix) ? prefix.slice(0,80) : '';
}
export function parseNotification(pkg, title, text) {
  const full = normalize(`${title || ''}\n${text || ''}`);
  const op = operation(full);
  if (!op) return null;
  const bank = detectBank(pkg, title, full);
  // Ignore unrelated shopping/chat notifications. Manual paste remains available.
  if (pkg && pkg !== 'manual-paste' && bank.id === 'other' && !KNOWN_BANK_PACKAGES.includes(pkg)) return null;
  const card = last4(full);
  let note = merchant(full,op);
  if (op.type === 'income') {
    for (const [re,label] of [[/зарплат/i,'Зарплата'],[/аванс/i,'Аванс'],[/преми/i,'Премия'],[/возврат/i,'Возврат'],[/к[эе]шб[эе]к|cashback/i,'Кэшбэк']]) if (re.test(full)) {note=label;break;}
  }
  return {type:op.type, amount:op.amount, ownTransfer:isOwnTransfer({note:full}), categoryId:guessCategory(full,op.type),
    note:note || normalize(title).slice(0,80), source:'notification', hash:notifHash(pkg,title,text),
    contentHash: notifHash(bank.id, '', normalize(text).toLowerCase()),
    rawText:full.slice(0,1000), bankId:bank.id, bankName:bank.name, last4:card,
    accountId:bank.id === 'other' && !card ? '' : bank.id+(card ? '_'+card : ''),
    accountName:bank.id === 'other' && !card ? '' : bank.name+(card ? ' •'+card : ''), balance:op.balance};
}
export function parseNotificationList(items, seenHashes = [], dismissedHashes = []) {
  const ignored = new Set([...seenHashes,...dismissedHashes]);
  const unique = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object') continue;
    const p = parseNotification(it.pkg,it.title,it.text);
    if (!p || ignored.has(p.hash)) continue;
    const ts = Number(it.ts);
    if (it.smsId) p.smsId = String(it.smsId);
    p.ts = Number.isFinite(ts) && ts > 0 ? ts : Date.now();
    // Android updates of one notification share its key and post time;
    // separate identical purchases at different times must remain separate.
    if (it.key && ts > 0) {
      const legacyHash = p.hash;
      p.hash = notifHash(it.pkg,it.key,String(ts));
      if (ignored.has(p.hash) || ignored.has(legacyHash)) continue;
    }
    unique.set(p.hash,p);
  }
  return [...unique.values()].sort((a,b)=>b.ts-a.ts);
}
export function parsePastedText(text) {
  const chunks = String(text || '').split(/\n\s*\n|\n(?=(?:Покупка|Оплата|Перевод|Списание|Зачисление|Пополнение|MIR-|VISA-|СЧ[ЕЁ]Т))/i).map(s=>s.trim()).filter(Boolean);
  return chunks.map(c=>parseNotification('manual-paste','',c)).filter(Boolean);
}
