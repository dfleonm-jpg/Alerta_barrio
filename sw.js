/* ============================================================================
   Alerta Barrio — Service Worker (PWA)
   Cachea el "app shell" para que la app abra e incluso permita redactar
   reportes sin conexión (los datos viven en localStorage vía data.js).
   Estrategia: cache-first para los assets propios; network-first con fallback
   a caché para navegaciones (HTML).
   ========================================================================== */
const CACHE = 'alerta-barrio-v4';
const SHELL = [
  './',
  'index.html',
  'alerta-barrio.html',
  'informacion.html',
  'reportes.html',
  'assets/app.css',
  'assets/data.js',
  'assets/map.js',
  'assets/report.js',
  'assets/ui.js',
  'assets/firebase-config.js',
  'assets/firebase-init.js',
  'assets/icon.svg',
  'manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navegaciones (HTML): network-first, cae a caché offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => { cachePut(req, res.clone()); return res; })
        .catch(() => caches.match(req).then(r => r || caches.match('index.html')))
    );
    return;
  }

  // Mismo origen (assets propios): cache-first.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => { cachePut(req, res.clone()); return res; }).catch(() => cached))
    );
    return;
  }
  // Terceros (p. ej. fuentes): intenta red, si falla usa caché si existe.
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});

function cachePut(req, res) {
  if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res)).catch(() => {});
}
