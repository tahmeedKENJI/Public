// Network-first service worker: always tries to fetch the latest version (so updates
// arrive), and falls back to the cached copy when offline. After one visit the game
// works with no network at all. Bump CACHE whenever any file changes.
// Only caches named plane-evolution-3d-* are ever deleted, so the 2D game's cache on the
// same site is left alone.
const CACHE = 'plane-evolution-3d-v1';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon.svg', './vendor/three.min.js',
  './js/core.js', './js/terrain.js', './js/scenery.js', './js/sky.js', './js/plane.js', './js/items.js', './js/game.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('plane-evolution-3d-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
