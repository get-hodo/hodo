// Hodo's helper (service worker). Oct 19: Hodo opens straight from the copy saved on this computer, so a slow
// connection never makes it lag. The browser checks this file on every open; when Hodo has been updated, this file
// changes (the builder names CACHE after the version and build), so the new helper downloads the new copy in the
// background, takes over and deletes the old copy. Hodo then shows "Bring it in" (or the next open uses it).
// Tasks are never here: they live in the person's own folder.
const CACHE = 'hodo-2.1.1-58fbb925';
const CORE = ['./', 'dashboard.html', 'capture.html', 'manifest.webmanifest', 'hodo-192.png', 'hodo-512.png', 'hodo-maskable.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // the Hodo AI calls go straight out
  if (u.pathname.endsWith('/version.json')) return;                          // the update check always asks the website
  e.respondWith(caches.open(CACHE).then(c => c.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(res => {
    if (res.ok) c.put(e.request, res.clone());
    return res;
  }))));
});
