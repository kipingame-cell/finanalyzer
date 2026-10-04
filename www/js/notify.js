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
    const items = await readNotificationQueue(nl);
    const st = getState();
    const seen = [...st.seenNotifHashes, ...st.transactions.map(t => t.hash).filter(Boolean)];
    const suggestions = parseNotificationList(items, seen, st.dismissedNotifHashes);
    const pendingIds = new Set(suggestions.map(p => p.hash));
    const consumed = items.filter(it => !parseNotificationList([it]).some(p => pendingIds.has(p.hash)));
    if (consumed.length && nl.acknowledgeNotifications) await nl.acknowledgeNotifications({items: consumed});
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
    const items = await readNotificationQueue(nl);
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
    // Match only the same source text across SMS history and SMS notifications,
    // one-to-one, within delivery tolerance. Keep identical separate SMS ids.
    const duplicate = p.contentHash && st.transactions.find(t =>
      t.contentHash === p.contentHash && Math.abs(Date.parse(t.date) - p.ts) <= 120000 &&
      ((p.smsId && !t.smsId && !t.notificationLinked) || (!p.smsId && t.smsId && !t.notificationLinked)));
    if (duplicate) {
      if (p.smsId) duplicate.smsId = p.smsId;
      duplicate.notificationLinked = true;
      st.seenNotifHashes.push(p.hash);
      continue;
    }
    if (!Number.isFinite(p.amount) || p.amount <= 0) continue;
    const id = p.accountId || 'main';
    let account = st.accounts.find(a => a.id === id);
    if (!account) {
      account = { id, name: p.accountName || id, bankId: p.bankId, balance: null };
      st.accounts.push(account);
    }
    st.transactions.unshift({ id: 'n_' + p.hash, type: p.type, amount: p.amount,
      categoryId: p.categoryId, accountId: id, note: p.note,
      date: new Date(p.ts).toISOString(), source: p.smsId ? 'sms' : 'notification', hash: p.hash, contentHash: p.contentHash, smsId: p.smsId });
    if (p.balance != null && (!account.balanceAt || p.ts >= account.balanceAt)) {
      account.balance = p.balance; account.balanceAt = p.ts;
    }
    st.seenNotifHashes.push(p.hash);
    count++;
  }
  if (count || st.seenNotifHashes.length !== snapshot.seenNotifHashes.length) {
    try { save(); }
    catch (error) { Object.assign(st, snapshot); throw error; }
  }
  return count;
}

async function readNotificationQueue(nl) {
  const all = [];
  let after = '0';
  do {
    const page = await nl.getNotifications({after});
    const items = typeof page.items === 'string' ? JSON.parse(page.items) : page.items;
    if (!Array.isArray(items)) throw new Error('Неверный формат очереди');
    all.push(...items);
    if (!page.more) break;
    if (!page.after || page.after === after) throw new Error('Очередь не продвигается');
    after = page.after;
  } while (true);
  return all;
}

export async function getBackgroundStatus() {
  const nl = getNative();
  if (!nl) return null;
  return nl.backgroundStatus();
}
export async function openBackgroundSettings() {
  const nl = getNative();
  if (!nl) throw new Error('Доступно только в Android-приложении');
  await nl.openBackgroundSettings();
}

let smsImportRunning = false;
export async function importSmsHistory(onProgress = () => {}, shouldStop = () => false) {
  if (smsImportRunning) throw new Error('Импорт SMS уже идёт');
  const nl = getNative();
  if (!nl) throw new Error('Чтение SMS доступно в Android-приложении');
  smsImportRunning = true;
  let after = '0', upper = '0', scanned = 0, imported = 0;
  try {
    do {
      if (shouldStop()) return {scanned, imported, cancelled: true};
      const page = await nl.readSmsHistory({after, upper});
      if (!Array.isArray(page.items)) throw new Error('Неверный ответ SMS-провайдера');
      const st = getState();
      const parsed = parseNotificationList(page.items, [...st.seenNotifHashes, ...st.transactions.map(t=>t.hash).filter(Boolean)], st.dismissedNotifHashes);
      imported += importSuggestions(parsed);
      scanned += page.items.length;
      onProgress({scanned, imported});
      if (!page.more) break;
      if (!page.after || page.after === after) throw new Error('Импорт SMS не продвигается');
      after = page.after; upper = page.upper;
      await new Promise(resolve => setTimeout(resolve, 0));
    } while (true);
    return {scanned, imported, cancelled: false};
  } finally { smsImportRunning = false; }
}
