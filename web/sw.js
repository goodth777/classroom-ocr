// Network-first so updates show immediately; cached shell keeps the app opening offline.
const CACHE = 'shell-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'ui.js', 'api.js', 'lib.js', 'config.js',
  'store.js', 'join.js', 'student.js', 'teacher.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/favicon-32.png'];

self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request)
    .then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request)));
});
