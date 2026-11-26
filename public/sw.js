// Lets the daily log open with no signal. Static files come from the cache
// (refreshed in the background); pages and data try the network first and
// fall back to the last copy. Saves are handled by the page's own outbox.
const CACHE = 'aabfield-v1';
const STATIC = ['/static/app.css', '/static/js/plan.js', '/static/js/field.js', '/static/js/proj4.js', '/static/js/geo.js', '/static/js/maps.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isStatic = url.pathname.startsWith('/static/') || url.pathname.startsWith('/photos/');
  const isField = /^\/projects\/\d+\/log$/.test(url.pathname) || /^\/api\/projects\/\d+\/(design|field)$/.test(url.pathname);
  if (isStatic) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  } else if (isField) {
    e.respondWith(fetch(req).then((r) => {
      if (r.ok && !r.redirected) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return r;
    }).catch(() => caches.match(req).then((hit) => hit || new Response('Offline and this page hasn’t been opened here before.', { status: 503 }))));
  }
});
