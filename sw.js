
const CACHE_NAME = 'agenda-static-v12';
const APP_PREFIX = 'agenda-static-';

const APP_FILES = [
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './manifest.webmanifest',
  './asset-calendar.svg'
];

// Installazione e memorizzazione dei file principali
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    await Promise.allSettled(
      APP_FILES.map(async (file) => {
        try {
          const url = new URL(file, self.registration.scope);
          const response = await fetch(url, { cache: 'reload' });

          if (response.ok) {
            await cache.put(url.href, response);
          }
        } catch (error) {
          console.warn('File non memorizzato:', file, error);
        }
      })
    );

    await self.skipWaiting();
  })());
});

// Attivazione e rimozione delle vecchie cache di Agenda
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();

    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith(APP_PREFIX) && name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    );

    await self.clients.claim();
  })());
});

// Gestione delle richieste del sito
self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Non intercettare richieste verso altri siti
  if (url.origin !== self.location.origin) return;

  // Non intercettare richieste fuori dalla cartella di Agenda
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    try {
      // Prima prova a recuperare la versione più recente
      const response = await fetch(request);

      if (response.ok && response.type !== 'opaque') {
        await cache.put(request, response.clone());
      }

      return response;
    } catch (error) {
      // Senza Internet cerca il file memorizzato
      const cached = await cache.match(request);

      if (cached) return cached;

      // Per le pagine di navigazione usa la pagina principale
      if (request.mode === 'navigate') {
        const fallbackUrl = new URL('./index.html', self.registration.scope);
        const fallback = await cache.match(fallbackUrl.href);

        if (fallback) return fallback;
      }

      return new Response(
        'Pagina non disponibile offline. Riconnettiti a Internet e riprova.',
        {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        }
      );
    }
  })());
});

// Ricezione delle notifiche push inviate dal server
self.addEventListener('push', (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = {
      title: 'Agenda',
      body: event.data ? event.data.text() : 'Hai un nuovo promemoria.'
    };
  }

  const title = data.title || 'Agenda – Promemoria';

  const options = {
    body: data.body || 'Hai un impegno in programma.',
    icon: './asset-calendar.svg',
    badge: './asset-calendar.svg',
    tag: data.tag || 'agenda-reminder',
    renotify: false,
    data: {
      url: data.url || './'
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Apertura di Agenda quando si tocca una notifica
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil((async () => {
    const requestedUrl = new URL(
      event.notification.data?.url || './',
      self.registration.scope
    );

    const scopeUrl = new URL(self.registration.scope);

    // Impedisce alle notifiche di aprire siti esterni
    const isAllowed =
      requestedUrl.origin === scopeUrl.origin &&
      requestedUrl.pathname.startsWith(scopeUrl.pathname);

    const targetUrl = isAllowed
      ? requestedUrl.href
      : scopeUrl.href;

    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    for (const client of windows) {
      if ('navigate' in client) {
        const current = new URL(client.url);

        if (current.origin === scopeUrl.origin) {
          await client.navigate(targetUrl);
          return client.focus();
        }
      }
    }

    if (self.clients.openWindow) {
      return self.clients.openWindow(targetUrl);
    }
  })());
});
