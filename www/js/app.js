// Главный модуль UI
import { APP_VERSION, APP_NAME, KNOWN_BANK_PACKAGES } from './config.js';
import * as S from './store.js';
import { drawDonut, drawBars } from './charts.js';
import { offlineInsights, askAI, hasToken } from './ai.js';
import { checkUpdate, downloadUpdate } from './updater.js';
import { isNativeAvailable, isListenerEnabled, openListenerSettings, fetchSuggestions, markSeen, markDismissed } from './notify.js';
import { parsePastedText } from './parser.js';

let currentTab = 'home';
let opsFilter = 'all';      // all | income | expense
let statsMonthOffset = 0;
let pendingSuggCount = 0;

const $ = (sel, root = document) => root.querySelector(sel);
const view = () => $('#view');

// ---------- Утилиты ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, ms = 2200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), ms);
}
function fmtDate(iso) {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const diff = Math.round((today - dd) / 86400000);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return 'Сегодня, ' + time;
  if (diff === 1) return 'Вчера, ' + time;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ', ' + time;
}
function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const diff = Math.round((today - dd) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
}

// ---------- Модалки ----------
function openModal(html) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-back"><div class="modal"><div class="modal-grab"></div>${html}</div></div>`;
  const back = root.firstElementChild;
  back.addEventListener('click', e => { if (e.target === back) closeModal(); });
  return back.querySelector('.modal');
}
function closeModal() { $('#modal-root').innerHTML = ''; }

// ============================================================
// ГЛАВНАЯ
// ============================================================
function renderHome() {
  const mk = S.currentMonthKey();
  const { income, expense } = S.monthTotals(mk);
  const bal = S.balance();
  const cats = S.byCategory(mk, 'expense');
  const recent = S.getState().transactions.slice(0, 5);
  const monthName = new Date().toLocaleString('ru-RU', { month: 'long' });

  view().innerHTML = `
    <div class="page-head">
      <div><h1>${APP_NAME}</h1><div class="sub">${monthName[0].toUpperCase() + monthName.slice(1)} · v${APP_VERSION}</div></div>
      <button class="btn btn-sm btn-ghost" id="btn-notif">🔔 ${pendingSuggCount ? `<span class="badge">${pendingSuggCount}</span>` : ''}</button>
    </div>
    <div class="card hero">
      <div class="bal-label">Баланс</div>
      <div class="bal-value">${S.fmtMoney(bal)}</div>
      <div class="row">
        <div class="mini">Доходы<b style="color:#bbf7d0">${S.fmtMoney(income, true)}</b></div>
        <div class="mini">Расходы<b>${S.fmtMoney(expense, true)}</b></div>
        <div class="mini">Остаток месяца<b>${S.fmtMoney(income - expense, true)}</b></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Траты по категориям</div>
      ${cats.length ? `
        <div class="chart-box"><canvas class="chart" id="donut" height="200"></canvas></div>
        <div class="mt8">${cats.slice(0, 4).map(c => `
          <div class="legend-row"><span class="legend-dot" style="background:${c.category.color}"></span>
            <span class="legend-name">${c.category.icon} ${esc(c.category.name)}</span>
            <span class="legend-val">${S.fmtMoney(c.sum)}</span>
            <span class="legend-share">${Math.round(c.sum / expense * 100)}%</span></div>`).join('')}
        </div>` : '<div class="empty"><span class="big">🌱</span>Пока нет трат в этом месяце</div>'}
    </div>
    ${budgetCardHTML(cats)}
    <div class="card">
      <div class="card-title">Последние операции</div>
      ${recent.length ? recent.map(txRowHTML).join('') : '<div class="empty"><span class="big">📭</span>Нажмите ＋, чтобы добавить первую операцию</div>'}
    </div>`;

  if (cats.length) {
    drawDonut($('#donut'), cats.map(c => ({ label: c.category.name, value: c.sum, color: c.category.color })), S.fmtMoney(expense));
  }
  $('#btn-notif').onclick = openNotifications;
  bindTxRows();
}

function budgetCardHTML(cats) {
  const withBudget = S.getCategories('expense').filter(c => c.budget > 0);
  if (!withBudget.length) return '';
  const mk = S.currentMonthKey();
  const spent = Object.fromEntries(cats.map(c => [c.category.id, c.sum]));
  return `<div class="card"><div class="card-title">Бюджеты на месяц</div>` + withBudget.map(c => {
    const s = spent[c.id] || 0;
    const pct = Math.min(100, Math.round(s / c.budget * 100));
    const color = pct >= 100 ? 'var(--bad)' : pct >= 80 ? 'var(--warn)' : 'var(--good)';
    return `<div class="budget-row">
      <div class="budget-top"><span>${c.icon} ${esc(c.name)}</span><span class="muted">${S.fmtMoney(s)} / ${S.fmtMoney(c.budget)}</span></div>
      <div class="budget-bar"><div class="budget-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>`;
  }).join('') + '</div>';
}

function txRowHTML(t) {
  const c = S.getCategory(t.categoryId);
  return `<div class="tx-row" data-id="${t.id}">
    <div class="tx-ico" style="background:${c.color}22">${c.icon}</div>
    <div class="tx-info">
      <div class="tx-name">${esc(t.note || c.name)}</div>
      <div class="tx-meta">${esc(c.name)} · ${fmtDate(t.date)}${t.source === 'notification' ? ' · 🔔' : ''}</div>
    </div>
    <div class="tx-sum ${t.type}">${t.type === 'income' ? '+' : '−'}${S.fmtMoney(t.amount)}</div>
  </div>`;
}

function bindTxRows() {
  view().querySelectorAll('.tx-row[data-id]').forEach(el => {
    el.onclick = () => {
      const t = S.getState().transactions.find(x => x.id === el.dataset.id);
      if (t) openTxModal(t);
    };
  });
}

// ============================================================
// ОПЕРАЦИИ
// ============================================================
function renderOps() {
  const txs = S.getState().transactions.filter(t => opsFilter === 'all' || t.type === opsFilter);
  const groups = {};
  for (const t of txs) {
    const k = dayLabel(t.date);
    (groups[k] = groups[k] || []).push(t);
  }
  view().innerHTML = `
    <div class="page-head"><h1>Операции</h1><span class="muted">${txs.length} шт.</span></div>
    <div class="seg">
      <button data-f="all" class="${opsFilter === 'all' ? 'active' : ''}">Все</button>
      <button data-f="income" class="${opsFilter === 'income' ? 'active' : ''}">Доходы</button>
      <button data-f="expense" class="${opsFilter === 'expense' ? 'active' : ''}">Расходы</button>
    </div>
    ${txs.length ? Object.entries(groups).map(([day, arr]) => `
      <div class="day-head">${day}</div>
      <div class="card" style="padding:4px 16px">${arr.map(txRowHTML).join('')}</div>`).join('')
    : '<div class="empty"><span class="big">📭</span>Операций нет</div>'}`;
  view().querySelectorAll('.seg button').forEach(b => b.onclick = () => { opsFilter = b.dataset.f; renderOps(); });
  bindTxRows();
}

// ============================================================
// АНАЛИТИКА
// ============================================================
function renderStats() {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - statsMonthOffset, 1);
  const mk = S.monthKey(target);
  const { income, expense } = S.monthTotals(mk);
  const cats = S.byCategory(mk, 'expense');
  const months = S.lastNMonths(6);
  const merch = S.topMerchants(mk, 5);
  const mName = target.toLocaleString('ru-RU', { month: 'long', year: statsMonthOffset > 11 ? 'numeric' : undefined });

  view().innerHTML = `
    <div class="page-head">
      <h1>Аналитика</h1>
      <div class="flex">
        <button class="btn btn-sm" id="prev-m">←</button>
        <button class="btn btn-sm" id="next-m" ${statsMonthOffset === 0 ? 'disabled style="opacity:.4"' : ''}>→</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">${mName[0].toUpperCase() + mName.slice(1)}</div>
      <div class="flex" style="justify-content:space-around;text-align:center">
        <div><div class="muted" style="font-size:12px">Доход</div><b style="color:var(--good);font-size:18px">${S.fmtMoney(income)}</b></div>
        <div><div class="muted" style="font-size:12px">Расход</div><b style="color:var(--bad);font-size:18px">${S.fmtMoney(expense)}</b></div>
        <div><div class="muted" style="font-size:12px">Итог</div><b style="font-size:18px;color:${income - expense >= 0 ? 'var(--good)' : 'var(--bad)'}">${S.fmtMoney(income - expense, true)}</b></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Полгода: доходы vs расходы</div>
      <canvas class="chart" id="bars" height="160"></canvas>
      <div class="flex mt8" style="justify-content:center;font-size:12px" class="muted">
        <span class="muted">🟢 доход</span><span class="muted">🔴 расход</span>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Структура расходов</div>
      ${cats.length ? `<canvas class="chart" id="donut2" height="190"></canvas>
      <div class="mt8">${cats.map(c => `
        <div class="legend-row"><span class="legend-dot" style="background:${c.category.color}"></span>
        <span class="legend-name">${c.category.icon} ${esc(c.category.name)}</span>
        <span class="legend-val">${S.fmtMoney(c.sum)}</span>
        <span class="legend-share">${Math.round(c.sum / expense * 100)}%</span></div>`).join('')}</div>`
      : '<div class="empty"><span class="big">🌱</span>Нет расходов в этом месяце</div>'}
    </div>
    ${merch.length ? `<div class="card"><div class="card-title">Где чаще всего тратите</div>
      ${merch.map((m, i) => `<div class="legend-row"><b>${i + 1}.</b><span class="legend-name">${esc(m.note)}</span><span class="legend-val">${S.fmtMoney(m.sum)}</span></div>`).join('')}
    </div>` : ''}`;

  drawBars($('#bars'), months);
  if (cats.length) drawDonut($('#donut2'), cats.map(c => ({ label: c.category.name, value: c.sum, color: c.category.color })), S.fmtMoney(expense));
  $('#prev-m').onclick = () => { statsMonthOffset++; renderStats(); };
  const nm = $('#next-m'); if (nm) nm.onclick = () => { if (statsMonthOffset > 0) { statsMonthOffset--; renderStats(); } };
}

// ============================================================
// ИИ-СОВЕТНИК
// ============================================================
function renderAI() {
  const tips = offlineInsights();
  view().innerHTML = `
    <div class="page-head"><h1>Советник</h1><span class="muted">${hasToken() ? '🟢 ИИ подключён' : '🟡 офлайн-режим'}</span></div>
    ${tips.map(t => `<div class="tip ${t.level}"><div class="t-head">${{ good: '✅', warn: '⚠️', bad: '🚨', info: '💡' }[t.level]} ${esc(t.title)}</div><div class="t-body">${esc(t.text)}</div></div>`).join('')}
    <div class="card">
      <div class="card-title">Облачный ИИ-разбор ${hasToken() ? '' : '(необязательно)'}</div>
      ${hasToken() ? `
        <div class="field"><input id="ai-q" placeholder="Вопрос, напр.: где мне сэкономить?"></div>
        <button class="btn btn-primary btn-block" id="btn-ask">Получить разбор от ИИ</button>
        <div id="ai-answer" class="mt16"></div>
      ` : `
        <p class="muted" style="font-size:13.5px;line-height:1.5">Советы выше уже работают без интернета. Если вставить токен любого OpenAI-совместимого API (OpenAI, OpenRouter, Groq и т.п.) — появится полноценный ИИ-разбор ваших финансов.</p>
        <button class="btn btn-block" id="btn-ai-settings">🔑 Вставить токен</button>
      `}
    </div>`;
  const bs = $('#btn-ai-settings');
  if (bs) bs.onclick = openAISettings;
  const ask = $('#btn-ask');
  if (ask) ask.onclick = async () => {
    const q = $('#ai-q').value.trim();
    const ans = $('#ai-answer');
    ans.innerHTML = '<div class="flex" style="justify-content:center;padding:20px"><div class="spinner"></div></div>';
    try {
      const text = await askAI(q);
      ans.innerHTML = `<div class="ai-msg">${esc(text)}</div>`;
    } catch (e) {
      ans.innerHTML = `<div class="tip bad"><div class="t-head">🚨 Ошибка запроса</div><div class="t-body">${esc(e.message)}</div></div>`;
    }
  };
}

function openAISettings() {
  const s = S.getSettings();
  const m = openModal(`
    <h2>🔑 ИИ-токен</h2>
    <div class="field"><label>API токен</label><input id="f-token" type="password" value="${esc(s.aiToken)}" placeholder="sk-..."></div>
    <div class="field"><label>Базовый URL (OpenAI-совместимый)</label><input id="f-base" value="${esc(s.aiBaseUrl)}" placeholder="https://api.openai.com/v1"></div>
    <div class="field"><label>Модель</label><input id="f-model" value="${esc(s.aiModel)}" placeholder="gpt-4o-mini"></div>
    <p class="muted" style="font-size:12.5px">Примеры: OpenAI — https://api.openai.com/v1 · OpenRouter — https://openrouter.ai/api/v1 · Groq — https://api.groq.com/openai/v1. Токен хранится только на этом устройстве.</p>
    <div class="flex"><button class="btn btn-block" id="ai-cancel">Отмена</button><button class="btn btn-primary btn-block" id="ai-save">Сохранить</button></div>`);
  $('#ai-cancel', m).onclick = closeModal;
  $('#ai-save', m).onclick = () => {
    S.setSetting('aiToken', $('#f-token', m).value.trim());
    S.setSetting('aiBaseUrl', $('#f-base', m).value.trim() || 'https://api.openai.com/v1');
    S.setSetting('aiModel', $('#f-model', m).value.trim() || 'gpt-4o-mini');
    closeModal(); toast('Токен сохранён'); renderAI();
  };
}
