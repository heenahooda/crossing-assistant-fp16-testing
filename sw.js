// Offline cache for the app shell. Change the version number whenever you edit any file.
const CACHE = 'crossing-assistant-ml-v3';
const FILES = ['./', './index.html', './warm.html', './manifest.webmanifest',
               './icon-192.png', './icon-512.png', './icon-maskable-512.png', './research-lab.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
