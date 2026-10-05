// Chỉ đăng ký trên máy riêng: lưu vỏ app (HTML/CSS/JS) để mở được khi mất mạng.
// Không bao giờ lưu /api/ — dữ liệu offline nằm trong IndexedDB ở dạng đã mã hoá.

const CACHE = 'for-me-shell-v1';
const SHELL = [
  '/',
  '/app.css',
  '/icon.svg',
  '/manifest.webmanifest',
  '/js/main.js',
  '/js/api.js',
  '/js/crypto.js',
  '/js/files.js',
  '/js/idb.js',
  '/js/markdown.js',
  '/js/store.js',
  '/js/ui.js',
  '/js/tools/index.js',
  '/js/tools/notes.js',
  '/js/tools/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Có mạng thì luôn lấy bản mới (và cập nhật cache); mất mạng mới dùng cache.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request.mode === 'navigate' ? '/' : e.request, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(e.request.mode === 'navigate' ? '/' : e.request)) ?? Response.error()),
  );
});
