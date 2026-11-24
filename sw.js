// Офлайн-кэш: приложение открывается без интернета, обновления подтягиваются в фоне.
const VERSION = 'smeny-v5';
const FONTS = 'smeny-fonts';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/dates.js',
  './js/db.js',
  './js/schedule.js',
  './js/ui.js',
  './js/docs.js',
  './js/exporter.js',
  './js/sync.js',
  './js/config.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // сначала из кэша, параллельно обновляем
    const network = fetch(req).then(async (res) => {
      if (res.ok) {
        const cache = await caches.open(VERSION);
        await cache.put(req, res.clone());
      }
      return res;
    });
    e.waitUntil(network.catch(() => {}));
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then((cached) =>
        cached || network.catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
    );
    return;
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(FONTS).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
          return res;
        } catch {
          return Response.error();
        }
      }),
    );
  }
});
