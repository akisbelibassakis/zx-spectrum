// Offline cache for the installed app. The emulator's own files are served from the cache straight away and
// refreshed in the background, so a new version shows from the next start. Searches and game downloads
// (other sites) always go to the network.
'use strict';
const CACHE = 'zx-spectrum-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/retro.css', 'css/room.css',
  'js/z80.js', 'js/tape.js', 'js/ay.js', 'js/spectrum.js', 'js/rom48.js', 'js/rom128.js',
  'js/main.js', 'js/retro.js', 'js/screenmenu.js', 'js/catalogue.js',
  'icons/icon.svg', 'icons/icon-32.png', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // other sites: straight to the network
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => cached);
    return cached || fresh;
  }));
});
