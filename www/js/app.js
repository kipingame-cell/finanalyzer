// Главный модуль UI
import { APP_VERSION, APP_NAME, KNOWN_BANK_PACKAGES } from './config.js';
import * as S from './store.js';
import { drawDonut, drawBars } from './charts.js';
import { offlineInsights, askAI, hasToken } from './ai.js';
import { checkUpdate, downloadUpdate } from './updater.js';
import { isNativeAvailable, isListenerEnabled, openListenerSettings, fetchSuggestions, fetchRaw, injectTestNotification, clearNative, markSeen, markDismissed } from './notify.js';
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

// ============================================================
// УВЕДОМЛЕНИЯ → ОПЕРАЦИИ
// ============================================================
async function openNotifications() {
  const native = isNativeAvailable();
  const enabled = native ? await isListenerEnabled() : false;
  const m = openModal(`
    <h2>🔔 Операции из уведомлений</h2>
    <div id="notif-body"></div>
    <div class="card" style="margin-top:6px">
      <div class="card-title">Или вставьте текст вручную</div>
      <div class="field"><textarea id="paste" rows="3" placeholder="Напр.: Покупка 450,00 ₽, ПЯТЁРОЧКА. Баланс: 12 340 ₽"></textarea></div>
      <button class="btn btn-block" id="btn-parse">Распознать</button>
      <div id="paste-result" class="mt8"></div>
    </div>
    <button class="btn btn-ghost btn-block" id="btn-close-n">Закрыть</button>`);

  $('#btn-close-n', m).onclick = closeModal;
  $('#btn-parse', m).onclick = () => {
    const text = $('#paste', m).value;
    const parsed = parsePastedText(text);
    const box = $('#paste-result', m);
    if (!parsed.length) { box.innerHTML = '<div class="tip warn"><div class="t-head">⚠️ Не распознано</div><div class="t-body">Не нашёл сумму с валютой (₽/руб). Проверьте текст.</div></div>'; return; }
    box.innerHTML = parsed.map(suggHTML).join('');
    bindSuggestionButtons(box);
  };

  const body = $('#notif-body', m);
  if (!native) {
    body.innerHTML = `<div class="tip info"><div class="t-head">💡 Веб-режим</div><div class="t-body">Автоматическое чтение работает в Android-приложении. Здесь можно вставить текст уведомления вручную — распознаю сумму, магазин и категорию.</div></div>`;
    return;
  }
  if (!enabled) {
    body.innerHTML = `<div class="tip warn"><div class="t-head">⚠️ Доступ не выдан</div><div class="t-body">Чтобы приложение само подхватывало покупки из уведомлений банка (Сбер, Т-Банк и др.), выдайте доступ к уведомлениям.</div></div>
      <button class="btn btn-primary btn-block" id="btn-grant">Открыть настройки доступа</button>
      <div class="tip info" style="margin-top:10px"><div class="t-head">🔒 Пишет «Настройки с ограниченным доступом»?</div><div class="t-body">Android 13+ блокирует доступ к уведомлениям для приложений, установленных не из маркета. Решение:<br>1. Настройки телефона → Приложения → Финансовый анализатор.<br>2. Нажмите ⋮ (три точки) сверху справа → «Разрешить ограниченные настройки».<br>3. Подтвердите и вернитесь сюда — доступ к уведомлениям откроется.</div></div>
      <div class="tip info" style="margin-top:10px"><div class="t-head">Выдали доступ? Нажмите сюда</div><div class="t-body">После выдачи доступа вернитесь и нажмите «Проверить снова» — экран обновится.</div></div>
      <button class="btn btn-block" id="btn-recheck">🔄 Проверить снова</button><div class="mt16"></div>`;
    $('#btn-grant', m).onclick = () => openListenerSettings();
    $('#btn-recheck', m).onclick = async () => { closeModal(); openNotifications(); };
    return;
  }

  body.innerHTML = '<p class="muted" style="font-size:13px">Загрузка…</p>';
  await renderNotifBody();

  async function renderNotifBody() {
    const r = await fetchSuggestions();
    const total = r.total || 0;
    const raw = await fetchRaw();
    let html = `<p class="muted" style="font-size:13px">Доступ есть. Перехвачено уведомлений: ${total}. Новых операций: ${r.suggestions.length}.</p>
      <div class="flex" style="gap:8px;margin-bottom:10px">
        <button class="btn btn-sm grow" id="n-refresh">🔄 Обновить</button>
        <button class="btn btn-sm grow" id="n-test">🧪 Тест</button>
        <button class="btn btn-sm btn-ghost" id="n-clear">🗑</button>
      </div>`;
    if (total === 0) {
      html += `<div class="tip info"><div class="t-head">Пока пусто. Проверьте по порядку:</div><div class="t-body">1. Ловятся только <b>новые</b> уведомления, пришедшие ПОСЛЕ выдачи доступа — старые не подтянутся.<br>2. В приложении банка должны быть включены <b>push-уведомления об операциях</b> (Сбер по умолчанию шлёт SMS, а не push — включите в настройках банка).<br>3. Xiaomi / Huawei / Honor: Настройки → Приложения → Финансовый анализатор → включите «Автозапуск», а в «Контроле активности»/батарее выберите «Нет ограничений».<br><br>Нажмите 🧪 <b>Тест</b>: если появилась тестовая покупка — цепочка работает, осталось дождаться push от банка (п.1–3).</div></div>`;
    }
    html += `<div id="sugg-list">${r.suggestions.map(suggHTML).join('')}</div>`;
    if (raw.length) {
      const last = raw.slice(-8).reverse();
      html += `<div class="card" style="margin-top:10px"><div class="card-title">Пойманные уведомления (сырые)</div>` +
        last.map(it => `<div style="border-top:1px solid var(--line);padding:7px 2px;font-size:12px;word-break:break-word"><b style="color:var(--accent2)">${esc(it.pkg || '?')}</b><br><span class="muted">${esc(((it.title || '') + ' ' + (it.text || '')).trim().slice(0, 180) || '(пусто)')}</span></div>`).join('') + `</div>`;
      if (total > 0 && r.suggestions.length === 0) {
        html += `<div class="tip warn"><div class="t-head">⚠️ Ловим, но не распознаём</div><div class="t-body">Уведомления приходят, но формат вашего банка пока не знаком. Сфотографируйте этот экран и пришлите разработчику — добавим формат.</div></div>`;
      }
    }
    body.innerHTML = html;
    bindSuggestionButtons($('#sugg-list', body));
    $('#n-refresh', body).onclick = renderNotifBody;
    $('#n-clear', body).onclick = async () => { await clearNative(); toast('Список перехваченных очищен'); renderNotifBody(); };
    $('#n-test', body).onclick = async () => {
      const ok = await injectTestNotification();
      if (!ok) { toast('Тест недоступен: обновите приложение', 3000); return; }
      await renderNotifBody();
      const found = $('#sugg-list', body).querySelector('.sugg-card');
      toast(found ? '✅ Тест прошёл: цепочка работает' : 'Тест добавлен, но не распознан — пришлите скрин', 3000);
    };
  }
}

const suggCache = new Map();
function suggHTML(p) {
  suggCache.set(p.hash, p);
  const c = S.getCategory(p.categoryId);
  return `<div class="sugg-card" data-hash="${p.hash}">
    <div class="flex">
      <div class="tx-ico" style="background:${c.color}22">${c.icon}</div>
      <div class="grow">
        <div style="font-weight:700">${esc(p.note || c.name)}</div>
        <div class="muted" style="font-size:12px">${esc(c.name)} · ${p.type === 'income' ? 'доход' : 'расход'}</div>
      </div>
      <b style="font-size:16px;color:${p.type === 'income' ? 'var(--good)' : 'var(--text)'}">${p.type === 'income' ? '+' : '−'}${S.fmtMoney(p.amount)}</b>
    </div>
    <div class="flex mt8">
      <button class="btn btn-primary btn-sm grow" data-act="add">✓ Записать</button>
      <button class="btn btn-sm" data-act="edit">Изменить</button>
      <button class="btn btn-sm btn-ghost" data-act="skip">✕</button>
    </div>
    <div class="sugg-raw">${esc(p.rawText)}</div>
  </div>`;
}

function bindSuggestionButtons(container) {
  if (!container) return;
  container.querySelectorAll('.sugg-card').forEach(card => {
    const hash = card.dataset.hash;
    card.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        const act = btn.dataset.act;
        if (act === 'skip') { markDismissed(hash); card.remove(); refreshBadge(); return; }
        const p = suggCache.get(hash);
        if (!p) { card.remove(); return; }
        if (act === 'add') {
          S.addTransaction({ type: p.type, amount: p.amount, categoryId: p.categoryId, note: p.note, date: new Date(p.ts || Date.now()).toISOString(), source: 'notification', hash });
          markSeen(hash);
          card.remove(); toast('Операция записана'); refreshBadge(); renderCurrent(false);
        } else if (act === 'edit') {
          openTxModal(null, p, () => { markSeen(hash); card.remove(); refreshBadge(); renderCurrent(false); });
        }
      };
    });
  });
}

async function refreshBadge() {
  if (!isNativeAvailable()) return;
  if (!(await isListenerEnabled())) return;
  const r = await fetchSuggestions();
  pendingSuggCount = r.suggestions.length;
  const btn = $('#btn-notif');
  if (btn) btn.innerHTML = `🔔 ${pendingSuggCount ? `<span class="badge">${pendingSuggCount}</span>` : ''}`;
}

// ============================================================
// ДОБАВЛЕНИЕ / РЕДАКТИРОВАНИЕ ОПЕРАЦИИ
// ============================================================
function openTxModal(existing = null, draft = null, onSaved = null) {
  const src = existing || draft || {};
  let type = src.type || 'expense';
  let categoryId = src.categoryId || null;
  const m = openModal(`
    <h2>${existing ? '✏️ Операция' : '＋ Новая операция'}</h2>
    <div class="seg" id="type-seg">
      <button data-t="expense" class="${type === 'expense' ? 'active' : ''}">Расход</button>
      <button data-t="income" class="${type === 'income' ? 'active' : ''}">Доход</button>
    </div>
    <div class="field"><input id="f-amount" class="amount-input" inputmode="decimal" placeholder="0" value="${src.amount || ''}"></div>
    <div class="field"><label>Категория</label><div class="cat-grid" id="cat-grid"></div></div>
    <div class="field"><label>Комментарий</label><input id="f-note" value="${esc(src.note || '')}" placeholder="Напр.: Пятёрочка"></div>
    <div class="field"><label>Дата</label><input id="f-date" type="datetime-local" value="${toLocalInput(src.date)}"></div>
    <div class="flex">
      ${existing ? '<button class="btn btn-danger" id="tx-del">🗑</button>' : ''}
      <button class="btn btn-primary btn-block grow" id="tx-save">Сохранить</button>
    </div>`);

  function renderCatGrid() {
    const grid = $('#cat-grid', m);
    const cats = S.getCategories(type);
    if (!categoryId || !cats.some(c => c.id === categoryId)) categoryId = cats[0] ? cats[0].id : null;
    grid.innerHTML = cats.map(c => `<div class="cat-cell ${c.id === categoryId ? 'active' : ''}" data-id="${c.id}">
      <span class="ci">${c.icon}</span><span>${esc(c.name)}</span></div>`).join('');
    grid.querySelectorAll('.cat-cell').forEach(el => el.onclick = () => { categoryId = el.dataset.id; renderCatGrid(); });
  }
  renderCatGrid();

  $('#type-seg', m).querySelectorAll('button').forEach(b => b.onclick = () => {
    type = b.dataset.t;
    $('#type-seg', m).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    categoryId = null; renderCatGrid();
  });

  $('#tx-save', m).onclick = () => {
    const amount = parseFloat(String($('#f-amount', m).value).replace(',', '.'));
    if (!amount || amount <= 0) { toast('Введите сумму'); return; }
    const patch = {
      type, amount, categoryId,
      note: $('#f-note', m).value.trim(),
      date: new Date($('#f-date', m).value || Date.now()).toISOString(),
      source: src.source || 'manual',
    };
    if (existing) { S.updateTransaction(existing.id, patch); toast('Сохранено'); }
    else { if (src.hash) patch.hash = src.hash; S.addTransaction(patch); toast('Добавлено'); }
    closeModal();
    if (onSaved) onSaved(); else renderCurrent(false);
  };
  const del = $('#tx-del', m);
  if (del) del.onclick = () => {
    if (confirm('Удалить операцию?')) { S.deleteTransaction(existing.id); closeModal(); renderCurrent(false); toast('Удалено'); }
  };
}

function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// ============================================================
// ЕЩЁ (настройки, категории, бэкап, обновление)
// ============================================================
function renderMore() {
  const s = S.getSettings();
  view().innerHTML = `
    <div class="page-head"><h1>Ещё</h1></div>
    <div class="card row-list">
      <div class="menu-row" id="m-notif"><span class="mr-ico">🔔</span><div class="mr-text">Операции из уведомлений<div class="mr-sub">Сбер, Т-Банк, Альфа — автоматически</div></div>${pendingSuggCount ? `<span class="badge">${pendingSuggCount}</span>` : '›'}</div>
      <div class="menu-row" id="m-cats"><span class="mr-ico">🏷️</span><div class="mr-text">Категории и бюджеты<div class="mr-sub">${S.getCategories().length} категорий</div></div>›</div>
      <div class="menu-row" id="m-ai"><span class="mr-ico">🔑</span><div class="mr-text">ИИ-токен<div class="mr-sub">${hasToken() ? 'подключён' : 'не задан (офлайн-советы работают)'}</div></div>›</div>
      <div class="menu-row" id="m-backup"><span class="mr-ico">💾</span><div class="mr-text">Бэкап и восстановление<div class="mr-sub">JSON-файл</div></div>›</div>
      <div class="menu-row" id="m-demo"><span class="mr-ico">✨</span><div class="mr-text">Демо-данные<div class="mr-sub">заполнить примером для показа</div></div>›</div>
      <div class="menu-row" id="m-update"><span class="mr-ico">🔄</span><div class="mr-text">Обновление приложения<div class="mr-sub">версия ${APP_VERSION}</div></div>›</div>
    </div>
    <div class="card row-list">
      <div class="menu-row" id="m-wipe"><span class="mr-ico">🗑️</span><div class="mr-text" style="color:#fda4af">Сбросить все данные</div></div>
    </div>
    <p class="muted" style="font-size:12px;text-align:center">${APP_NAME} v${APP_VERSION}<br>Все данные хранятся только на вашем устройстве.</p>`;
  $('#m-notif').onclick = openNotifications;
  $('#m-cats').onclick = openCategories;
  $('#m-ai').onclick = openAISettings;
  $('#m-backup').onclick = openBackup;
  $('#m-demo').onclick = () => { if (confirm('Добавить демонстрационные операции? Они смешаются с вашими.')) { S.loadDemoData(); toast('Демо-данные загружены'); renderCurrent(false); } };
  $('#m-update').onclick = manualUpdateCheck;
  $('#m-wipe').onclick = () => { if (confirm('Удалить ВСЕ операции и настройки? Это необратимо.')) { S.wipeAll(); toast('Данные удалены'); renderCurrent(false); } };
}

// ---------- Категории и бюджеты ----------
function openCategories() {
  const renderList = (m) => {
    const html = S.getCategories().map(c => `
      <div class="legend-row" data-id="${c.id}">
        <span class="legend-dot" style="background:${c.color}"></span>
        <span class="legend-name">${c.icon} ${esc(c.name)} <span class="muted" style="font-size:11px">${c.type === 'income' ? 'доход' : 'расход'}</span></span>
        ${c.type === 'expense' ? `<span class="muted" style="font-size:12px">бюджет: ${c.budget ? S.fmtMoney(c.budget) : '—'}</span>` : ''}
        <button class="btn btn-sm btn-ghost" data-edit="${c.id}">✏️</button>
      </div>`).join('');
    $('#cat-list', m).innerHTML = html;
    m.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editCategory(b.dataset.edit, m, renderList));
  };
  const m = openModal(`
    <h2>🏷️ Категории и бюджеты</h2>
    <div id="cat-list"></div>
    <button class="btn btn-block mt8" id="cat-add">＋ Новая категория</button>
    <button class="btn btn-ghost btn-block mt8" id="cat-close">Закрыть</button>`);
  renderList(m);
  $('#cat-close', m).onclick = () => { closeModal(); renderCurrent(false); };
  $('#cat-add', m).onclick = () => editCategory(null, m, renderList);
}

function editCategory(id, parentModal, rerender) {
  const c = id ? S.getCategory(id) : { name: '', icon: '💠', color: '#7c6cff', type: 'expense', budget: 0 };
  const icons = ['🛒','☕','🚌','⛽','🏠','💊','👕','🎮','🔁','📱','📚','🎁','📦','💼','💵','🏆','🛠️','💰','🍔','💈','🐾','🚗','✈️','🎬','💄','🏋️','👶','🐱','💳','🧾'];
  const colors = ['#4ade80','#fbbf24','#60a5fa','#f97316','#a78bfa','#f472b6','#38bdf8','#e879f9','#fb7185','#34d399','#facc15','#94a3b8','#7c6cff','#22d3ee'];
  const m2 = document.createElement('div');
  $('#modal-root').innerHTML = '';
  const m = openModal(`
    <h2>${id ? '✏️' : '＋'} Категория</h2>
    <div class="field"><label>Название</label><input id="c-name" value="${esc(c.name)}"></div>
    <div class="seg" id="c-type">
      <button data-t="expense" class="${c.type === 'expense' ? 'active' : ''}">Расход</button>
      <button data-t="income" class="${c.type === 'income' ? 'active' : ''}">Доход</button>
    </div>
    <div class="field"><label>Иконка</label><div class="chip-row" id="c-icons">${icons.map(i => `<span class="chip ${i === c.icon ? 'active' : ''}" data-i="${i}">${i}</span>`).join('')}</div></div>
    <div class="field"><label>Цвет</label><div class="chip-row" id="c-colors">${colors.map(x => `<span class="chip" style="background:${x};min-width:34px" data-c="${x}"></span>`).join('')}</div></div>
    <div class="field" id="c-budget-wrap"><label>Бюджет на месяц, ₽ (0 — без лимита)</label><input id="c-budget" inputmode="numeric" value="${c.budget || 0}"></div>
    <div class="flex">
      ${id ? '<button class="btn btn-danger" id="c-del">🗑</button>' : ''}
      <button class="btn btn-primary btn-block grow" id="c-save">Сохранить</button>
    </div>`);
  let type = c.type, icon = c.icon, color = c.color;
  $('#c-type', m).querySelectorAll('button').forEach(b => b.onclick = () => {
    type = b.dataset.t;
    $('#c-type', m).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    $('#c-budget-wrap', m).style.display = type === 'expense' ? '' : 'none';
  });
  $('#c-budget-wrap', m).style.display = type === 'expense' ? '' : 'none';
  $('#c-icons', m).querySelectorAll('.chip').forEach(el => el.onclick = () => { icon = el.dataset.i; $('#c-icons', m).querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === el)); });
  $('#c-colors', m).querySelectorAll('.chip').forEach(el => el.onclick = () => { color = el.dataset.c; el.style.outline = '2px solid #fff'; $('#c-colors', m).querySelectorAll('.chip').forEach(x => { if (x !== el) x.style.outline = 'none'; }); });
  $('#c-save', m).onclick = () => {
    const name = $('#c-name', m).value.trim();
    if (!name) { toast('Введите название'); return; }
    const budget = Math.max(0, parseInt($('#c-budget', m).value) || 0);
    if (id) S.updateCategory(id, { name, icon, color, type, budget });
    else S.addCategory({ name, icon, color, type, budget });
    closeModal(); openCategories(); // перерисуем список
  };
  const del = $('#c-del', m);
  if (del) del.onclick = () => { if (confirm('Удалить категорию? Операции перейдут в «Прочее».')) { S.deleteCategory(id); closeModal(); openCategories(); } };
}

// ---------- Бэкап ----------
function openBackup() {
  const m = openModal(`
    <h2>💾 Бэкап</h2>
    <button class="btn btn-primary btn-block" id="b-export">💾 Сохранить бэкап</button>
    <div class="mt16"></div>
    <div class="field"><label>Восстановить из файла/текста</label><textarea id="b-text" rows="4" placeholder="Вставьте содержимое JSON-бэкапа"></textarea></div>
    <button class="btn btn-block" id="b-import">⬆️ Восстановить</button>
    <button class="btn btn-ghost btn-block mt8" id="b-close">Закрыть</button>`);
  $('#b-close', m).onclick = closeModal;
  $('#b-export', m).onclick = async () => {
    const data = S.exportJSON();
    const fname = `finanalyzer-backup-${new Date().toISOString().slice(0, 10)}.json`;
    // Всегда показываем JSON в поле — как запасной вариант можно скопировать руками
    $('#b-text', m).value = data;
    // В Android WebView браузерное скачивание не работает — пишем файл нативно
    const fs = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
    if (fs) {
      try {
        await fs.writeFile({ path: `FinAnalyzer/${fname}`, data, directory: 'DOCUMENTS', recursive: true });
        toast('Сохранено: Документы/FinAnalyzer/' + fname, 3500);
      } catch (e) {
        toast('Не вышло сохранить файл — скопируйте текст из поля ниже', 3500);
      }
      return;
    }
    // Веб-фолбэк (браузер)
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    toast('Бэкап скачан');
  };
  $('#b-import', m).onclick = () => {
    try { S.importJSON($('#b-text', m).value); closeModal(); toast('Данные восстановлены'); renderCurrent(false); }
    catch (e) { toast('Ошибка: ' + e.message); }
  };
}

// ---------- Обновление ----------
async function manualUpdateCheck() {
  toast('Проверяю обновления…');
  try {
    const r = await checkUpdate();
    if (r.hasUpdate) showUpdateDialog(r);
    else toast(r.error === 'no-release' ? 'Релизы ещё не собраны' : 'У вас последняя версия');
  } catch (e) { toast('Нет связи с сервером обновлений'); }
}

function showUpdateDialog(r) {
  const m = openModal(`
    <h2>🔄 Доступно обновление</h2>
    <p>Новая версия: <b>${esc(r.version)}</b> (у вас v${APP_VERSION})${r.size ? `<br><span class="muted">Размер: ${(r.size / 1048576).toFixed(1)} МБ</span>` : ''}</p>
    ${r.notes ? `<p class="muted" style="font-size:13px">${esc(r.notes)}</p>` : ''}
    <div class="flex">
      <button class="btn btn-block" id="u-later">Позже</button>
      <button class="btn btn-primary btn-block" id="u-go">Скачать и установить</button>
    </div>
    <p class="muted" style="font-size:12px;margin-top:10px">После скачивания откройте APK-файл — Android предложит обновить приложение поверх текущего, данные сохранятся.</p>`);
  $('#u-later', m).onclick = closeModal;
  $('#u-go', m).onclick = () => { downloadUpdate(r.url); closeModal(); };
}

// ============================================================
// РОУТЕР / ИНИЦИАЛИЗАЦИЯ
// ============================================================
function renderCurrent(resetAnim = true) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === currentTab));
  $('#fab').style.display = (currentTab === 'home' || currentTab === 'ops') ? '' : 'none';
  if (currentTab === 'home') renderHome();
  else if (currentTab === 'ops') renderOps();
  else if (currentTab === 'stats') renderStats();
  else if (currentTab === 'ai') renderAI();
  else renderMore();
}

async function autoUpdateCheck() {
  try {
    const r = await checkUpdate();
    if (r.hasUpdate) showUpdateDialog(r);
  } catch (e) { /* офлайн — молча */ }
}

function boot() {
  S.initStore();
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => { currentTab = t.dataset.tab; renderCurrent(); });
  $('#fab').onclick = () => openTxModal();
  renderCurrent();
  setTimeout(autoUpdateCheck, 2500);
  refreshBadge();
  setInterval(refreshBadge, 30000);
}

boot();
