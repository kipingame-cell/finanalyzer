// Capacitor runs this hook before copying the web app to the generated project.
const fs = require('node:fs');
const { version } = require('../package.json');
const file = 'android/app/build.gradle';
if (!fs.existsSync(file)) throw new Error('Android project missing: run cap add android first');
const code = Number(process.env.GITHUB_RUN_NUMBER || process.env.ANDROID_VERSION_CODE || 1);
if (!Number.isSafeInteger(code) || code < 1 || code > 2100000000) throw new Error('Invalid Android version code');
const input = fs.readFileSync(file, 'utf8');
if (!/versionCode\s+\d+/.test(input) || !/versionName\s+"[^"]*"/.test(input)) throw new Error('Android version fields missing');
const output = input.replace(/versionCode\s+\d+/, `versionCode ${code}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${version}-b${code}"`);
fs.writeFileSync(file, output);
console.log(`Android version: ${version}-b${code}, code ${code}`);
