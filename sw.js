// 앱 파일을 바꿀 때마다 이 버전을 올리면 성도들 휴대폰에도 새 버전이 받아집니다.
const VERSION = 'v12';
const CACHE = 'chanyang-' + VERSION;
// 글꼴은 바뀌지 않는 큰 파일이라, 앱 버전이 올라가도 다시 받지 않도록 따로 보관합니다. (글꼴을 바꾸면 이 숫자를 올립니다)
const FONTS = 'chanyang-fonts-1';
const SHELL = [
  './', 'index.html', 'app.css', 'app.js', 'server.js', 'config.js', 'vendor/supabase.js', 'manifest.webmanifest',
  'data/videos.txt', 'data/content.json', 'data/sermons.json', 'img/church-building.jpg', 'img/cross.jpg', 'img/cross-mark.png',
  'icons/icon-192-v3.png', 'icons/icon-512-v3.png', 'icons/apple-touch-icon-v3.png', 'icons/favicon-32-v3.png'
];

self.addEventListener('install', (e) => {
  // 브라우저가 잠깐 보관해 둔 예전 파일이 섞이지 않도록, 파일마다 서버에 새것인지 확인하고 받습니다.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'no-cache' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('chanyang-') && k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 서버(Supabase), 유튜브 등 외부 주소는 그대로 둡니다
  if (url.pathname.includes('/supabase/')) return; // 서버 설정 복사 페이지는 항상 최신 내용을 그대로 받습니다

  // 글꼴(목록 파일과 글자 묶음 파일): 한 번 받은 것은 계속 씁니다. 그 디자인에서 실제로 쓰인 것만 받게 됩니다.
  if (url.pathname.includes('/fonts/')) {
    e.respondWith(
      caches.open(FONTS).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { c.put(req, res.clone()); }
        return res;
      })))
    );
    return;
  }

  // 소식·영상 목록·화면 파일·설치 정보(아이콘 이름이 적힌 파일)는 새 내용을 먼저 받고, 인터넷이 없으면 저장해 둔 것을 씁니다.
  const fresh = url.pathname.includes('/data/') || req.mode === 'navigate' || /\.(html|js|css|webmanifest)$/.test(url.pathname);
  if (fresh) {
    // 영상 목록과 소식은 브라우저가 잠깐(10분쯤) 받아 둔 예전 것을 쓰지 않도록, 열 때마다 서버에 새것인지 확인합니다.
    // (바뀌지 않았으면 서버가 "그대로"라고만 답해서 데이터는 거의 들지 않습니다)
    const ask = url.pathname.includes('/data/') ? new Request(req, { cache: 'no-cache' }) : req;
    e.respondWith(
      fetch(ask).then((res) => {
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
