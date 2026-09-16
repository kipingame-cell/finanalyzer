// Парсер текстов банковских уведомлений/SMS → черновик операции.
// Работает и с нативным слушателем уведомлений, и с вставленным вручную текстом.
import { CATEGORY_KEYWORDS } from './config.js';

const INCOME_WORDS = ['зачислен', 'зачисление', 'пополнен', 'пополнение', 'получен перевод', 'перевод от', 'возврат', 'зарплата', 'аванс', 'премия', 'начислены', 'кэшбэк', 'cashback', 'вам перевели', 'поступление'];
const EXPENSE_WORDS = ['списание', 'списан', 'покупка', 'оплата', 'оплачено', 'перевод', 'снятие', 'выдача наличных', 'платёж', 'платеж', 'удержан', 'payment', 'purchase'];

// Суммы вида: 1 234,56 ₽ / 1234.56 RUB / 850 руб. / 1 234,56р
const AMOUNT_RE = /(\d{1,3}(?:[ \u00A0\u202F]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(?:₽|руб(?:\.|лей|ля)?(?![а-яёa-z])|rub(?![a-z])|rur(?![a-z]))/i;

export function notifHash(pkg, title, text) {
  const s = (pkg || '') + '|' + (title || '') + '|' + (text || '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(36);
}

function extractAmount(text) {
  const m = text.match(AMOUNT_RE);
  if (!m) return null;
  const intPart = m[1].replace(/[ \u00A0\u202F]/g, '');
  const val = parseFloat(intPart + (m[2] ? '.' + m[2] : ''));
  return isFinite(val) && val > 0 ? val : null;
}

// Игнорируем технические уведомления без денег
export function isFinancialText(text) {
  if (!text) return false;
  if (!AMOUNT_RE.test(text)) return false;
  const low = text.toLowerCase();
  if (/(остаток|баланс|доступно)[: ]/i.test(low) && !INCOME_WORDS.concat(EXPENSE_WORDS).some(w => low.includes(w))) return false;
  if (/код |код:|одноразов|подтверждени|парол/i.test(low)) return false;
  return true;
}

function detectType(text) {
  const low = text.toLowerCase();
  const inc = INCOME_WORDS.some(w => low.includes(w));
  const exp = EXPENSE_WORDS.some(w => low.includes(w));
  if (inc && !exp) return 'income';
  if (exp && !inc) return 'expense';
  if (inc && exp) {
    // «перевод от» = доход, «перевод» без «от» = расход
    if (/перевод от|зачислен|пополнен|кэшбэк|зарплата/i.test(low)) return 'income';
    return 'expense';
  }
  return 'expense'; // по умолчанию трата
}

function extractMerchant(text) {
  // «Перевод от Иван И.» / «зачислен перевод ... от АО Ромашка»
  let m = text.match(/(?:перевод|платёж|платеж)\s+от\s+([A-Za-zА-Яа-яЁё0-9 &*._-]{2,40})/i);
  if (m) return cleanMerchant(m[1]);
  m = text.match(/\bот\s+([A-Za-zА-Яа-яЁё0-9 &*._-]{2,40})/i);
  if (m && /зачислен|пополнен|получен/i.test(text)) return cleanMerchant(m[1]);
  // «Подписка Яндекс Плюс 299 ₽»
  m = text.match(/(?:подписка|тариф)\s+([A-Za-zА-Яа-яЁё0-9 &+._-]{2,30}?)\s*\d/i);
  if (m) return cleanMerchant(m[1]);
  // Магазин обычно идёт сразу после суммы: «Покупка 450 ₽, ПЯТЁРОЧКА. Баланс: …»
  m = text.match(/(?:₽|руб(?:\.|лей|ля)?|rub|rur)\s*[,;]?\s*(?:в\s+|на\s+)?([A-Za-zА-Яа-яЁё0-9 &*._-]{2,40})/i);
  if (m) {
    let merch = m[1];
    // отрезаем служебные хвосты, затем финальная чистка
    merch = merch.replace(/\s*(баланс|доступно|карта|остаток|сч[её]т|сбп|sbp).*$/i, '');
    merch = cleanMerchant(merch);
    if (merch.length >= 2 && !/^\d+$/.test(merch)) return merch;
  }
  m = text.match(/([A-ZА-ЯЁ][A-ZА-ЯЁ0-9*& -]{3,30})/);
  if (m && !/^(RUB|RUR|СБП|SBP)/.test(m[1])) return cleanMerchant(m[1]);
  return '';
}
function cleanMerchant(s) {
  return (s || '').replace(/[.,;:!?]+$/, '').replace(/\s{2,}/g, ' ').trim()
    .replace(/^(россия|moskva|москва|г |russia)\s+/i, '').slice(0, 40);
}

// Для доходов точнее взять повод из ключевых слов, а не из текста
function incomeReason(text) {
  const low = text.toLowerCase();
  if (low.includes('зарплат')) return 'Зарплата';
  if (low.includes('аванс')) return 'Аванс';
  if (low.includes('преми')) return 'Премия';
  if (low.includes('кэшбэк') || low.includes('cashback')) return 'Кэшбэк';
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

// Главный вход: текст уведомления → черновик операции или null
export function parseNotification(pkg, title, text) {
  const full = ((title || '') + ' ' + (text || '')).trim();
  if (!isFinancialText(full)) return null;
  const amount = extractAmount(full);
  if (!amount) return null;
  const type = detectType(full);
  let merchant = extractMerchant(text || title || '');
  if (type === 'income') merchant = incomeReason(full) || merchant;
  const categoryId = guessCategory(full + ' ' + merchant, type);
  return {
    type, amount, categoryId,
    note: merchant || (title || '').slice(0, 40),
    source: 'notification',
    hash: notifHash(pkg, title, text),
    rawText: full.slice(0, 300),
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
