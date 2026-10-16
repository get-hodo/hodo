// Hodo's service worker: Hodo opens even when offline. Pages and code always try the network first (so updates arrive
// right away) and fall back to the last copy; the Guide clips and icons come from the cache once fetched.
// Tasks are never here: they live in the person's own folder.
const CACHE = 'hodo-v1';
const CORE = ['./', 'dashboard.html', 'capture.html', 'manifest.webmanifest', 'hodo-192.png', 'hodo-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // the Hodo AI calls and fonts go straight out
  if (/\.(webm|png|ico)$/.test(u.pathname)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return res; })));
    return;
  }
  e.respondWith(fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return res; }).catch(() => caches.match(e.request)));
});
