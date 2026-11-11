// 오프라인용: 앱 파일을 폰에 저장해두고, 인터넷 없이도 열리게 함.
// 업데이트할 때는 CACHE 이름의 버전을 올리면 다음 실행 때 새 파일로 바뀜.
const CACHE = 'cubetimer-v1.0.2';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'scramble-worker.js',
  'vendor/cubejs/cube.js',
  'vendor/cubejs/solve.js',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' → 브라우저에 남은 옛날 파일 말고 서버의 새 파일을 받아서 저장
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 저장된 파일 먼저, 없으면 인터넷에서
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
