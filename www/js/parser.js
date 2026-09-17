// Парсер текстов банковских уведомлений/SMS → черновик операции.
// Знает форматы: Сбер (push и SMS от 900), ВТБ, Т-Банк, Альфа, Яндекс Банк,
// Ozon Банк, WB Банк, Райффайзен, Газпромбанк, Совкомбанк, Почта Банк, МТС и др.
// Работает и с нативным слушателем уведомлений, и с вставленным вручную текстом.
import { CATEGORY_KEYWORDS } from './config.js';

// ---------- Справочник банков ----------
// pkgs — package name приложения банка; senders — отправитель SMS/push (title уведомления);
// kw — ключевые слова в тексте, по которым можно опознать банк.
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

const INCOME_WORDS = ['зачислен', 'зачисление', 'пополнен', 'пополнение', 'получен перевод', 'перевод от', 'возврат', 'зарплата', 'аванс', 'премия', 'начислены', 'кэшбэк', 'cashback', 'вам перевели', 'поступление'];
const EXPENSE_WORDS = ['списание', 'списан', 'покупка', 'оплата', 'оплачено', 'перевод', 'снятие', 'выдача наличных', 'платёж', 'платеж', 'удержан', 'комиссия', 'payment', 'purchase'];

// Суммы: 1 234,56 ₽ · 1234.56 RUB · 850 руб. · 1 234,56р · 40p (SMS Сбера) · 299₽
const AMOUNT_RE = /(\d{1,3}(?:[ \u00A0\u202F]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(?:₽|руб(?:\.|лей|ля|ь)?(?![а-яёa-z])|rub(?![a-z])|rur(?![a-z])|[рp](?![а-яёa-z]))/i;

export function notifHash(pkg, title, text) {
  const s = (pkg || '') + '|' + (title || '') + '|' + (text || '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(36);
}

function parseAmountMatch(m) {
  const intPart = m[1].replace(/[ \u00A0\u202F]/g, '');
  const val = parseFloat(intPart + (m[2] ? '.' + m[2] : ''));
  return isFinite(val) && val > 0 ? val : null;
}

function extractAmount(text) {
  const m = text.match(AMOUNT_RE);
  return m ? parseAmountMatch(m) : null;
}

// «Баланс: 3756.33р» / «Доступно 12 340 ₽» — остаток на счёте из текста банка
function extractBalance(text) {
  const m = text.match(/(?:баланс|доступно|остаток)[:\s]+/i);
  if (!m) return null;
  const a = text.slice(m.index + m[0].length).match(AMOUNT_RE);
  return a ? parseAmountMatch(a) : null;
}

// Номер счёта/карты: «СЧЁТ0150», «Карта *5678», «MIR-1234», «*1234»
function extractLast4(text) {
  let m = text.match(/сч[её]т\s*[*.•]?\s*(\d{4,})/i);
  if (!m) m = text.match(/карта\s*[*.•xх]?\s*\*?\s*(\d{4})/i);
  if (!m) m = text.match(/(?:mir|visa|mastercard|мир|мастеркард)\s*[*.•\-]?\s*\*?\s*(\d{4})/i);
  if (!m) m = text.match(/[*•]{1,4}\s?(\d{4})\b/);
  return m ? m[1].slice(-4) : '';
}

// Игнорируем технические уведомления без денежной операции
export function isFinancialText(text) {
  if (!text) return false;
  if (!AMOUNT_RE.test(text)) return false;
  const low = text.toLowerCase();
  if (/код |код:|одноразов|подтверждени|парол|никому не сообщайте/i.test(low)) return false;
  if (/одобрен|предодобрен|кредитный лимит|оформите|успейте|акция|скидк/i.test(low) && !INCOME_WORDS.concat(EXPENSE_WORDS).some(w => low.includes(w))) return false;
  if (/(остаток|баланс|доступно)[: ]/i.test(low) && !INCOME_WORDS.concat(EXPENSE_WORDS).some(w => low.includes(w))) return false;
  return true;
}

function detectType(text) {
  const low = text.toLowerCase();
  if (/зачислен|пополнен|возврат|кэшбэк|cashback|зарплат|аванс|преми|поступлен|вам перевели|получен перевод|начислен/.test(low)) return 'income';
  // «Перевод 500р от ИВАН И.» — приход; «перевод 40p OZON» — расход
  if (/перевод/.test(low) && /\sот\s+[a-zа-яё0-9]/i.test(low)) return 'income';
  if (/списание|списан|покупка|оплата|оплачено|перевод|снятие|выдача наличных|плат[её]ж|удержан|комиссия|payment|purchase/.test(low)) return 'expense';
  return 'expense'; // по умолчанию трата
}

const MERCH_TAIL_RE = /\s*(баланс|доступно|остаток|карта|сч[её]т|лимит|сбп|sbp|кэшбэк|бонусы|комиссия|по курсу).*$/i;
const MERCH_OP_PREFIX_RE = /^(покупка|оплата|перевод|списание|снятие|зачисление|пополнение|платёж|платеж|выдача наличных|комиссия|от)\s+/i;

function cleanMerchant(s) {
  return (s || '').replace(/[.,;:!?]+$/, '').replace(/\s{2,}/g, ' ').trim()
    .replace(/^(россия|moskva|москва|г |russia)\s+/i, '').slice(0, 40);
}

function extractMerchant(text) {
  // Магазин обычно идёт сразу после суммы: «перевод 40p OZON Баланс: …»
  const am = text.match(AMOUNT_RE);
  if (am) {
    const after = text.slice(am.index + am[0].length);
    const m = after.match(/^\s*[,;.\-—–]?\s*(?:в\s+|на\s+|за\s+)?([A-Za-zА-Яа-яЁё0-9 &*._+'"«»-]{2,40})/);
    if (m) {
      let merch = m[1].replace(MERCH_TAIL_RE, '');
      merch = cleanMerchant(merch.replace(MERCH_OP_PREFIX_RE, ''));
      if (merch.length >= 2 && !/^\d+$/.test(merch) && !/^(баланс|доступно|остаток)$/i.test(merch)) return merch;
    }
  }
  // «Перевод от Иван И.» / «зачисление … от АО Ромашка»
  let m = text.match(/(?:перевод|платёж|платеж|зачисление)\s+(?:[\d\s.,]+[рp₽]?\s+)?от\s+([A-Za-zА-Яа-яЁё0-9 &*._-]{2,40})/i);
  if (m) return cleanMerchant(m[1].replace(MERCH_TAIL_RE, ''));
  // «Подписка Яндекс Плюс 299 ₽»
  m = text.match(/(?:подписка|тариф)\s+([A-Za-zА-Яа-яЁё0-9 &+._-]{2,30}?)\s*\d/i);
  if (m) return cleanMerchant(m[1]);
  // КAPS-название магазина где-то в тексте
  m = text.match(/([A-ZА-ЯЁ][A-ZА-ЯЁ0-9*& -]{3,30})/);
  if (m && !/^(RUB|RUR|СБП|SBP|СЧЁТ|КАРТА|MIR|VISA)/.test(m[1])) return cleanMerchant(m[1]);
  return '';
}

// Для доходов точнее взять повод из ключевых слов, а не из текста
function incomeReason(text) {
  const low = text.toLowerCase();
  if (low.includes('зарплат')) return 'Зарплата';
  if (low.includes('аванс')) return 'Аванс';
  if (low.includes('преми')) return 'Премия';
  if (low.includes('кэшбэк') || low.includes('cashback')) return 'Кэшбэк';
  if (low.includes('возврат')) return 'Возврат';
  return null;
}

export function guessCategory(text, type) {
  const low = ' ' + (text || '').toLowerCase() + ' ';
  let best = null, bestLen = 0;
  for (const [catId, words] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const w of words) {
      if (low.includes(w) && w.length > bestLen) { best = catId; bestLen = w.length; }
    }
  }
  if (best) return best;
  return type === 'income' ? 'other_inc' : 'other_exp';
}

// Главный вход: уведомление → черновик операции или null.
// Дополнительно возвращает банк, счёт/карту и остаток по SMS (если есть).
export function parseNotification(pkg, title, text) {
  const full = ((title || '') + ' ' + (text || '')).trim();
  const body = (text || title || '');
  if (!isFinancialText(full)) return null;
  const amount = extractAmount(full);
  if (!amount) return null;
  const type = detectType(full);
  const bank = detectBank(pkg, title, full);
  const last4 = extractLast4(full);
  const balance = extractBalance(full);
  let merchant = extractMerchant(body);
  if (type === 'income') merchant = incomeReason(full) || merchant;
  const categoryId = guessCategory(full + ' ' + merchant, type);
  const accountId = bank.id + (last4 ? '_' + last4 : '');
  const accountName = bank.name + (last4 ? ' •' + last4 : '');
  return {
    type, amount, categoryId,
    note: merchant || (title || '').slice(0, 40),
    source: 'notification',
    hash: notifHash(pkg, title, text),
    rawText: full.slice(0, 300),
    bankId: bank.id, bankName: bank.name, last4,
    accountId: bank.id === 'other' && !last4 ? '' : accountId,
    accountName: bank.id === 'other' && !last4 ? '' : accountName,
    balance,
  };
}

// Пакетный разбор списка уведомлений от нативного модуля
export function parseNotificationList(items, seenHashes, dismissedHashes) {
  const out = [];
  for (const it of items) {
    const p = parseNotification(it.pkg, it.title, it.text);
    if (!p) continue;
    if (seenHashes.includes(p.hash) || dismissedHashes.includes(p.hash)) continue;
    p.ts = it.ts || Date.now();
    out.push(p);
  }
  // новые сверху, дедуп по хэшу внутри пачки
  const uniq = new Map();
  out.forEach(p => uniq.set(p.hash, p));
  return [...uniq.values()].sort((a, b) => b.ts - a.ts);
}

// Разбор вставленного вручную текста (может быть несколько уведомлений построчно/абзацами)
export function parsePastedText(text) {
  const chunks = text.split(/\n\s*\n|\n(?=[A-ZА-ЯЁ][^\n]{0,40}:)/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const c of chunks) {
    const p = parseNotification('manual-paste', '', c);
    if (p) out.push(p);
  }
  if (!out.length) {
    const p = parseNotification('manual-paste', '', text);
    if (p) out.push(p);
  }
  return out;
}
