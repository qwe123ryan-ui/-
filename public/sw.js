// استراتيجية التخزين الأولي للأصول
// واستراتيجية الشبكة الأولى للمحتوى الديناميكي
const CACHE_NAME = 'org24-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/audio-engine.js',
  '/fonts/roboto.woff2',
  '/fonts/tajawal.woff2'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => {
        console.log('[Service Worker] Caching all ASSETS...');
        return c.addAll(ASSETS);
      })
      .catch(err => {
        console.error('[Service Worker] Caching failed during install:', err);
      })
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
