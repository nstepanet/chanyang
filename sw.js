// 앱 파일을 바꿀 때마다 이 버전을 올리면 성도들 휴대폰에도 새 버전이 받아집니다.
const VERSION = 'v5';
const CACHE = 'chanyang-' + VERSION;
const SHELL = [
  './', 'index.html', 'app.css', 'app.js', 'server.js', 'config.js', 'vendor/supabase.js', 'manifest.webmanifest',
  'data/videos.txt', 'data/content.json', 'img/church-building.jpg',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('chanyang-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 서버(Supabase), 유튜브 등 외부 주소는 그대로 둡니다
  if (url.pathname.includes('/supabase/')) return; // 서버 설정 복사 페이지는 항상 최신 내용을 그대로 받습니다

  // 소식·영상 목록·화면 파일은 새 내용을 먼저 받고, 인터넷이 없으면 저장해 둔 것을 씁니다.
  const fresh = url.pathname.includes('/data/') || req.mode === 'navigate' || /\.(html|js|css)$/.test(url.pathname);
  if (fresh) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
