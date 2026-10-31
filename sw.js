// App-shell cache. Bump VERSION on every deploy so phones pick up the new files.
const VERSION = 'mc-2026-11-01-2';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'core.js', 'store.js', 'data.js', 'i18n.js', 'manifest.webmanifest',
  'icons/192.png', 'icons/512.png', 'icons/apple-touch-icon-180.png'];

self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // Apps Script + CDN go straight to the network
  if (req.mode === 'navigate') {
    const shell = url.pathname === new URL('./', location).pathname || url.pathname.endsWith('/index.html');
    e.respondWith(fetch(req).then(res => {
      if (res.ok && shell) { const copy = res.clone(); e.waitUntil(caches.open(VERSION).then(c => c.put('index.html', copy))); } // only the app shell, never test.html or a 404
      return res;
    }).catch(() => caches.match(shell ? 'index.html' : req).then(r => r || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
