/*
 * SI-FaMitra PWA: cache hanya app shell/aset statis same-origin.
 * Request API Supabase, POST/mutasi, serta data pengguna tidak pernah dicache.
 * Jika daftar shell berubah, sesuaikan CACHE_NAME agar cache lama dibuang.
 */
const CACHE_NAME = 'si-famitra-pwa-shell-v2';
const OFFLINE_URL = '/offline.html';
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/famitra-192.png',
  '/icons/famitra-512.png',
  '/icons/famitra-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/style.css',
  '/js_core.js',
  '/js_ai.js',
  '/js_pos.js',
  '/js_dashboard.js',
  '/js_master.js',
  '/js_trx.js',
  '/js_marketing_target.js',
  '/js_marketing_lottery.js',
  '/js_marketing_poin.js',
  '/js_mobile.js',
  '/js_pwa.js'
];
const CACHEABLE_PATHS = new Set(PRECACHE_URLS);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('si-famitra-pwa-shell-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.open(CACHE_NAME)
        .then((cache) => cache.match(OFFLINE_URL))
        .then((cached) => cached || new Response('Anda sedang offline.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        })))
    );
    return;
  }

  if (!CACHEABLE_PATHS.has(url.pathname)) return;

  event.respondWith(
    fetch(request).then((response) => {
      if (response && response.ok && response.type === 'basic') {
        const copy = response.clone();
        return caches.open(CACHE_NAME)
          .then((cache) => cache.put(request, copy))
          .then(() => response, () => response);
      }
      return response;
    }).catch(() => caches.open(CACHE_NAME).then((cache) => cache.match(request)))
  );
});
