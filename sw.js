const CACHE_NAME = 'agenda-static-v1';
const CORE_FILES = ['./', './index.html', './styles.css', './config.js', './manifest.webmanifest', './asset-calendar.svg', './asset-calendar-192.png', './asset-calendar-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response && response.status === 200) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html'))));
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data?.text() || 'Hai un promemoria.' }; }
  const title = data.title || 'Promemoria Agenda';
  const options = {
    body: data.body || 'Hai un impegno in programma per domani.',
    icon: './asset-calendar-192.png',
    badge: './asset-calendar-192.png',
    tag: data.tag || 'agenda-reminder',
    renotify: true,
    data: { url: data.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const scopeUrl = new URL(self.registration.scope);
  const target = new URL(event.notification.data?.url || './', scopeUrl).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => client.url.startsWith(scopeUrl.href));
    if (existing) return existing.focus();
    return self.clients.openWindow(target);
  }));
});
