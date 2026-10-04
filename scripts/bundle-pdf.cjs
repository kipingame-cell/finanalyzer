const fs = require('node:fs');
// Bundle PDF extraction and worker offline inside the APK.
const pdfRoot = 'node_modules/pdfjs-dist';
const pdfDest = 'www/vendor/pdfjs';
fs.mkdirSync(pdfDest, {recursive:true});
for (const name of ['pdf.mjs', 'pdf.worker.mjs']) fs.copyFileSync(`${pdfRoot}/legacy/build/${name}`, `${pdfDest}/${name}`);
for (const name of ['cmaps', 'standard_fonts', 'wasm']) fs.cpSync(`${pdfRoot}/${name}`, `${pdfDest}/${name}`, {recursive:true});
fs.copyFileSync(`${pdfRoot}/LICENSE`, `${pdfDest}/LICENSE`);
