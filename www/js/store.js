import {guessCategory, unassigned} from './categories.js';
import {bankDateKey} from './dates.js';
import { isOwnTransfer } from './transfers.js';
export { isOwnTransfer } from './transfers.js';
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
      notifAutoImport: false,
    },
    seenNotifHashes: [],       // уже обработанные уведомления (дедупликация)
    dismissedNotifHashes: [],  // пользователь отклонил
  };
}

function normalizeState(data) {
  if(!data || !Array.isArray(data.transactions) || !Array.isArray(data.categories))throw new Error('Повреждён формат данных. Исходные данные сохранены; восстановите JSON-бэкап.');
  const blank=blankState();
  for(const k of Object.keys(blank))if(data[k]===undefined)data[k]=blank[k];
  if(!data.settings || typeof data.settings!=='object' || !Array.isArray(data.accounts))throw new Error('Неверный формат настроек или счетов');
  for(const k of Object.keys(blank.settings))if(data.settings[k]===undefined)data.settings[k]=blank.settings[k];
  if(!Array.isArray(data.seenNotifHashes)||!Array.isArray(data.dismissedNotifHashes))throw new Error('Неверный формат истории импорта');
  if(!data.accounts.length)data.accounts=blank.accounts;
  const accountIds=new Set(data.accounts.map(a=>a.id));
  data.categories=data.categories.filter(c=>c&& !['other_exp','other_inc'].includes(c.id));
  const ids=new Set(data.categories.map(c=>c.id));
  for(const c of DEFAULT_CATEGORIES)if(!ids.has(c.id))data.categories.push({...c});
  const cats=new Map(data.categories.map(c=>[c.id,c]));
  for(const t of data.transactions) {
    if(!t || typeof t!=='object')throw new Error('Неверная запись операции');
    if(!t.accountId)t.accountId='main';
    if(!accountIds.has(t.accountId)){data.accounts.push({id:t.accountId,name:'Восстановленный счёт '+t.accountId,bankId:'manual',balance:null});accountIds.add(t.accountId);}
    const guessed=guessCategory(t.note,t.type);
    const missing=!cats.has(t.categoryId)||['other_exp','other_inc'].includes(t.categoryId)||String(t.categoryId).startsWith('uncategorized');
    const wrongBank=t.categoryId==='market'&&['transfer_in','transfer_out'].includes(guessed)&&!t.categoryManual;
    if(missing||wrongBank)t.categoryId=guessed;
    if(typeof t.amount==='string'&&Number.isFinite(Number(t.amount)))t.amount=Number(t.amount);
  }
  return data;
}
export function initStore() {
  const raw=localStorage.getItem(LS_KEY);
  let data;
  try{data=raw?JSON.parse(raw):blankState();}catch{throw new Error('Не удалось прочитать данные. Они не удалены. Восстановите JSON-бэкап.');}
  // Preserve the pre-migration history once; never wipe unreadable user data.
  if(raw&&!data.categorySchemaVersion)localStorage.setItem(LS_KEY+'_before_160',raw);
  state=normalizeState(data);state.categorySchemaVersion=1;save();
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
  return state.categories.find(c => c.id === id) || state.categories.find(c => c.id === (id === 'other_inc' ? 'uncategorized_inc' : 'uncategorized_exp')) || state.categories[0];
}
export function addCategory(cat) {
  cat.id = 'c_' + Date.now().toString(36);
  state.categories.push(cat); save();
  return cat;
}
export function updateCategory(id, patch) {
 const c=state.categories.find(x=>x.id===id);if(!c)return;
 if(patch.type&&patch.type!==c.type&&state.transactions.some(t=>t.categoryId===id))throw new Error('У категории есть операции. Создайте отдельную категорию другого типа.');
 const old={...c};Object.assign(c,patch);try{save();}catch(e){Object.assign(c,old);throw e;}
}
export function deleteCategory(id) {
 if(id.startsWith('uncategorized'))throw new Error('Это статус операций, а не пользовательская категория');
 const old=state.categories,changed=state.transactions.filter(t=>t.categoryId===id);
 state.categories=old.filter(c=>c.id!==id);changed.forEach(t=>t.categoryId=unassigned(t.type));
 try{save();}catch(e){state.categories=old;changed.forEach(t=>t.categoryId=id);throw e;}
}

function validateTransaction(t) {
  if(!['income','expense'].includes(t.type)||!Number.isFinite(Number(t.amount))||Number(t.amount)<=0||!Number.isFinite(Date.parse(t.date)))throw new Error('Проверьте сумму, дату и тип операции');
  if(!Number.isSafeInteger(Math.round(Number(t.amount)*100)))throw new Error('Слишком большая сумма');
}
export function addTransaction(tx) {
  if(tx.hash){const existing=findTxByHash(tx.hash);if(existing)return existing;}
  validateTransaction(tx);
  tx={...tx,id:'t_'+crypto.randomUUID(),amount:Math.round(Number(tx.amount)*100)/100,accountId:tx.accountId||'main'};
  state.transactions.unshift(tx);
  try{save();}catch(e){state.transactions.shift();throw e;}return tx;
}
export function updateTransaction(id,patch) {
 const t=state.transactions.find(x=>x.id===id);if(!t)return;
 const next={...t,...patch};validateTransaction(next);next.amount=Math.round(Number(next.amount)*100)/100;
 const old={...t};Object.assign(t,next);
 try{save();}catch(e){for(const k of Object.keys(t))delete t[k];Object.assign(t,old);throw e;}
}
export function deleteTransaction(id) {
 const old=state.transactions;state.transactions=old.filter(t=>t.id!==id);
 try{save();}catch(e){state.transactions=old;throw e;}
}
export function classifyTransactions(ids,categoryId) {
 const cat=state.categories.find(c=>c.id===categoryId);if(!cat)throw new Error('Выберите категорию');
 const selected=new Set(ids),rows=state.transactions.filter(t=>selected.has(t.id));
 if(rows.some(t=>t.type!==cat.type))throw new Error('Выберите операции одного типа: доходы или расходы');
 const old=rows.map(t=>[t,t.categoryId,t.categoryManual]);
 for(const t of rows){t.categoryId=cat.id;t.categoryManual=true;}
 try{save();}catch(e){for(const [t,c,m] of old){t.categoryId=c;t.categoryManual=m;}throw e;}return rows.length;
}
export function setExcluded(ids,value) {
 const selected=new Set(ids),old=state.transactions.filter(t=>selected.has(t.id)).map(t=>[t,t.excluded]);
 for(const [t] of old)t.excluded=Boolean(value);
 try{save();}catch(e){for(const [t,v] of old)t.excluded=v;throw e;}return old.length;
}
export function isCounted(t) {
 return !t.excluded && ['income','expense'].includes(t.type) && Number.isFinite(Number(t.amount)) && Number(t.amount)>0 && Number.isFinite(Date.parse(t.date));
}
export function duplicateCandidates() {
 const groups=new Map(),ids=new Set();
 for(const t of state.transactions) {
  if(!isCounted(t))continue;
  const key=[bankDateKey(t.date),t.type,Math.round(Number(t.amount)*100)].join('|');
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t);
 }
 for(const rows of groups.values()) {
  // Different import sources or exact same text/time merit review, never auto-delete.
  if(rows.length<2)continue;
  const sources=new Set(rows.map(t=>t.source||'manual'));
  if(sources.size>1){rows.forEach(t=>ids.add(t.id));continue;}
  const seen=new Map();for(const t of rows){const key=t.date+'|'+t.accountId+'|'+t.note;if(seen.has(key)){ids.add(t.id);ids.add(seen.get(key));}else seen.set(key,t.id);}
 }
 return ids;
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

// Transfers keep their bank direction for account cash flow, but are excluded
// from earned income / consumption. An explicit user decision overrides inference.
export function setOwnTransfers(ids, value) {
  const selected = new Set(ids);
  const previous = state.transactions.filter(t => selected.has(t.id)).map(t => [t, t.ownTransfer]);
  try { previous.forEach(([t]) => { t.ownTransfer = Boolean(value); }); save(); }
  catch (e) { previous.forEach(([t, old]) => { if (old === undefined) delete t.ownTransfer; else t.ownTransfer = old; }); throw e; }
  return previous.length;
}
export function transferTotals(mk, accountId) {
  const totals = {income: 0, expense: 0, count: 0};
  for (const t of txInMonth(mk, accountId)) if (isOwnTransfer(t) && isCounted(t)) {
    totals[t.type] += Math.round(Number(t.amount) * 100); totals.count++;
  }
  totals.income /= 100; totals.expense /= 100; return totals;
}

// ---------- Статистика ----------
export function monthKey(d) {
  return bankDateKey(d).slice(0,7);
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
    if (!isCounted(t) || isOwnTransfer(t)) continue;
    if (t.type === 'income') income += Math.round(Number(t.amount)*100);
    else if (t.type === 'expense') expense += Math.round(Number(t.amount)*100);
  }
  return { income: income / 100, expense: expense / 100 };
}

export function balance(accountId) {
  let b = 0;
  for (const t of state.transactions) if (txAccountOk(t, accountId) && isCounted(t)) b += (t.type === 'income' ? 1 : -1) * Math.round(Number(t.amount)*100);
  return b / 100;
}

export function byCategory(mk, type = 'expense', accountId) {
  const map = {};
  for (const t of txInMonth(mk, accountId)) {
    if (t.type !== type || !isCounted(t) || isOwnTransfer(t)) continue;
    map[t.categoryId] = (map[t.categoryId] || 0) + Number(t.amount);
  }
  return Object.entries(map)
    .map(([categoryId, sum]) => ({ category: getCategory(categoryId), sum: Math.round(sum * 100) / 100 }))
    .sort((a, b) => b.sum - a.sum);
}

export function lastNMonths(n, accountId, endMonth = currentMonthKey()) {
  const res = [];
  const [year, month] = endMonth.split('-').map(Number);
  const now = new Date(Date.UTC(year,month-1,1,12));
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1,12));
    const mk = monthKey(d);
    res.push({ mk, label: d.toLocaleString('ru-RU', { month: 'short' }), ...monthTotals(mk, accountId) });
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
    if (t.type !== 'expense' || !isCounted(t) || isOwnTransfer(t) || !t.note) continue;
    const key = t.note.trim();
    map[key] = (map[key] || 0) + Number(t.amount);
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([note, sum]) => ({ note, sum: Math.round(sum * 100) / 100 }));
}

// ---------- Бэкап ----------
export function exportJSON() {
  return JSON.stringify(state, null, 2);
}
export function importJSON(text) {
 const data=normalizeState(JSON.parse(text));
 const previous=state;state=data;
 try{save();}catch(e){state=previous;throw e;}
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
    txs.push({ id: 'demo_p' + m + 'f', type: 'expense', amount: base * 0.1, categoryId: 'gifts', note: 'Цветы', date: d.toISOString(), source: 'manual', accountId: 'main' });
  }
  state.transactions = [...txs, ...state.transactions];
  save();
}

export function fmtMoney(n, withSign = false) {
  const cur = state.settings.currency || '₽';
  const abs = Math.abs(n);
  const s = abs.toLocaleString('ru-RU', { minimumFractionDigits: abs % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const sign = withSign ? (n >= 0 ? '+' : '−') : (n < 0 ? '−' : '');
  return `${sign}${s} ${cur}`;
  }
