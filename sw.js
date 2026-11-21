// Tiene in memoria l'app per aprirla anche senza rete. Le chiamate a GitHub non passano di qui.
// Con la rete chiede sempre la versione più recente (saltando la cache del browser);
// senza rete usa la copia salvata.
const VERSIONE = 'idee-v6';
const FILE = ['./', 'index.html', 'stile.css', 'app.js', 'manifest.webmanifest', 'icona-192.png', 'icona-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSIONE).then((c) => c.addAll(FILE.map((f) => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n !== VERSIONE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(VERSIONE).then((c) => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
