// Хранилище данных: операции, категории, настройки. Всё локально (localStorage).
import { DEFAULT_CATEGORIES } from './config.js';

const LS_KEY = 'finanalyzer_data_v1';

let state = null;
const listeners = [];

function blankState() {
  return {
    transactions: [],          // {id, type:'income'|'expense', amount, categoryId, accountId, note, date(ISO), source:'manual'|'notification', hash}
    categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
    accounts: [                // счета/карты; новые создаются автоматически из уведомлений банков
      { id: 'main', name: 'Основной счёт', bankId: 'manual', balance: null }, // balance — остаток по данным банка (из SMS), если известен
    ],
    settings: {
      aiToken: '',
      aiBaseUrl: 'https://api.openai.com/v1',
      aiModel: 'gpt-4o-mini',
      monthStart: 1,
      currency: '₽',
      notifSourcesEnabled: true,
    },
    seenNotifHashes: [],       // уже обработанные уведомления (дедупликация)
    dismissedNotifHashes: [],  // пользователь отклонил
  };
}

export function initStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    state = raw ? JSON.parse(raw) : blankState();
  } catch (e) {
    state = blankState();
  }
  // миграция: добить недостающие поля
  const blank = blankState();
  for (const k of Object.keys(blank)) if (state[k] === undefined) state[k] = blank[k];
  for (const k of Object.keys(blank.settings)) if (state.settings[k] === undefined) state.settings[k] = blank.settings[k];
  // миграция: счета — все старые операции относим к основному счёту
  if (!state.accounts.length) state.accounts = blank.accounts;
  state.transactions.forEach(t => { if (!t.accountId) t.accountId = 'main'; });
  // миграция: добавить новые стандартные категории, которых нет у пользователя
  const knownIds = new Set(state.categories.map(c => c.id));
  for (const c of DEFAULT_CATEGORIES) if (!knownIds.has(c.id)) state.categories.push(JSON.parse(JSON.stringify(c)));
  save();
}

export function save() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  listeners.forEach(fn => fn());
}

export function onChange(fn) { listeners.push(fn); }

export function getState() { return state; }
export function getSettings() { return state.settings; }
export function setSetting(key, value) { state.settings[key] = value; save(); }

export function getCategories(type) {
  return type ? state.categories.filter(c => c.type === type) : state.categories;
}
export function getCategory(id) {
  return state.categories.find(c => c.id === id) || state.categories.find(c => c.id === (id === 'other_inc' ? 'other_inc' : 'other_exp')) || state.categories[0];
}
export function addCategory(cat) {
  cat.id = 'c_' + Date.now().toString(36);
  state.categories.push(cat); save();
  return cat;
}
export function updateCategory(id, patch) {
  const c = state.categories.find(x => x.id === id);
  if (c) { Object.assign(c, patch); save(); }
}
export function deleteCategory(id) {
  state.categories = state.categories.filter(c => c.id !== id);
  state.transactions.forEach(t => { if (t.categoryId === id) t.categoryId = 'other_exp'; });
  save();
}

export function addTransaction(tx) {
  tx.id = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  tx.amount = Math.round(Math.abs(Number(tx.amount)) * 100) / 100;
  state.transactions.unshift(tx);
  save();
  return tx;
}
export function updateTransaction(id, patch) {
  const t = state.transactions.find(x => x.id === id);
  if (t) { Object.assign(t, patch); save(); }
}
export function deleteTransaction(id) {
  state.transactions = state.transactions.filter(t => t.id !== id);
  save();
}
export function findTxByHash(hash) {
  return state.transactions.find(t => t.hash && t.hash === hash);
}

// ---------- Счета / карты ----------
export function getAccounts() { return state.accounts; }
export function getAccount(id) {
  return state.accounts.find(a => a.id === id) || state.accounts[0];
}
// Найти или создать счёт (вызывается при записи операции из уведомления)
export function ensureAccount({ id, name, bankId }) {
  if (!id) return getAccount('main');
  let a = state.accounts.find(x => x.id === id);
  if (!a) {
    a = { id, name: name || id, bankId: bankId || 'other', balance: null };
    state.accounts.push(a);
    save();
  }
  return a;
}
export function addAccount(name) {
  const a = { id: 'a_' + Date.now().toString(36), name, bankId: 'manual', balance: null };
  state.accounts.push(a); save();
  return a;
}
export function renameAccount(id, name) {
  const a = state.accounts.find(x => x.id === id);
  if (a && name) { a.name = name; save(); }
}
export function deleteAccount(id) {
  if (id === 'main') return false;
  state.transactions.forEach(t => { if (t.accountId === id) t.accountId = 'main'; });
  state.accounts = state.accounts.filter(a => a.id !== id);
  save();
  return true;
}
// Остаток по данным банка (приходит в тексте SMS/уведомления)
export function setAccountBalance(id, bal) {
  const a = state.accounts.find(x => x.id === id);
  if (a && isFinite(bal)) { a.balance = bal; a.balanceAt = Date.now(); save(); }
}

// ---------- Статистика ----------
export function monthKey(d) {
  const dt = new Date(d);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
}
export function currentMonthKey() { return monthKey(new Date()); }

// accountId: undefined/'all' = все счета, иначе только этот счёт
function txAccountOk(t, accountId) {
  return !accountId || accountId === 'all' || (t.accountId || 'main') === accountId;
}

export function txInMonth(mk, accountId) {
  return state.transactions.filter(t => monthKey(t.date) === mk && txAccountOk(t, accountId));
}

export function monthTotals(mk, accountId) {
  let income = 0, expense = 0;
  for (const t of txInMonth(mk, accountId)) {
    if (t.type === 'income') income += t.amount; else expense += t.amount;
  }
  return { income: Math.round(income * 100) / 100, expense: Math.round(expense * 100) / 100 };
}

export function balance(accountId) {
  let b = 0;
  for (const t of state.transactions) if (txAccountOk(t, accountId)) b += t.type === 'income' ? t.amount : -t.amount;
  return Math.round(b * 100) / 100;
}

export function byCategory(mk, type = 'expense', accountId) {
  const map = {};
  for (const t of txInMonth(mk, accountId)) {
    if (t.type !== type) continue;
    map[t.categoryId] = (map[t.categoryId] || 0) + t.amount;
  }
  return Object.entries(map)
    .map(([categoryId, sum]) => ({ category: getCategory(categoryId), sum: Math.round(sum * 100) / 100 }))
    .sort((a, b) => b.sum - a.sum);
}

export function lastNMonths(n) {
  const res = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mk = monthKey(d);
    res.push({ mk, label: d.toLocaleString('ru-RU', { month: 'short' }), ...monthTotals(mk) });
  }
  return res;
}

export function avgMonthlyExpense(months = 3) {
  const arr = lastNMonths(months + 1).slice(0, -1); // без текущего месяца
  if (!arr.length) return 0;
  return arr.reduce((s, m) => s + m.expense, 0) / arr.length;
}

export function topMerchants(mk, limit = 5, accountId) {
  const map = {};
  for (const t of txInMonth(mk, accountId)) {
    if (t.type !== 'expense' || !t.note) continue;
    const key = t.note.trim();
    map[key] = (map[key] || 0) + t.amount;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([note, sum]) => ({ note, sum: Math.round(sum * 100) / 100 }));
}

// ---------- Бэкап ----------
export function exportJSON() {
  return JSON.stringify(state, null, 2);
}
export function importJSON(text) {
  const data = JSON.parse(text);
  if (!data.transactions || !data.categories) throw new Error('Неверный формат файла');
  state = data;
  initMergeFix();
  save();
}
function initMergeFix() {
  const blank = blankState();
  for (const k of Object.keys(blank)) if (state[k] === undefined) state[k] = blank[k];
  for (const k of Object.keys(blank.settings)) if (state.settings[k] === undefined) state.settings[k] = blank.settings[k];
}
export function wipeAll() {
  state = blankState();
  save();
}

// ---------- Демо-данные (для показа покупателю) ----------
export function loadDemoData() {
  const cats = {};
  getCategories().forEach(c => cats[c.id] = c);
  const txs = [];
  const now = new Date();
  const demo = [
    ['salary', 52141, 'Зарплата АО «Транснефть»', -2],
    ['bonus', 15642, 'Премия 30%', -2],
    ['advance', 8500, 'Аванс', -16],
    ['food', 1240, 'Пятёрочка', -1], ['food', 2310, 'Магнит', -4], ['food', 980, 'Пятёрочка', -7],
    ['food', 1750, 'Лента', -10], ['food', 1320, 'Пятёрочка', -13], ['food', 2450, 'Ашан', -17],
    ['cafe', 450, 'Кофе с собой', -1], ['cafe', 890, 'Вкусно и точка', -5], ['cafe', 620, 'Шаурма', -9], ['cafe', 1200, 'Пицца Додо', -14],
    ['transport', 68, 'Метро', -1], ['transport', 340, 'Яндекс Такси', -6], ['transport', 68, 'Метро', -8],
    ['fuel', 2500, 'АЗС Лукойл', -3], ['fuel', 2500, 'АЗС Газпромнефть', -12],
    ['home', 5400, 'Квартплата ЖКХ', -5],
    ['health', 780, 'Аптека', -6],
    ['clothes', 3990, 'Wildberries', -8],
    ['fun', 600, 'Steam', -2], ['fun', 900, 'Кино', -11],
    ['subs', 299, 'Яндекс Плюс', -3], ['subs', 199, 'VK Музыка', -3], ['subs', 1690, 'ChatGPT Plus', -7],
    ['comm', 550, 'МТС', -4],
    ['sidejob', 7000, 'Подработка монтаж', -15],
  ];
  for (const [catId, amount, note, dayOffset] of demo) {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    const cat = cats[catId];
    txs.push({
      id: 'demo_' + Math.random().toString(36).slice(2, 9),
      type: cat.type, amount, categoryId: catId, note, accountId: 'main',
      date: d.toISOString(), source: 'manual',
    });
  }
  // прошлые месяцы для графика
  for (let m = 1; m <= 5; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 5);
    const base = 38000 + Math.round(Math.random() * 8000);
    txs.push({ id: 'demo_p' + m + 'a', type: 'income', amount: 52141 + 15642, categoryId: 'salary', note: 'Зарплата + премия', date: d.toISOString(), source: 'manual', accountId: 'main' });
    txs.push({ id: 'demo_p' + m + 'b', type: 'expense', amount: base * 0.4, categoryId: 'food', note: 'Продукты', date: d.toISOString(), source: 'manual', accountId: 'main' });
    txs.push({ id: 'demo_p' + m + 'c', type: 'expense', amount: base * 0.2, categoryId: 'home', note: 'Дом', date: d.toISOString(), source: 'manual', accountId: 'main' });
    txs.push({ id: 'demo_p' + m + 'd', type: 'expense', amount: base * 0.15, categoryId: 'transport', note: 'Транспорт', date: d.toISOString(), source: 'manual', accountId: 'main' });
    txs.push({ id: 'demo_p' + m + 'e', type: 'expense', amount: base * 0.15, categoryId: 'fun', note: 'Развлечения', date: d.toISOString(), source: 'manual', accountId: 'main' });
    txs.push({ id: 'demo_p' + m + 'f', type: 'expense', amount: base * 0.1, categoryId: 'other_exp', note: 'Прочее', date: d.toISOString(), source: 'manual', accountId: 'main' });
  }
  state.transactions = [...txs, ...state.transactions];
  save();
}

export function fmtMoney(n, withSign = false) {
  const cur = state.settings.currency || '₽';
  const abs = Math.abs(n);
  const s = abs.toLocaleString('ru-RU', { maximumFractionDigits: abs % 1 ? 2 : 0 });
  const sign = withSign ? (n >= 0 ? '+' : '−') : (n < 0 ? '−' : '');
  return `${sign}${s} ${cur}`;
  }
