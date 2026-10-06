import {bankDateKey} from './dates.js';
import * as S from './store.js';
import {parseStatementText,prepareStatement,importStatement} from './statement.js';
import {readStatementFile} from './statement-file.js';

export function openStatementImport({openModal,closeModal,esc,renderCurrent,toast}) {
  const accounts=S.getAccounts(),yandex=accounts.find(a=>a.bankId==='yandex');
  const m=openModal(`
    <h2>Выписка Яндекс Банка</h2>
    <p>Закажите выписку по счёту с даты открытия до сегодня в Яндекс Пэй. Если не находите заказ выписки, напишите в чат поддержки. Для разных счетов импортируйте отдельные выписки.</p>
    <p class="muted">Файл обрабатывается на телефоне. Поддерживаются текстовые PDF, CSV, TSV и TXT. Конкретный шаблон выписки проверяется при загрузке. Сканы без текста не распознаются.</p>
    <div class="field"><label>Счёт для операций</label><select id="st-account"><option value="">Выберите счёт</option>${accounts.map(a=>`<option value="${esc(a.id)}" ${a.id===yandex?.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select></div>
    <button class="btn btn-block" id="st-new">Создать отдельный счёт Яндекс Банка</button>
    <div class="field mt8"><label>Выписка</label><input id="st-file" type="file" accept=".pdf,.csv,.tsv,.txt,application/pdf,text/csv,text/plain"></div>
    <p id="st-status" class="muted" role="status"></p>
    <details><summary>Вставить или исправить текст</summary><p class="muted">Для таблицы CSV нужны колонки «Дата», «Описание», «Сумма» со знаком +/− либо отдельные «Приход» и «Расход». Для текста: дата, описание, сумма с валютой и знаком или явным типом операции.</p><textarea id="st-text" rows="8" style="width:100%" aria-label="Текст выписки"></textarea></details>
    <button class="btn btn-block mt8" id="st-parse">Проверить операции</button>
    <div id="st-preview"></div>
    <button class="btn btn-ghost btn-block mt8" id="st-close">Закрыть</button>`);
  const $=id=>m.querySelector(id);let result=null,rows=[],selected=new Set(),page=0,generation=0;
  const reset=()=>{result=null;rows=[];selected.clear();$('#st-preview').innerHTML='';};
  const parse=()=>{
    reset();
    try{
      if(!$('#st-account').value)throw new Error('Сначала выберите или создайте счёт');
      result=parseStatementText($('#st-text').value);
      rows=prepareStatement(result,$('#st-account').value);
      selected=new Set(rows.flatMap((r,i)=>!r.duplicate&&!r.possibleDuplicate?[i]:[]));page=0;
      $('#st-status').textContent=rows.length ? `Распознано: ${rows.length}. Не разобрано блоков/строк: ${result.rejected.length}.` : 'Текст прочитан, но операции не распознаны. Посмотрите неразобранные строки ниже.';
      render();
    }catch(error){$('#st-status').textContent=error.message;}
  };
  $('#st-account').onchange=reset;
  $('#st-new').onclick=()=>{
    const name=prompt('Название счёта', 'Яндекс Банк — выписка');if(!name?.trim())return;
    const account=S.addAccount(name.trim());account.bankId='yandex';S.save();
    const option=document.createElement('option');option.value=account.id;option.textContent=account.name;$('#st-account').append(option);$('#st-account').value=account.id;reset();
  };
  $('#st-text').oninput=reset;
  $('#st-file').onchange=async()=>{
    const file=$('#st-file').files[0];if(!file)return;
    const run=++generation;reset();$('#st-parse').disabled=true;$('#st-status').textContent='Читаю файл…';
    try{
      const text=await readStatementFile(file,message=>{if(run===generation)$('#st-status').textContent=message;});
      if(run!==generation||!m.isConnected)return;
      $('#st-text').value=text;parse();
    }catch(error){if(run===generation)$('#st-status').textContent=error.message||String(error);}
    finally{if(run===generation)$('#st-parse').disabled=false;}
  };
  $('#st-parse').onclick=parse;
  $('#st-close').onclick=()=>{generation++;closeModal();};
  function render(){
    const chosen=[...selected].map(i=>rows[i]),income=chosen.filter(r=>r.type==='income').reduce((s,r)=>s+r.amount,0),expense=chosen.filter(r=>r.type==='expense').reduce((s,r)=>s+r.amount,0);
    $('#st-preview').innerHTML=`<div class="card mt8"><b>Выбрано ${chosen.length} из ${rows.length}</b><p>Приход: ${esc(S.fmtMoney(income))}<br>Расход: ${esc(S.fmtMoney(expense))}</p>
      ${result.reconciliation?`<div class="card"><b>Сверка всей выписки</b>${['income','expense'].map(type=>{const r=result.reconciliation[type];return `<p>${type==='income'?'Приход':'Расход'}: распознано ${esc(S.fmtMoney(r.actual))}${r.expected===null?' · итог банка не найден':` · по выписке ${esc(S.fmtMoney(r.expected))}<br><b>${r.difference===0?'Сумма совпала':'Расхождение: '+esc(S.fmtMoney(r.difference))}</b>`}</p>`;}).join('')}<p class="muted">Сверка относится ко всем распознанным строкам до выбора. При расхождении импорт неполный или требует проверки. Совпадение итогов само по себе не подтверждает правильность каждой строки.</p></div>`:''}
      <p class="muted">Сверьте суммы и количество операций с выпиской. Совпадения с уже записанными операциями сняты с выбора; проверьте их вручную. Импорт выписки не меняет банковский остаток.</p>
      <button class="btn btn-sm" id="st-none">Снять выбор</button> <button class="btn btn-sm" id="st-safe">Выбрать без совпадений</button></div>
      ${rows.slice(page*100,(page+1)*100).map((r,j)=>{const i=page*100+j;return `<label class="card" style="display:block"><input type="checkbox" data-row="${i}" ${selected.has(i)?'checked':''} ${r.duplicate?'disabled':''}> ${esc(bankDateKey(r.date))}${r.postingDate&&bankDateKey(r.postingDate)!==bankDateKey(r.date)?' (проведено '+esc(bankDateKey(r.postingDate))+')':''} · <b>${r.type==='income'?'+':'−'}${esc(S.fmtMoney(r.amount))}</b><br>${esc(r.note)}${r.duplicate?'<br><b>Уже импортировано</b>':r.replacesNotification?'<br><b>Заменит СМС/уведомление данными выписки</b>':r.possibleDuplicate?'<br><b>Возможный повтор по дню и сумме, в том числе на другом счёте — проверьте</b>':''}<details><summary>Исходная строка</summary><p style="white-space:pre-wrap;word-break:break-word">${esc(r.raw)}</p></details></label>`;}).join('')}
      <div class="flex"><button class="btn" id="st-prev" ${page===0?'disabled':''}>Назад</button><span class="grow">${page+1} / ${Math.max(1,Math.ceil(rows.length/100))}</span><button class="btn" id="st-next" ${(page+1)*100>=rows.length?'disabled':''}>Далее</button></div>
      ${result.rejected.length?`<details class="mt8"><summary>Не распознано: ${result.rejected.length}</summary><textarea readonly rows="10" style="width:100%" aria-label="Нераспознанные строки">${esc(result.rejected.map(r=>r.reason+'\n'+r.raw).join('\n\n'))}</textarea></details>`:''}
      <button class="btn btn-primary btn-block mt8" id="st-import" ${!chosen.length?'disabled':''}>Записать выбранные операции (${chosen.length})</button>`;
    $('#st-preview').querySelectorAll('[data-row]').forEach(el=>el.onchange=()=>{const i=+el.dataset.row;if(el.checked)selected.add(i);else selected.delete(i);render();});
    $('#st-none').onclick=()=>{selected.clear();render();};
    $('#st-safe').onclick=()=>{selected=new Set(rows.flatMap((r,i)=>!r.duplicate&&!r.possibleDuplicate?[i]:[]));render();};
    $('#st-prev').onclick=()=>{page--;render();};$('#st-next').onclick=()=>{page++;render();};
    $('#st-import').onclick=()=>{
      try{
        const count=importStatement([...selected].map(i=>rows[i]),$('#st-account').value);
        toast(`Добавлено операций: ${count}`);renderCurrent(false);parse();
      }catch(error){$('#st-status').textContent=error.message;}
    };
  }
}
