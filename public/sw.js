/* 棉鞋编织花样设计器 —— Service Worker
 * 说明：Service Worker 只在安全上下文（HTTPS 或 localhost）下才会注册成功。
 * 通过 localhost 或 HTTPS 访问时可以正常启用离线缓存。
 */
const CACHE = 'mianxie-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** 网络优先：保证每次打开都是最新版本，断网时回退到缓存 */
async function networkFirst(request, fallbackUrl) {
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, res.clone()).catch(() => undefined);
    }
    return res;
  } catch (err) {
    const hit = await caches.match(request);
    if (hit) return hit;
    if (fallbackUrl) {
      const fb = await caches.match(fallbackUrl);
      if (fb) return fb;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, './index.html'));
    return;
  }
  event.respondWith(networkFirst(req));
});
