const V = 'td-v48';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'chart.js', 'data.js', 'ict.js', 'flow.js', 'integrity.js', 'liq.js', 'confluence.js', 'planner.js', 'gold.js', 'i18n.js', 'analyst.js', 'vp.js', 'backtest.js', 'magnet.js', 'regime.js', 'wyckoff.js', 'ibor.js', 'learn.js', 'bookmap.js', 'draw.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/bg.jpg', 'icons/apple-touch-icon.png', 'icons/favicon-64.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return; // never cache exchange data
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
