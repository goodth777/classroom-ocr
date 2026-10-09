// Network-first so updates show immediately; cached shell keeps the app opening offline.
const CACHE = 'shell-v17';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'ui.js', 'api.js', 'lib.js', 'config.js',
  'store.js', 'outbox.js', 'inbox.js', 'push.js', 'fa.js', 'qr.js', 'vendor/qrcode.js', 'seatlogic.js', 'seats.js', 'seatshow.js', 'formlogic.js', 'forms.js', 'sform.js', 'join.js', 'student.js', 'teacher.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/favicon-32.png'];

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

// Push (FCM data message: {data: {title, body, url, tag}}) → system notification; tapping opens that screen.
self.addEventListener('push', e => {
  let d = {};
  try { const j = e.data.json(); d = j.data || j; } catch {}
  e.waitUntil(self.registration.showNotification(d.title || '과제 제출', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag,
    icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png', data: { url: d.url || '#/' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL('./' + (e.notification.data.url || '#/'), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const win = list.find(c => c.url.startsWith(self.registration.scope));
    if (win) return win.focus().then(w => w.navigate(url));
    return self.clients.openWindow(url);
  }));
});
