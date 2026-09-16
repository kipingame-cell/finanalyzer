// ИИ-советник: работает офлайн (эвристики) и с любым OpenAI-совместимым токеном.
import { getState, getSettings, monthTotals, byCategory, lastNMonths, avgMonthlyExpense, currentMonthKey, balance, fmtMoney, topMerchants, txInMonth } from './store.js';

// ---------- Офлайн-анализ (работает без всякого токена) ----------
export function offlineInsights() {
  const tips = [];
  const mk = currentMonthKey();
  const { income, expense } = monthTotals(mk);
  const cats = byCategory(mk, 'expense');
  const avg = avgMonthlyExpense(3);
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const day = new Date().getDate();

  if (!getState().transactions.length) {
    return [{ level: 'info', title: 'Пока пусто', text: 'Добавьте первую операцию или включите чтение уведомлений — и я начну анализировать.' }];
  }

  // Норма сбережений
  if (income > 0) {
    const rate = Math.round(((income - expense) / income) * 100);
    if (rate >= 20) tips.push({ level: 'good', title: `Норма сбережений ${rate}%`, text: 'Отличный результат — выше рекомендуемых 20%. Излишек можно откладывать на накопительный счёт.' });
    else if (rate >= 0) tips.push({ level: 'warn', title: `Норма сбережений ${rate}%`, text: 'Сохраняется меньше 20% дохода. Посмотрите крупнейшие категории ниже — там обычно прячется запас.' });
    else tips.push({ level: 'bad', title: `Расходы превышают доходы на ${fmtMoney(expense - income)}`, text: 'Месяц идёт в минус. Срочно найдите категорию, которую можно урезать.' });
  }

  // Крупнейшая категория
  if (cats.length && expense > 0) {
    const top = cats[0];
    const share = Math.round((top.sum / expense) * 100);
    if (share >= 40) tips.push({ level: 'warn', title: `${top.category.icon} ${top.category.name}: ${share}% всех трат`, text: `${fmtMoney(top.sum)} за месяц. Категория слишком тяжёлая — попробуйте снизить её на 10–15%.` });
  }

  // Перерасход по темпу месяца
  if (avg > 0) {
    const projected = expense / day * daysInMonth;
    if (projected > avg * 1.2) tips.push({ level: 'bad', title: 'Темп трат выше обычного', text: `При текущем темпе месяц закроется на ${fmtMoney(projected)}, а ваш средний — ${fmtMoney(avg)}. Притормозите необязательные покупки.` });
    else if (projected < avg * 0.85) tips.push({ level: 'good', title: 'Идёте экономнее обычного', text: `Прогноз на месяц — ${fmtMoney(projected)} против средних ${fmtMoney(avg)}.` });
  }

  // Бюджеты
  for (const c of cats) {
    const b = c.category.budget;
    if (b > 0 && c.sum > b) tips.push({ level: 'bad', title: `Бюджет «${c.category.name}» пробит`, text: `Потрачено ${fmtMoney(c.sum)} из ${fmtMoney(b)} (+${fmtMoney(c.sum - b)} сверх).` });
    else if (b > 0 && c.sum > b * 0.85) tips.push({ level: 'warn', title: `«${c.category.name}» на грани бюджета`, text: `Осталось ${fmtMoney(b - c.sum)} из ${fmtMoney(b)}.` });
  }

  // Частые мелкие траты
  const txs = txInMonth(mk).filter(t => t.type === 'expense' && t.amount < 300);
  if (txs.length >= 15) {
    const sum = txs.reduce((s, t) => s + t.amount, 0);
    tips.push({ level: 'warn', title: `${txs.length} мелких покупок до 300 ${getSettings().currency}`, text: `Суммарно это уже ${fmtMoney(sum)}. Мелочи съедают бюджет незаметно.` });
  }

  // Подписки
  const subs = byCategory(mk).find(c => c.category.id === 'subs');
  if (subs && subs.sum > 2000) tips.push({ level: 'warn', title: `Подписки: ${fmtMoney(subs.sum)}/мес`, text: `Это ${fmtMoney(subs.sum * 12)} в год. Проверьте, всеми ли пользуетесь.` });

  // Топ-магазин
  const merch = topMerchants(mk, 1);
  if (merch.length && merch[0].sum > 5000) tips.push({ level: 'info', title: `Чаще всего: «${merch[0].note}»`, text: `${fmtMoney(merch[0].sum)} за месяц. Иногда выгоднее закупаться раз в неделю списком.` });

  if (!tips.length) tips.push({ level: 'good', title: 'Всё ровно', text: 'Аномалий не вижу: траты в пределах нормы, бюджеты соблюдаются.' });
  return tips;
}

// ---------- Облачный ИИ (опционально, OpenAI-совместимый API) ----------
function buildFinanceSummary() {
  const mk = currentMonthKey();
  const { income, expense } = monthTotals(mk);
  const cats = byCategory(mk, 'expense').slice(0, 8)
    .map(c => `- ${c.category.name}: ${Math.round(c.sum)} ₽`).join('\n');
  const months = lastNMonths(6).map(m => `${m.label}: доход ${Math.round(m.income)}, расход ${Math.round(m.expense)}`).join('\n');
  return `Баланс: ${Math.round(balance())} ₽\nТекущий месяц: доход ${Math.round(income)} ₽, расход ${Math.round(expense)} ₽\nТраты по категориям:\n${cats || 'нет данных'}\nПоследние месяцы:\n${months}`;
}

export async function askAI(question) {
  const s = getSettings();
  if (!s.aiToken) throw new Error('no-token');
  const base = (s.aiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = s.aiModel || 'gpt-4o-mini';
  const sys = 'Ты — личный финансовый советник. Отвечай по-русски, коротко и по делу, с конкретными цифрами из данных пользователя. Давай 3–5 практичных рекомендаций. Форматируй маркированными списками.';
  const user = `Вот сводка моих финансов:\n${buildFinanceSummary()}\n\nВопрос: ${question || 'Проанализируй мои финансы и дай рекомендации на этот месяц.'}`;
  const resp = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.aiToken },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      temperature: 0.4,
      max_tokens: 900,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`API ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('Пустой ответ от модели');
  return content;
}

export function hasToken() {
  return !!getSettings().aiToken;
}
