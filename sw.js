// Tiene in memoria l'app per aprirla anche senza rete. Le chiamate a GitHub non passano di qui.
const VERSIONE = 'idee-v4';
const FILE = ['./', 'index.html', 'stile.css', 'app.js', 'manifest.webmanifest', 'icona-192.png', 'icona-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSIONE).then((c) => c.addAll(FILE))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n !== VERSIONE).map((n) => caches.delete(n)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  // Prima la rete (per avere sempre l'ultima versione), poi la copia salvata.
  e.respondWith(fetch(e.request).then((r) => {
    const copia = r.clone(); caches.open(VERSIONE).then((c) => c.put(e.request, copia)); return r;
  }).catch(() => caches.match(e.request)));
});
