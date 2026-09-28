// Offline-Cache: App-Dateien werden beim ersten Besuch gespeichert.
// Bei Änderungen an der App VERSION erhöhen, damit iPads die neue Version laden.
const VERSION = 'handschrift-v2';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'app.css',
  'app.js', 'capture.js', 'charset.js', 'ink.js', 'layout.js', 'overview.js',
  'paper.js', 'pdf.js', 'render.js', 'state.js', 'store.js', 'util.js', 'write.js',
  'perfect-freehand.js', 'hypher.js', 'hyphenation-de.js',
  'icon-180.png', 'icon-192.png', 'icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Erst Netz (damit Updates ankommen), bei fehlender Verbindung aus dem Cache
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
