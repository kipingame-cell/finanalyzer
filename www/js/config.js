// Конфигурация приложения
export const APP_VERSION = '1.0.0';
export const GITHUB_REPO = 'kipingame-cell/finanalyzer'; // для автообновления
export const APP_NAME = 'Финансовый анализатор';

// Категории по умолчанию
export const DEFAULT_CATEGORIES = [
  // Расходы
  { id: 'food',        name: 'Продукты',      icon: '🛒', color: '#4ade80', type: 'expense', budget: 15000 },
  { id: 'cafe',        name: 'Кафе и еда',    icon: '☕', color: '#fbbf24', type: 'expense', budget: 5000 },
  { id: 'transport',   name: 'Транспорт',     icon: '🚌', color: '#60a5fa', type: 'expense', budget: 3000 },
  { id: 'fuel',        name: 'Топливо',       icon: '⛽', color: '#f97316', type: 'expense', budget: 6000 },
  { id: 'home',        name: 'Дом и ЖКХ',     icon: '🏠', color: '#a78bfa', type: 'expense', budget: 8000 },
  { id: 'health',      name: 'Здоровье',      icon: '💊', color: '#f472b6', type: 'expense', budget: 3000 },
  { id: 'clothes',     name: 'Одежда',        icon: '👕', color: '#38bdf8', type: 'expense', budget: 5000 },
  { id: 'fun',         name: 'Развлечения',   icon: '🎮', color: '#e879f9', type: 'expense', budget: 4000 },
  { id: 'subs',        name: 'Подписки',      icon: '🔁', color: '#fb7185', type: 'expense', budget: 1500 },
  { id: 'comm',        name: 'Связь и интернет', icon: '📱', color: '#34d399', type: 'expense', budget: 1000 },
  { id: 'education',   name: 'Образование',   icon: '📚', color: '#facc15', type: 'expense', budget: 0 },
  { id: 'gifts',       name: 'Подарки',       icon: '🎁', color: '#fb923c', type: 'expense', budget: 0 },
  { id: 'other_exp',   name: 'Прочее',        icon: '📦', color: '#94a3b8', type: 'expense', budget: 0 },
  // Доходы
  { id: 'salary',      name: 'Зарплата',      icon: '💼', color: '#22c55e', type: 'income', budget: 0 },
  { id: 'advance',     name: 'Аванс',         icon: '💵', color: '#4ade80', type: 'income', budget: 0 },
  { id: 'bonus',       name: 'Премия',        icon: '🏆', color: '#fbbf24', type: 'income', budget: 0 },
  { id: 'sidejob',     name: 'Подработка',    icon: '🛠️', color: '#60a5fa', type: 'income', budget: 0 },
  { id: 'gift_in',     name: 'Подарки',       icon: '🎁', color: '#e879f9', type: 'income', budget: 0 },
  { id: 'other_inc',   name: 'Прочий доход',  icon: '💰', color: '#94a3b8', type: 'income', budget: 0 },
];

// Ключевые слова для автоматического определения категории по тексту
export const CATEGORY_KEYWORDS = {
  food: ['пятёрочка', 'пятерочка', 'магнит', 'перекрёсток', 'перекресток', 'лента', 'ашан', 'окей', 'продукты', 'супермаркет', 'fix price', 'фикс прайс', 'красное&белое', 'бристоль', 'дикси', 'метро', 'самокат', 'лавка'],
  cafe: ['кафе', 'ресторан', 'кофе', 'coffee', 'бургер', 'пицц', 'суши', 'kfc', 'вкусно и точка', 'макдоналдс', 'столовая', 'додо', 'шаурм', 'бар ', 'паб', 'delivery', 'деливери', 'яндекс еда', 'яндекс.еда'],
  transport: ['метро', 'автобус', 'трамвай', 'троллейбус', 'такси', 'yandex taxi', 'яндекс такси', 'uber', 'ситимобил', 'маршрутк', 'проезд', 'электричк', 'ржд', 'аэрофлот', 'победа', 'авиа'],
  fuel: ['азс', 'лукойл', 'газпромнефть', 'роснефть', 'татнефть', 'башнефть', 'заправк', 'топливо', 'shell', 'эка'],
  home: ['жкх', 'квартплат', 'электроэнерг', 'коммунал', 'ипотек', 'аренд', 'леруа', 'леруа мерлен', 'oba', 'стройматериал', 'мебель', 'ikea', 'hoff', 'петрович'],
  health: ['аптек', 'аптеч', 'лекарств', 'врач', 'клиник', 'стоматолог', 'анализ', 'больниц', 'медицин', 'витамин'],
  clothes: ['одежд', 'обувь', 'wildberries', 'вайлдберриз', 'ozon', 'озон', 'lamoda', 'зара', 'zara', 'h&m', 'спортмастер', 'адик', 'nike', 'adidas'],
  fun: ['кино', 'кинотеатр', 'игр', 'steam', 'playstation', 'xbox', 'боулинг', 'квест', 'концерт', 'театр', 'аквапарк', 'букмекер', 'ставк'],
  subs: ['подписк', 'subscription', 'netflix', 'spotify', 'youtube premium', 'яндекс плюс', 'vk музыка', 'кинопоиск', 'ivi', 'okko', 'premier', 'chatgpt', 'openai'],
  comm: ['мтс', 'билайн', 'beeline', 'мегафон', 'tele2', 'теле2', 'yota', 'йота', 'ростелеком', 'дом.ру', 'интернет', 'связь', 'трафик'],
  education: ['курс', 'обучен', 'учебник', 'книг', 'book', 'skillbox', 'нетология', 'удаленк', 'школ'],
  gifts: ['подарок', 'цветы', 'букет', 'flowwow', 'ювелир'],
  salary: ['зарплат', 'з/п', 'оплата труда', 'расчётный лист', 'заработная плат'],
  advance: ['аванс'],
  bonus: ['преми', 'бонус'],
};

// Пакеты приложений, из которых чаще всего приходят финансовые уведомления
export const KNOWN_BANK_PACKAGES = [
  'ru.sberbankmobile', 'com.idamob.tinkoff.android', 'ru.alfabank.mobile.android',
  'ru.vtb24.mobilebanking.android', 'ru.ftc.faktura.raiffeisen', 'ru.openbank',
  'ru.rosbank.android', 'ru.otpbank.mobile', 'com.sovkombank.mobile', 'ru.gazprombank.android.mobilebank.app',
  'ru.mts.money', 'ru.letobank.Prometheus', 'com.wallet', 'ru.tinkoff.investing',
];
