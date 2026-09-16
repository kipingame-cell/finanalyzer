// Автообновление через GitHub Releases: сравниваем версию, качаем APK.
import { APP_VERSION, GITHUB_REPO } from './config.js';

function parseTag(tag) {
  // формат v1.2.3-b45
  const m = String(tag || '').match(/^v?(\d+)\.(\d+)\.(\d+)(?:-b(\d+))?/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], build: +(m[4] || 0) };
}

function cmpVersion(a, b) {
  for (const k of ['major', 'minor', 'patch', 'build']) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  return 0;
}

// Возвращает {hasUpdate, version, url, notes} или {hasUpdate:false}
export async function checkUpdate() {
  const cur = parseTag(APP_VERSION);
  const resp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { 'Accept': 'application/vnd.github+json' },
  });
  if (!resp.ok) return { hasUpdate: false, error: 'no-release' };
  const rel = await resp.json();
  const latest = parseTag(rel.tag_name);
  if (!latest || !cur) return { hasUpdate: false };
  const apk = (rel.assets || []).find(a => /\.apk$/i.test(a.name || '')) || (rel.assets || [])[0];
  if (!apk) return { hasUpdate: false };
  if (cmpVersion(latest, cur) > 0) {
    return {
      hasUpdate: true,
      version: rel.tag_name,
      url: apk.browser_download_url,
      notes: (rel.body || '').slice(0, 500),
      size: apk.size,
    };
  }
  return { hasUpdate: false, version: rel.tag_name };
}

export function downloadUpdate(url) {
  // Открываем во внешнем браузере — Android сам предложит установить APK после скачивания
  window.open(url, '_blank');
}
