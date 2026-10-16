import {test} from 'node:test';import assert from 'node:assert/strict';
import {checkUpdate} from '../www/js/updater.js';import {GITHUB_REPO} from '../www/js/config.js';
test('updater selects only a stable APK from the configured GitHub repository',async()=>{
 const original=globalThis.fetch;let release={tag_name:'v999.0.0',assets:[{name:'notes.txt',browser_download_url:'https://example.com/file'}]};
 globalThis.fetch=async()=>({ok:true,json:async()=>release});
 try{assert.equal((await checkUpdate()).error,'no-apk');release.assets=[{name:'app.apk',browser_download_url:'https://example.com/app.apk'}];assert.equal((await checkUpdate()).error,'invalid-apk-url');release.assets[0].browser_download_url=`https://github.com/${GITHUB_REPO}/releases/download/v999.0.0/app.apk`;assert.equal((await checkUpdate()).hasUpdate,true);release.prerelease=true;assert.equal((await checkUpdate()).hasUpdate,false);}finally{globalThis.fetch=original;}
});
