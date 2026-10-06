import { CATEGORY_KEYWORDS, DEFAULT_CATEGORIES } from './config.js';
export const unassigned = type => type === 'income' ? 'uncategorized_inc' : 'uncategorized_exp';
export function guessCategory(text, type) {
  const low=String(text||'').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ');
  // Transaction purpose takes precedence over a bank's name (e.g. Ozon Bank).
  if(type==='income') {
    if(/возврат|отмена оплаты/.test(low))return 'refund';
    if(/к[эе]шб[эе]к|cashback/.test(low))return 'cashback';
    if(/(?:начисление|выплата|зачисление) процентов/.test(low))return 'interest';
  }
  if(/(?:исходящий|входящий|внутрибанковский) перевод|перевод (?:сбп|себе|на |от )|вам перевели|получен перевод/.test(low)) return type==='income'?'transfer_in':'transfer_out';
  if(type==='expense') {
    if(/\bip lukankin a\.a\./.test(low))return 'food';
    if(/yandex\*plus|boosty|бусти/.test(low))return 'subs';
    if(/снятие наличных|выдача наличных|банкомат/.test(low))return 'cash';
    if(/комиссия/.test(low))return 'fees';
    if(/налог|штраф|госпошлин/.test(low))return 'taxes';
  }
  const allowed=new Set(DEFAULT_CATEGORIES.filter(c=>c.type===type).map(c=>c.id));
  let best=null,length=0;
  for(const [id,words] of Object.entries(CATEGORY_KEYWORDS)) {
    if(!allowed.has(id))continue;
    for(const word of words)if(low.includes(word.replace(/ё/g,'е'))&&word.length>length){best=id;length=word.length;}
  }
  return best||unassigned(type);
}
