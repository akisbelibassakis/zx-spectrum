// Offline cache for the installed app. Online, the emulator's own files come fresh from the site (and a copy is
// kept); offline, the copies are used. Searches and game downloads (other sites) always go to the network.
'use strict';
const CACHE = 'zx-spectrum-v36';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/retro.css', 'css/room.css',
  'js/inflate.js', 'js/textfix.js', 'js/z80.js', 'js/tape.js', 'js/ay.js', 'js/spectrum.js', 'js/rom48.js', 'js/rom128.js', 'js/romplus2.js',
  'js/main.js', 'js/retro.js', 'js/screenmenu.js', 'js/catalogue.js', 'js/library.js', 'js/tapes.js',
  'manual/fig-copyright.png', 'manual/fig-load.png', 'manual/fig-catalogue.png', 'manual/fig-search.png', 'manual/fig-save.png', 'manual/fig-print.png',
  'manual/fig-circle.png',
  'icons/icon.svg?v=2', 'icons/icon-32.png?v=2', 'icons/icon-180.png?v=2', 'icons/icon-192.png?v=2', 'icons/icon-512.png?v=2',
];

self.addEventListener('install', e => {
  // straight from the site, not the browser's HTTP cache (GitHub Pages lets it keep files for 10 minutes)
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // other sites: straight to the network
  // online: always the newest files (and keep a copy); offline: the copy. no-cache: the browser asks the site every
  // time (an unchanged file is a short 304), so an update shows on the next opening, not up to 10 minutes later.
  // A new Request from the URL: a page load's own request (mode navigate) cannot be fetched with changed options.
  e.respondWith(caches.open(CACHE).then(cache => fetch(new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }))
    .then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; })
    .catch(() => cache.match(e.request, { ignoreSearch: true }))));
});
