const CACHE_NAME = 'nordic-jobmatch-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching offline assets');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Network First with Cache Fallback for HTML/API, Cache First for Static Assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and Supabase API/Auth endpoints
  if (request.method !== 'GET' || url.pathname.includes('/api/') || url.hostname.includes('supabase.co')) {
    return;
  }

  // Check if static asset (images, fonts, stylesheets)
  const isStaticAsset = 
    request.destination === 'image' || 
    request.destination === 'font' || 
    request.destination === 'style' || 
    request.destination === 'script' ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js');

  if (isStaticAsset) {
    // Cache First, Network Fallback
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(() => new Response('Asset unavailable offline', { status: 404 }));
      })
    );
  } else {
    // Network First, Cache Fallback (for pages and dynamic routing)
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // If offline and request is HTML/page, return index cache as fallback
            if (request.headers.get('accept')?.includes('text/html')) {
              return caches.match('/');
            }
            return new Response('Internetanslutning saknas', { 
              status: 503, 
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
          });
        })
    );
  }
});

// Push Event
self.addEventListener('push', (event) => {
  let data = { title: 'Nordic JobMatch AI', body: 'Nya matchande jobb har hittats!' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Nordic JobMatch AI', body: event.data.text() };
    }
  }

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: {
      url: data.url || '/matches'
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification Click Event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Find open window and focus it, or open a new one
      for (const client of windowClients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.pathname.includes('/matches') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url);
      }
    })
  );
});
