// YENAVI Truck Trip Log — service worker
// Abre rápido y funciona con mala señal: la página se pide a internet primero (para tener siempre la versión nueva)
// y si no hay señal usa la copia guardada. No toca Firebase, Google ni otros servicios: esos van directo a internet.
const VERSION = 'yenavi-2026-10-31a';
const SHELL = ['./', './index.html', './driver.html', './manifest.webmanifest', './driver.webmanifest',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png', './driver-icon-192.png', './driver-icon-512.png', './driver-apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;             // Firebase, Google, mapas: directo a internet
  const isPage = req.mode === 'navigate' || /\.html$/.test(url.pathname) || url.pathname.endsWith('/');
  if (isPage) {
    e.respondWith(fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html'))));
    return;
  }
  e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => {
    if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  })));
});
