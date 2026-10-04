// PDF text extraction is local: no uploads or remote scripts.
export function pdfItemsToLines(items) {
  const lines=[];
  for(const item of items.filter(i=>typeof i.str==='string'&&i.str.trim()).sort((a,b)=>b.transform[5]-a.transform[5]||a.transform[4]-b.transform[4])) {
    let line=lines.find(l=>Math.abs(l.y-item.transform[5])<2.5);
    if(!line){line={y:item.transform[5],items:[]};lines.push(line);}line.items.push(item);
  }
  return lines.sort((a,b)=>b.y-a.y).map(l=>l.items.sort((a,b)=>a.transform[4]-b.transform[4]).map(i=>i.str).join(' '));
}
export async function readStatementFile(file,onProgress=()=>{}) {
  if(file.size>30*1024*1024)throw new Error('Файл больше 30 МБ. Разделите выписку по периодам.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(new TextDecoder().decode(bytes.slice(0,5))==='%PDF-') {
    const pdfjs=await import('../vendor/pdfjs/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc=new URL('../vendor/pdfjs/pdf.worker.mjs',import.meta.url).href;
    const task=pdfjs.getDocument({data:bytes,isEvalSupported:false,enableXfa:false,
      cMapUrl:new URL('../vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,
      wasmUrl:new URL('../vendor/pdfjs/wasm/',import.meta.url).href,
      standardFontDataUrl:new URL('../vendor/pdfjs/standard_fonts/',import.meta.url).href});
    try {
      const pdf=await task.promise;
      const lines=[];
      for(let n=1;n<=pdf.numPages;n++) {
        const page=await pdf.getPage(n),content=await page.getTextContent();
        const pageLines=pdfItemsToLines(content.items);
        if(!pageLines.length)throw new Error(`На странице ${n} нет текстового слоя. Нужна текстовая выписка; распознавание сканов пока не поддерживается.`);
        lines.push(...pageLines,'');page.cleanup();onProgress(`Читаю PDF: ${n} из ${pdf.numPages} страниц`);
      }
      return lines.join('\n');
    } catch(error) {
      if(error.name==='PasswordException')throw new Error('PDF защищён паролем. Сохраните копию без пароля для импорта.');
      throw error;
    } finally { await task.destroy(); }
  }
  if(!/\.(csv|tsv|txt)$/i.test(file.name))throw new Error('Выберите PDF, CSV, TSV или TXT. Excel сохраните как CSV.');
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{return new TextDecoder('windows-1251').decode(bytes);}
}
