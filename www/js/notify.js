// Обёртка над нативным модулем чтения уведомлений (NotificationListenerService).
// В браузере/без нативного модуля все функции безопасно деградируют.
import { parseNotificationList } from './parser.js';
import { getState, save } from './store.js';

function getNative() {
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
  if (C.Plugins && C.Plugins.NotificationListener) return C.Plugins.NotificationListener;
  if (typeof C.registerPlugin === 'function') {
    try { return C.registerPlugin('NotificationListener'); } catch (e) { return null; }
  }
  return null;
}

export function isNativeAvailable() {
  return !!getNative();
}

export async function isListenerEnabled() {
  const nl = getNative();
  if (!nl) return false;
  try {
    const r = await nl.isEnabled();
    return !!r.enabled;
  } catch (e) { return false; }
}

export async function openListenerSettings() {
  const nl = getNative();
  if (!nl) return false;
  try { await nl.openSettings(); return true; } catch (e) { return false; }
}

// Забрать захваченные уведомления и разобрать в черновики операций
export async function fetchSuggestions() {
  const nl = getNative();
  if (!nl) return { native: false, suggestions: [] };
  try {
    const r = await nl.getNotifications();
    const items = JSON.parse(r.items || '[]');
    const st = getState();
    const suggestions = parseNotificationList(items, st.seenNotifHashes, st.dismissedNotifHashes);
    return { native: true, suggestions, total: items.length };
  } catch (e) {
    return { native: false, suggestions: [], error: String(e) };
  }
}

export function markSeen(hash) {
  const st = getState();
  if (!st.seenNotifHashes.includes(hash)) st.seenNotifHashes.push(hash);
  if (st.seenNotifHashes.length > 2000) st.seenNotifHashes = st.seenNotifHashes.slice(-1000);
  save();
}

export function markDismissed(hash) {
  const st = getState();
  if (!st.dismissedNotifHashes.includes(hash)) st.dismissedNotifHashes.push(hash);
  if (st.dismissedNotifHashes.length > 2000) st.dismissedNotifHashes = st.dismissedNotifHashes.slice(-1000);
  save();
}

export async function clearNative() {
  const nl = getNative();
  if (!nl) return;
  try { await nl.clearNotifications(); } catch (e) {}
}

// Сырой список перехваченных уведомлений (для диагностики на экране)
export async function fetchRaw() {
  const nl = getNative();
  if (!nl) return [];
  try {
    const r = await nl.getNotifications();
    const items = JSON.parse(r.items || '[]');
    return Array.isArray(items) ? items : [];
  } catch (e) { return []; }
}

// Диагностика: нативный модуль вставляет фейковое уведомление банка
export async function injectTestNotification() {
  const nl = getNative();
  if (!nl) return false;
  try { await nl.injectTest(); return true; } catch (e) { return false; }
}

// One synchronous save contains transactions and dedup markers: retry after a
// bridge failure cannot insert the same notification twice.
export function importSuggestions(suggestions) {
  const st = getState();
  const snapshot = JSON.parse(JSON.stringify(st));
  let count = 0;
  for (const p of [...suggestions].sort((a, b) => a.ts - b.ts)) {
    if (st.seenNotifHashes.includes(p.hash) || st.dismissedNotifHashes.includes(p.hash) || st.transactions.some(t => t.hash === p.hash)) continue;
    if (!Number.isFinite(p.amount) || p.amount <= 0) continue;
    const id = p.accountId || 'main';
    let account = st.accounts.find(a => a.id === id);
    if (!account) {
      account = { id, name: p.accountName || id, bankId: p.bankId, balance: null };
      st.accounts.push(account);
    }
    st.transactions.unshift({ id: 'n_' + p.hash, type: p.type, amount: p.amount,
      categoryId: p.categoryId, accountId: id, note: p.note,
      date: new Date(p.ts).toISOString(), source: 'notification', hash: p.hash });
    if (p.balance != null && (!account.balanceAt || p.ts >= account.balanceAt)) {
      account.balance = p.balance; account.balanceAt = p.ts;
    }
    st.seenNotifHashes.push(p.hash);
    count++;
  }
  if (count) {
    try { save(); }
    catch (error) { Object.assign(st, snapshot); throw error; }
  }
  return count;
}
