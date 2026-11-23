// 앱 아이콘과 휴대폰 보관(서비스 워커) 점검
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const root = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : ' FAIL ') + n + (x !== undefined && !c ? '  → ' + x : '')); };
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(root, f));
// PNG 머리말에서 크기와 색 방식(2 = 투명 없는 RGB)을 읽는다
const png = (f) => {
  const b = fs.readFileSync(path.join(root, f));
  const sig = b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' && b.subarray(12, 16).toString() === 'IHDR';
  return { sig, w: b.readUInt32BE(16), h: b.readUInt32BE(20), depth: b[24], color: b[25], bytes: b.length };
};

(async () => {
  // ── 1. 아이콘 파일 ────────────────────────────────────────────────
  console.log('\n[1] 아이콘 파일');
  const man = JSON.parse(read('manifest.webmanifest'));
  const icons = man.icons || [];
  ok('설치 정보에 아이콘이 3개 (보통 192·512, 둥근 모양용 512)', icons.length === 3 &&
    icons.some((i) => i.sizes === '192x192' && i.purpose === 'any') && icons.some((i) => i.sizes === '512x512' && i.purpose === 'any') &&
    icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'), JSON.stringify(icons));
  for (const i of icons) {
    const has = exists(i.src); const p = has ? png(i.src) : {};
    ok(`${i.src}: 파일이 있고, 적힌 크기(${i.sizes})와 실제 크기가 같고, 투명한 부분이 없는 PNG`,
      has && p.sig && `${p.w}x${p.h}` === i.sizes && p.color === 2 && i.type === 'image/png', has ? JSON.stringify(p) : '파일 없음');
  }
  const html = read('index.html');
  const fav = (html.match(/<link rel="icon" href="([^"]+)"/) || [])[1];
  const apple = (html.match(/<link rel="apple-touch-icon" href="([^"]+)"/) || [])[1];
  ok('브라우저 탭 아이콘: 파일이 있고 32×32', !!fav && exists(fav) && png(fav).w === 32 && png(fav).h === 32 && png(fav).sig, fav);
  ok('아이폰 홈 화면 아이콘: 파일이 있고 180×180, 투명한 부분 없음', !!apple && exists(apple) && png(apple).w === 180 && png(apple).h === 180 && png(apple).color === 2, apple);
  const sw = read('sw.js');
  const shell = (sw.match(/const SHELL = \[([\s\S]*?)\];/) || ['', ''])[1].match(/'[^']+'/g).map((x) => x.slice(1, -1));
  const used = [...icons.filter((i) => i.purpose === 'any').map((i) => i.src), fav, apple];
  ok('아이콘이 휴대폰 보관 목록에 들어 있음 (인터넷이 끊겨도 보임)', used.every((f) => shell.includes(f)), used.filter((f) => !shell.includes(f)).join(', '));
  ok('보관 목록의 파일이 모두 실제로 있음', shell.filter((f) => f !== './' && !exists(f)).length === 0, shell.filter((f) => f !== './' && !exists(f)).join(', '));
  const oldNames = ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];
  const all = html + read('manifest.webmanifest') + sw + read('app.js') + read('app.css');
  ok('예전 아이콘 파일은 지웠고, 어디에서도 예전 이름을 쓰지 않음', oldNames.every((f) => !exists(f) && !all.includes(f)), oldNames.filter((f) => exists(f) || all.includes(f)).join(', '));
  const names = fs.readdirSync(path.join(root, 'icons')).sort();
  ok('icons 폴더에는 쓰는 파일만 있음', names.length === 5 && names.every((n) => (html + read('manifest.webmanifest')).includes('icons/' + n)), names.join(', '));
  ok('아이콘 이름이 모두 같은 꼬리표(-v숫자)를 씀', new Set(names.map((n) => (n.match(/-v(\d+)\.png$/) || [])[1])).size === 1 && /-v\d+\.png$/.test(names[0]), names.join(', '));

  // ── 2. 휴대폰 보관(서비스 워커) 동작 ───────────────────────────────
  console.log('\n[2] 휴대폰 보관 동작');
  const ORIGIN = 'https://nstepanet.github.io', BASE = ORIGIN + '/chanyang/';
  const make = () => {
    const env = { handlers: {}, stores: {}, net: [], offline: false, skipped: 0, claimed: 0, body: {} };
    const cacheObj = (name) => {
      const store = env.stores[name] || (env.stores[name] = new Map());
      return {
        addAll: async (reqs) => { for (const r of reqs) { const req = typeof r === 'string' ? new Request(new URL(r, BASE)) : r; const res = await env.fetch(req); if (!res.ok) throw new Error('addAll ' + req.url); store.set(req.url, res); } },
        put: async (req, res) => { store.set(typeof req === 'string' ? new URL(req, BASE).href : req.url, res); },
        match: async (req) => { const hit = store.get(typeof req === 'string' ? new URL(req, BASE).href : req.url); return hit ? hit.clone() : undefined; },
      };
    };
    env.caches = {
      open: async (name) => cacheObj(name),
      keys: async () => Object.keys(env.stores),
      delete: async (name) => { delete env.stores[name]; return true; },
      match: async (req) => { for (const n of Object.keys(env.stores)) { const hit = await cacheObj(n).match(req); if (hit) return hit; } return undefined; },
    };
    env.fetch = async (req) => {
      const r = typeof req === 'string' ? new Request(new URL(req, BASE)) : req;
      env.net.push({ url: r.url.replace(BASE, '') || './', cache: r.cache });
      if (env.offline) throw new TypeError('Failed to fetch');
      const rel = r.url.replace(BASE, '');
      if (rel !== '' && !exists(rel)) return new Response('', { status: 404 });
      return new Response(env.body[rel] || 'net:' + (rel || './'), { status: 200 });
    };
    const self = { addEventListener: (t, f) => { env.handlers[t] = f; }, skipWaiting: async () => { env.skipped++; }, clients: { claim: async () => { env.claimed++; } }, location: new URL(BASE + 'sw.js') };
    class Req extends Request { constructor(u, init) { super(typeof u === 'string' ? new URL(u, BASE) : u, init); } }
    vm.runInNewContext(sw, { self, caches: env.caches, fetch: env.fetch, Request: Req, Response, URL, Promise, console });
    env.fire = async (type, extra) => { let p; const e = Object.assign({ waitUntil: (x) => { p = x; }, respondWith: (x) => { p = x; } }, extra); env.handlers[type](e); return p === undefined ? undefined : await p; };
    return env;
  };
  let s = make();
  s.stores['chanyang-v6'] = new Map([[BASE + 'icons/icon-192.png', new Response('old')]]);
  await s.fire('install');
  const ver = (sw.match(/const VERSION = '([^']+)'/) || [])[1];
  const cur = s.stores['chanyang-' + ver];
  ok('설치할 때 보관 목록을 모두 받아 둠', !!cur && cur.size === shell.length && s.skipped === 1, cur && cur.size + ' / ' + shell.length);
  ok('받을 때 파일마다 서버에 새것인지 확인함 (브라우저가 잠깐 보관한 예전 파일을 쓰지 않음)', s.net.length === shell.length && s.net.every((x) => x.cache === 'no-cache'), JSON.stringify(s.net.filter((x) => x.cache !== 'no-cache')));
  await s.fire('activate');
  ok('새 버전이 자리 잡으면 예전 보관분(예전 아이콘 포함)을 지움', Object.keys(s.stores).join() === 'chanyang-' + ver && s.claimed === 1, Object.keys(s.stores).join());
  const get = async (rel, init) => { s.net.length = 0; const res = await s.fire('fetch', { request: new Request(BASE + rel, init) }); return res ? await res.text() : undefined; };
  // 설치한 뒤 서버의 파일이 바뀐 상황
  s.body['manifest.webmanifest'] = '새 설치 정보'; s.body['app.js'] = '새 화면'; s.body[icons[0].src] = '같은 이름으로 바뀐 그림';
  ok('설치 정보(manifest)는 새 내용을 먼저 받음', (await get('manifest.webmanifest')) === '새 설치 정보' && s.net.length === 1, JSON.stringify(s.net));
  ok('화면 파일(app.js)도 새 내용을 먼저 받음', (await get('app.js')) === '새 화면' && s.net.length === 1);
  ok('아이콘·그림은 받아 둔 것을 바로 씀 (그래서 그림을 바꿀 때는 이름도 바꿔야 함)', (await get(icons[0].src)) === 'net:' + icons[0].src && s.net.length === 0 && (await get('img/cross.jpg')) !== undefined && s.net.length === 0, JSON.stringify(s.net));
  await new Promise((r) => setTimeout(r, 10));
  s.offline = true;
  ok('인터넷이 끊겨도 마지막으로 받은 설치 정보·화면 파일과 아이콘이 나옴', (await get('manifest.webmanifest')) === '새 설치 정보' && (await get('app.js')) === '새 화면' && (await get(fav)) === 'net:' + fav && (await get(apple)) === 'net:' + apple);
  s.offline = false;
  const out = await s.fire('fetch', { request: new Request(BASE + 'supabase/members.sql') });
  ok('서버 설정 복사 페이지와 다른 사이트 주소는 건드리지 않음', out === undefined && (await s.fire('fetch', { request: new Request('https://nagicayumoqssqeozmze.supabase.co/rest/v1/posts') })) === undefined);
  // 보관 목록에 없는 파일이 하나라도 있으면 설치가 통째로 실패한다는 것(그래서 위의 '파일이 모두 있음' 점검이 중요함)
  const bad = make(); const brokenSw = sw.replace("'img/cross.jpg',", "'img/cross.jpg', 'icons/icon-192.png',");
  const e2 = { handlers: {} };
  vm.runInNewContext(brokenSw, { self: { addEventListener: (t, f) => { e2.handlers[t] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} }, location: new URL(BASE + 'sw.js') }, caches: bad.caches, fetch: bad.fetch, Request: class extends Request { constructor(u, init) { super(typeof u === 'string' ? new URL(u, BASE) : u, init); } }, Response, URL, Promise, console });
  let threw = false; let pr; e2.handlers.install({ waitUntil: (x) => { pr = x; } }); try { await pr; } catch (err) { threw = true; }
  ok('지운 파일 이름이 목록에 남아 있으면 설치가 실패함 (점검이 실제로 잡아 냄)', threw);

  // ── 3. 글꼴 보관 ─────────────────────────────────────────────────
  console.log('\n[3] 글꼴 보관');
  const FONTS = (sw.match(/const FONTS = '([^']+)'/) || [])[1];
  const fontCss = 'fonts/pretendard.css';
  const chunk = 'fonts/pretendard/' + fs.readdirSync(path.join(root, 'fonts/pretendard')).filter((n) => /\.woff2$/.test(n)).sort()[0];
  const chunk2 = 'fonts/gowun-batang/' + fs.readdirSync(path.join(root, 'fonts/gowun-batang')).filter((n) => /\.woff2$/.test(n)).sort()[0];
  ok('글꼴은 설치할 때 미리 받지 않음 (쓰는 디자인에서, 화면에 나온 글자 묶음만 받음)', shell.every((f) => !f.startsWith('fonts/')) && !!FONTS && FONTS.startsWith('chanyang-') && FONTS !== 'chanyang-' + ver, FONTS);
  s = make(); await s.fire('install'); await s.fire('activate');
  const getRes = async (rel) => { s.net.length = 0; return s.fire('fetch', { request: new Request(BASE + rel) }); };
  ok('글꼴 목록 파일: 처음에는 서버에서 받고 글꼴 보관함에 넣음', (await get(fontCss)) === 'net:' + fontCss && s.net.length === 1 && s.stores[FONTS].has(BASE + fontCss) && !s.stores['chanyang-' + ver].has(BASE + fontCss), JSON.stringify(s.net));
  ok('글자 묶음 파일도 처음 한 번만 서버에서 받음', (await get(chunk)) === 'net:' + chunk && s.net.length === 1 && (await get(chunk)) === 'net:' + chunk && s.net.length === 0 && s.stores[FONTS].has(BASE + chunk), chunk);
  s.body[fontCss] = '바뀐 글꼴 목록';
  ok('한 번 받은 글꼴은 다시 받지 않고 바로 씀', (await get(fontCss)) === 'net:' + fontCss && s.net.length === 0, JSON.stringify(s.net));
  s.offline = true;
  ok('인터넷이 끊겨도 받아 둔 글꼴은 나옴', (await get(fontCss)) === 'net:' + fontCss && (await get(chunk)) === 'net:' + chunk);
  let fontErr = null, fontOut; try { fontOut = await get(chunk2); } catch (err) { fontErr = err; }
  ok('인터넷이 끊겼고 받아 둔 적 없는 글꼴은 실패로 끝남 (엉뚱한 화면 파일을 글꼴 대신 주지 않음)', fontErr !== null && fontOut === undefined, String(fontOut).slice(0, 40));
  s.offline = false;
  const miss = await getRes('fonts/pretendard/없는파일.woff2');
  ok('서버에 없는 글꼴 주소는 보관하지 않음', miss.status === 404 && !s.stores[FONTS].has(BASE + encodeURI('fonts/pretendard/없는파일.woff2')) && s.stores[FONTS].size === 2, s.stores[FONTS].size);
  // 앱 버전이 올라가는 경우: 글꼴 보관함은 남고, 예전 앱 보관분과 예전 글꼴 보관함만 지워짐
  const nextSw = sw.replace("const VERSION = '" + ver + "'", "const VERSION = 'v999'");
  const fontsBefore = s.stores[FONTS];
  s.stores['chanyang-fonts-0'] = new Map([[BASE + 'fonts/old.woff2', new Response('old')]]);
  s.handlers = {};
  vm.runInNewContext(nextSw, { self: { addEventListener: (t, f) => { s.handlers[t] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} }, location: new URL(BASE + 'sw.js') }, caches: s.caches, fetch: s.fetch, Request: class extends Request { constructor(u, init) { super(typeof u === 'string' ? new URL(u, BASE) : u, init); } }, Response, URL, Promise, console });
  await s.fire('install'); await s.fire('activate');
  ok('앱 버전이 올라가도 글꼴 보관함은 그대로 남음', Object.keys(s.stores).sort().join() === [FONTS, 'chanyang-v999'].sort().join() && s.stores[FONTS] === fontsBefore && s.stores[FONTS].size === 2, Object.keys(s.stores).join());
  ok('새 버전에서도 글꼴을 다시 받지 않음', (await get(fontCss)) === 'net:' + fontCss && s.net.length === 0 && (await get(chunk)) === 'net:' + chunk && s.net.length === 0, JSON.stringify(s.net));
  ok('새 버전에서도 화면 파일은 새 내용을 먼저 받음 (글꼴 규칙이 다른 파일에 번지지 않음)', (await get('app.css')) === 'net:app.css' && s.net.length === 1 && (await get('index.html')) === 'net:index.html' && s.net.length === 1 && !s.stores[FONTS].has(BASE + 'app.css'));
  // 글꼴 파일의 무게: 한 디자인에서 실제로 받게 되는 양을 가늠해 둔다
  const sizeOf = (dir) => fs.readdirSync(path.join(root, dir)).filter((n) => /\.woff2$/.test(n)).map((n) => fs.statSync(path.join(root, dir, n)).size);
  const pre = sizeOf('fonts/pretendard'), gow = sizeOf('fonts/gowun-batang');
  const mb = (a) => (a.reduce((x, y) => x + y, 0) / 1048576).toFixed(1);
  console.log(`     Pretendard ${pre.length}개 ${mb(pre)}MB (가장 큰 묶음 ${(Math.max(...pre) / 1024).toFixed(0)}KB), 고운바탕 ${gow.length}개 ${mb(gow)}MB (가장 큰 묶음 ${(Math.max(...gow) / 1024).toFixed(0)}KB)`);
  ok('글자 묶음 하나하나가 작음 (가장 큰 것도 200KB 이하)', Math.max(...pre) <= 200 * 1024 && Math.max(...gow) <= 200 * 1024);

  console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
