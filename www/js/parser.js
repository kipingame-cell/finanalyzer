// Банковское уведомление → проверяемый черновик. Запись делает только пользователь.
import { CATEGORY_KEYWORDS, DEFAULT_CATEGORIES } from './config.js';

export const BANKS = [
  { id:'sber', name:'Сбер', pkgs:['ru.sberbankmobile'], senders:['900','сбер','сбербанк','sberbank'] },
  { id:'vtb', name:'ВТБ', pkgs:['ru.vtb24.mobilebanking.android'], senders:['втб','vtb'] },
  { id:'tbank', name:'Т-Банк', pkgs:['com.idamob.tinkoff.android','ru.tinkoff.investing'], senders:['т-банк','t-bank','тинькофф','tinkoff','tbank'] },
  { id:'alfa', name:'Альфа-Банк', pkgs:['ru.alfabank.mobile.android'], senders:['альфа-банк','alfa-bank','alfabank'] },
  { id:'yandex', name:'Яндекс Банк', pkgs:['ru.yandex.bank','ru.yandex.pay','ru.yandex.money'], senders:['яндекс банк','яндекс.банк','yandex bank'] },
  { id:'ozon', name:'Ozon Банк', pkgs:['ru.ozon.app.android'], senders:['ozon банк','ozon bank','озон банк','ozon'] },
  { id:'wb', name:'WB Банк', pkgs:['com.wildberries.ru'], senders:['wb банк','wildberries банк','вб банк'] },
  { id:'raif', name:'Райффайзен', pkgs:['ru.ftc.faktura.raiffeisen'], senders:['райффайзен','raiffeisen'] },
  { id:'gazprom', name:'Газпромбанк', pkgs:['ru.gazprombank.android.mobilebank.app'], senders:['газпромбанк','gazprombank'] },
  { id:'open', name:'Открытие', pkgs:['ru.openbank'], senders:['банк открытие','openbank'] },
  { id:'sovkom', name:'Совкомбанк', pkgs:['com.sovkombank.mobile'], senders:['совкомбанк','sovcombank'] },
  { id:'pochta', name:'Почта Банк', pkgs:['ru.letobank.Prometheus'], senders:['почта банк','pochtabank'] },
  { id:'mts', name:'МТС Банк', pkgs:['ru.mts.money','ru.mtsbank'], senders:['мтс банк','mts bank'] },
  { id:'otp', name:'ОТП Банк', pkgs:['ru.otpbank.mobile'], senders:['отп банк','otp bank'] },
  { id:'rosbank', name:'Росбанк', pkgs:['ru.rosbank.android'], senders:['росбанк','rosbank'] },
  { id:'psb', name:'Промсвязьбанк', pkgs:['ru.psb.mobile'], senders:['псб','промсвязьбанк','psbank'] },
  { id:'ubrr', name:'УБРиР', pkgs:['ru.ubrr.mobile'], senders:['убрир','ubrr'] },
  { id:'akbars', name:'Ак Барс', pkgs:['ru.akbars.mobile'], senders:['ак барс','ak bars'] },
  { id:'rnkb', name:'РНКБ', pkgs:['ru.rnkb.dbo'], senders:['рнкб','rnkb'] },
  { id:'domrf', name:'ДОМ.РФ', pkgs:['ru.dom.rfbank'], senders:['дом.рф','domrf'] },
];
const UNKNOWN = { id:'other', name:'Банк' };
const SMS_PACKAGES = new Set(['com.google.android.apps.messaging','com.android.messaging','com.android.mms',
  'com.samsung.android.messaging','ru.samsung.android.messaging','com.miui.smsextra']);
const CATEGORY_TYPE = new Map(DEFAULT_CATEGORIES.map(c => [c.id, c.type]));
const norm = s => String(s || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
const low = s => norm(s).toLocaleLowerCase('ru-RU');

function detectBank(pkg, title) {
  const id = low(pkg), sender = low(title);
  const byPackage = BANKS.find(b => b.pkgs.some(p => p.toLowerCase() === id));
  if (byPackage) return byPackage;
  // Никогда не определяем банк по тексту покупки: OZON может быть магазином у Сбера.
  return BANKS.find(b => b.senders.some(s => sender === s ||
    (s.length >= 4 && sender.includes(s) && !/[a-zа-яё0-9]/iu.test(sender[sender.indexOf(s)-1] || ' ')))) || UNKNOWN;
}

const MONEY_RE = /(?<!\d)(\d{1,3}(?:[ .\u00a0\u202f]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(₽|руб(?:лей|ля|ль|\.)?|rub|rur|[рp](?![a-zа-яё]))/giu;
const BALANCE_RE = /(?:баланс|остаток|доступно|на сч[её]те|лимит)\s*[:—-]?\s*$/iu;
const INCIDENTAL_RE = /(?:комиссия|кэшбэк|cashback|бонус(?:ов|ы)?|экономия)\s*[:—-]?\s*$/iu;
const STOP_RE = /(?:код\s*(?:подтверждения|доступа|для|:|\d{4,8})|одноразов|парол|никому не сообщайте|\botp\b|\bpin\b)/iu;
const PROMO_RE = /(?:реклама|акция|скидк|предодобрен|кредитный лимит|оформите|успейте|получите до|вам доступен)/iu;
const CANCEL_RE = /(?:отмена|отменена|отменено|не прошла|не выполнен|отклонен|отклонён|недостаточно средств|ошибка операции)/iu;
const OWN_RE = /(?:между своими|на свою карту|на свой сч[её]т|с собственной карты|со своего сч[её]та|себе на карту)/iu;

function tokens(text) {
  return [...text.matchAll(MONEY_RE)].map(m => ({
    value: Math.round(Number(m[1].replace(/[ .\u00a0\u202f]/g,'') + '.' + (m[2] || '0')) * 100) / 100,
    start:m.index, end:m.index + m[0].length,
  })).filter(m => Number.isFinite(m.value) && m.value > 0);
}
function tokenKind(text, token) {
  const preceding = text.slice(Math.max(0,token.start-40),token.start);
  const boundary = Math.max(preceding.lastIndexOf('.'),preceding.lastIndexOf(';'),preceding.lastIndexOf('\n'));
  const local = preceding.slice(boundary+1);
  if (BALANCE_RE.test(local)) return 'balance';
  if (INCIDENTAL_RE.test(local)) return 'incidental';
  return 'operation';
}

const RULES = [
  { kind:'refund', type:'income', re:/возврат(?:\s+денег|\s+покупки)?|вернули|refund/iu },
  { kind:'income', type:'income', re:/зачислен\w*|поступил\w*|поступлен\w*|пополнен\w*|пополнили|зарплат\w*|аванс|преми\w*|кэшбэк|cashback|вам перевели|получен перевод/iu },
  { kind:'incoming-transfer', type:'income', re:/перевод\s+(?:на\s+сумму\s+)?(?:[\d\s.,]+[₽рp]?\s+)?от\s+\S+|перев[её]л(?:а|и)?\s+вам/iu },
  { kind:'expense', type:'expense', re:/покупк\w*|оплат\w*|оплач\w*|списан\w*|списал\w*|сняти\w*|снято|выдача наличных|плат[её]ж\w*|удержан\w*|комисси\w*|payment|purchase/iu },
  { kind:'outgoing-transfer', type:'expense', re:/перевод\s+(?:по\s+сбп\s+)?(?:[\d\s.,]+[₽рp]?\s+)?(?:для|на|кому|в)\s+\S+|перев[её]л(?:а|и)?\s+(?!вам)\S+/iu },
  { kind:'ambiguous-transfer', type:'expense', re:/перевод/iu },
];
function operation(text) {
  const hits = RULES.map(r => ({...r, match:r.re.exec(text)})).filter(r => r.match);
  if (!hits.length) return null;
  const refund = hits.find(h => h.kind === 'refund');
  if (refund) return {...refund, uncertain:false};
  const definite = hits.filter(h => !['ambiguous-transfer','outgoing-transfer'].includes(h.kind))
    .sort((a,b) => a.match.index-b.match.index);
  const first = definite[0] || hits[0];
  if (definite.some(h => h.type !== first.type) && tokens(text).filter(m => tokenKind(text,m)==='operation').length>1) return null;
  return {...first, uncertain:first.kind === 'ambiguous-transfer' || OWN_RE.test(text)};
}
function amountToken(text, money, op) {
  let available = money.filter(m => tokenKind(text,m) === 'operation');
  if (!available.length && /кэшбэк|cashback|комисси/iu.test(op.match[0]))
    available = money.filter(m => tokenKind(text,m) === 'incidental');
  if (!available.length) return null;
  const anchor = op.match.index + op.match[0].length;
  return available.sort((a,b) => (Math.abs(a.start-anchor)+(a.start<op.match.index?15:0)) -
    (Math.abs(b.start-anchor)+(b.start<op.match.index?15:0)))[0];
}
function lastFour(text) {
  const m = text.match(/(?:карта|карт[еы]|сч[её]т|mir|visa|mastercard|мир)\s*[:№-]?\s*[*xх•·-]*\s*(\d{4,})|[*•]{1,4}\s*(\d{4})\b/iu);
  return m ? (m[1] || m[2]).slice(-4) : '';
}
function noteFor(text, op, token) {
  if (op.type === 'income') {
    if (/зарплат/iu.test(text)) return 'Зарплата';
    if (/аванс/iu.test(text)) return 'Аванс';
    if (/преми/iu.test(text)) return 'Премия';
    if (/возврат|вернули|refund/iu.test(text)) return 'Возврат';
    if (/кэшбэк|cashback/iu.test(text)) return 'Кэшбэк';
    return /пополн/iu.test(text) ? 'Пополнение' : 'Поступление';
  }
  const after = text.slice(token.end).replace(/^[\s,.:;—–-]+/u,'');
  const before = text.slice(op.match.index + op.match[0].length,token.start);
  const candidate = /^(?:в\s+|на\s+|за\s+)?([a-zа-яё0-9][a-zа-яё0-9 &*._+'«»"-]{1,45})/iu.exec(after)?.[1] ||
    /(?:в|на|за)\s+([a-zа-яё0-9][a-zа-яё0-9 &*._+'«»"-]{1,45})/iu.exec(before)?.[1] || '';
  const name = norm(candidate).replace(/(?:баланс|остаток|доступно|карта|сч[её]т|комиссия|кэшбэк|сбп).*$/iu,'')
    .replace(/[,.!:;—–-]+$/u,'').trim().slice(0,40);
  return name && !/^\d+$|^(?:руб|rub|rur)$/iu.test(name) ? name :
    (op.kind.includes('transfer') ? 'Перевод' : 'Покупка');
}

export function notifHash(pkg,title,text) {
  const s = [pkg,title,text].map(norm).join('|'); let h = 5381;
  for (let i=0;i<s.length;i++) h = ((h<<5)+h+s.charCodeAt(i))>>>0;
  return 'h'+h.toString(36);
}
export function guessCategory(text,type) {
  const s = ' '+low(text)+' '; let best=null, length=0;
  for (const [id,words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (CATEGORY_TYPE.get(id)!==type) continue;
    for (const word of words) if (s.includes(word) && word.length>length) { best=id; length=word.length; }
  }
  return best || (type==='income'?'other_inc':'other_exp');
}
export function isFinancialText(text) {
  const s=norm(text);
  return !!tokens(s).length && !STOP_RE.test(s) && !CANCEL_RE.test(s) && !PROMO_RE.test(s) && !!operation(s);
}
export function parseNotification(pkg,title,text) {
  const body=norm(text || title), full=norm([title,text].filter(Boolean).join(' '));
  if (!full || STOP_RE.test(full) || CANCEL_RE.test(full) || PROMO_RE.test(full)) return null;
  const money=tokens(full), op=operation(full);
  if (!money.length || !op) return null;
  const selected=amountToken(full,money,op);
  if (!selected) return null;
  const bank=detectBank(pkg,title), card=lastFour(full), note=noteFor(full,op,selected);
  const balance=money.find(m=>tokenKind(full,m)==='balance')?.value ?? null;
  const possibleTransfer=OWN_RE.test(full) || (op.type==='income' && /пополнен\w*\s+через\s+сбп/iu.test(full));
  const warnings=[];
  if (bank.id==='other') warnings.push('Банк не определён');
  if (op.uncertain) warnings.push('Направление перевода требует проверки');
  if (possibleTransfer) warnings.push('Возможно, перевод между своими счетами');
  if (money.filter(m=>tokenKind(full,m)==='operation').length>1) warnings.push('В сообщении несколько сумм');
  return { type:op.type, amount:selected.value, categoryId:guessCategory(note+' '+(op.type==='expense'?body:''),op.type), note,
    source:'notification', hash:notifHash(pkg,title,text), rawText:full.slice(0,300),
    bankId:bank.id, bankName:bank.name, last4:card,
    accountId:bank.id==='other'&&!card?'':bank.id+(card?'_'+card:''),
    accountName:bank.id==='other'&&!card?'':bank.name+(card?' •'+card:''),
    balance, possibleTransfer, confidence:warnings.length?'review':'high', warnings };
}
export function areLikelySamePayment(a,b) {
  if (!a||!b||a.bankId==='other'||a.bankId!==b.bankId||a.sourceChannel===b.sourceChannel||
      !a.sourceChannel||!b.sourceChannel||a.type!==b.type||a.amount!==b.amount||
      Math.abs(Number(a.ts)-Number(b.ts))>90000) return false;
  if (a.last4&&b.last4&&a.last4!==b.last4) return false;
  if (!a.last4&&!b.last4) {
    const n=s=>low(s).replace(/[^a-zа-яё0-9]/g,'');
    if (!n(a.note)||n(a.note)!==n(b.note)) return false;
  }
  return true;
}
export function parseNotificationList(items,seenHashes=[],dismissedHashes=[]) {
  const out=new Map();
  for (const it of Array.isArray(items)?items:[]) {
    const p=parseNotification(it.pkg,it.title,it.text);
    if (!p) continue;
    p.hash=notifHash(it.pkg,it.key||'',String(it.ts||'')+'|'+p.hash);
    if (seenHashes.includes(p.hash)||dismissedHashes.includes(p.hash)) continue;
    p.sourceChannel=SMS_PACKAGES.has(it.pkg)?'sms':'push';
    p.ts=Number(it.ts)||Date.now(); out.set(p.hash,p);
  }
  const candidates=[...out.values()].sort((a,b)=>b.ts-a.ts);
  for (const p of candidates) p.possibleDuplicate=candidates.some(b=>b!==p&&areLikelySamePayment(p,b));
  return candidates;
}
export function parsePastedText(text) {
  const chunks=String(text||'').split(/\n\s*\n|\n(?=[A-ZА-ЯЁ][^\n]{0,40}:)/u).map(s=>s.trim()).filter(Boolean);
  const out=chunks.map(c=>parseNotification('manual-paste','',c)).filter(Boolean);
  if (!out.length&&String(text||'').trim()) {
    const one=parseNotification('manual-paste','',text); if (one) out.push(one);
  }
  for (const p of out) p.hash='manual_'+Date.now()+'_'+Math.random().toString(36).slice(2);
  return out;
}
