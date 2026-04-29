const CACHE_NAME = 'selfig-lego-images-v1';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Intercept requests to the LEGO CDN
  if (url.origin === 'https://www.lego.com' && url.pathname.includes('/cdn/mff/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(event.request).then(response => {
          if (response) {
            return response; // Return from cache immediately
          }
          // Not in cache, fetch it and cache it
          return fetch(event.request).then(networkResponse => {
            // Cache opaque responses (from no-cors requests) as well as ok responses
            if (networkResponse.ok || networkResponse.type === 'opaque') {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          });
        });
      })
    );
  }
});
