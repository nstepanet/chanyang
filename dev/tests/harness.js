// 실제 Supabase 브라우저 라이브러리 + 가짜 서버(fetch)로 앱 전체를 돌려 보는 점검 도구
const { JSDOM } = require('jsdom'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const root = path.resolve(__dirname, '..', '..');   // 저장소 맨 위 (앱 파일이 있는 곳)
// 서버 주소와 공개용 키는 앱이 쓰는 config.js 에서 읽습니다. (서버를 옮겨도 검사를 고칠 필요가 없도록)
const config = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const SB = (config.match(/supabaseUrl:\s*'([^']*)'/) || [])[1];
const KEY = (config.match(/supabaseKey:\s*'([^']*)'/) || [])[1];
if (!SB || !KEY) { throw new Error('config.js 에 서버 주소(supabaseUrl)와 공개용 키(supabaseKey)가 있어야 검사를 돌릴 수 있습니다.'); }
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, ms = 3000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch (e) {} await sleep(15); } console.log('   (시간 초과: ' + label + ')'); return false; }

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log((cond ? '  ok  ' : ' FAIL ') + name + (extra !== undefined && (!cond || process.env.V) ? '  → ' + extra : '')); };
const result = () => { console.log(`\n결과: ${pass} 통과, ${fail} 실패`); return fail; };

function makeBackend() {
  const be = {
    offline: false, noTables: false, log: [], objects: {}, tokens: {}, seq: 0,
    gate: null,                         // null: 2단계(성도 승인) 설정 전의 서버 · { membersOnly: true|false }: 설정 후
    anon: { enabled: true, signups: true, limited: false },   // Supabase 대시보드의 익명 로그인·가입 허용 설정
    members: [], attempts: {}, busy: false, codeSeq: 0, ghosts: new Set(),   // ghosts: 서버에서 지워진 임시 계정
    theme: null,                        // null: 3단계(화면 디자인) 설정 전의 서버 · 'bright' | 'warm' | 'classic': 설정 후 교회가 정한 디자인
    users: [
      { id: '11111111-1111-1111-1111-111111111111', email: 'admin@church.kr', password: 'pw-ok', admin: true },
      { id: '22222222-2222-2222-2222-222222222222', email: 'member@x.com', password: 'pw-ok', admin: false }
    ],
    posts: [
      { id: 'a1', kind: 'news', title: '찬양하는교회 앱이 준비되었습니다', body: '안내', meta: null, images: [], created_at: '2026-11-17T00:00:00+00:00' },
      { id: 'a2', kind: 'event', title: '성탄감사예배', body: '시간은 추후 안내드립니다.', meta: '2026년 12월 25일 (금)', images: [], created_at: '2026-11-17T00:01:00+00:00' },
      { id: 'a3', kind: 'event', title: '송구영신예배', body: '시간은 추후 안내드립니다.', meta: '2026년 12월 31일 (목)', images: [], created_at: '2026-11-17T00:02:00+00:00' }
    ]
  };
  const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' } });
  const userJson = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email || '', email_confirmed_at: u.anonymous ? null : '2026-11-18T00:00:00Z', is_anonymous: !!u.anonymous, app_metadata: u.anonymous ? {} : { provider: 'email' }, user_metadata: {}, created_at: '2026-11-18T00:00:00Z' });
  const session = (u) => {
    const now = Math.floor(Date.now() / 1000);
    const token = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ sub: u.id, email: u.email || '', role: 'authenticated', aud: 'authenticated', is_anonymous: !!u.anonymous, iat: now, exp: now + 3600, n: ++be.seq }) + '.c2ln';
    be.tokens[token] = u;
    return { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r-' + be.seq, user: userJson(u) };
  };
  const noFn = (name) => json(404, { code: 'PGRST202', details: null, hint: null, message: `Could not find the function public.${name} without parameters in the schema cache` });
  const denied = (user, what) => json(user ? 403 : 401, { code: '42501', details: null, hint: null, message: 'permission denied for ' + what });
  const memberRow = (m) => {
    const waiting = !!m.code && !m.expired;
    return { id: m.id, name: m.name, state: m.userId ? 'approved' : waiting ? 'waiting' : 'expired', created_at: m.createdAt, approved_at: m.approvedAt || null, code_expires_at: m.code ? m.expiresAt : null, code_waiting: waiting };
  };
  // 시험에서 서버 쪽 일을 흉내 낼 때 쓰는 도우미
  be.issue = (name) => { const m = { id: crypto.randomUUID(), name, code: String(10000000 + (++be.codeSeq) * 1234567).slice(0, 8), expired: false, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), createdAt: new Date(Date.now() + be.codeSeq).toISOString(), userId: null, approvedAt: null }; be.members.push(m); return m; };

  be.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, 'https://nstepanet.github.io/chanyang/');
    const method = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : {}) || {});
    if (url.origin !== SB) {                                   // 앱 자체 파일 (data/…)
      const f = path.join(root, url.pathname.replace(/^\/chanyang\//, ''));
      if (!fs.existsSync(f)) return new Response('', { status: 404 });
      return new Response(fs.readFileSync(f, 'utf8'), { status: 200 });
    }
    be.log.push(method + ' ' + url.pathname + (url.searchParams.get('grant_type') ? '?grant_type=' + url.searchParams.get('grant_type') : ''));
    if (be.offline) throw new TypeError('Failed to fetch');
    if (headers.get('apikey') !== KEY) return json(401, { message: 'Invalid API key' });
    const bearer = (headers.get('authorization') || '').replace(/^Bearer /i, '');
    const user = be.tokens[bearer] || null;
    const isAdmin = !!(user && user.admin);
    const isMember = !!(user && be.members.some((m) => m.userId === user.id));
    const canRead = !be.gate || !be.gate.membersOnly || isAdmin || isMember;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    const p = url.pathname;

    if (p === '/rest/v1/posts') {
      if (be.noTables) return json(404, { code: 'PGRST205', details: null, hint: null, message: "Could not find the table 'public.posts' in the schema cache" });
      if (method === 'GET') {
        if (!canRead) return json(200, []);                    // 읽기 규칙에 걸리면 오류가 아니라 빈 목록이 옵니다
        const rows = be.posts.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, Number(url.searchParams.get('limit') || 1000));
        return json(200, rows);
      }
      if (method === 'POST') {
        if (!user) return json(401, { code: '42501', details: null, hint: null, message: 'permission denied for table posts' });
        if (!isAdmin) return json(403, { code: '42501', details: null, hint: null, message: 'new row violates row-level security policy for table "posts"' });
        be.posts.push(Object.assign({ meta: null, images: [], body: '' }, body, { created_at: new Date().toISOString(), created_by: user.id }));
        return json(201);
      }
      if (method === 'DELETE') {
        const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
        if (!isAdmin) return json(200, []);
        const hit = be.posts.filter((x) => x.id === id);
        be.posts = be.posts.filter((x) => x.id !== id);
        return json(200, hit.map((x) => ({ id: x.id })));
      }
    }
    if (p === '/rest/v1/rpc/is_admin') {
      if (be.noTables) return noFn('is_admin');
      return json(200, isAdmin);
    }

    // ── 성도 승인 (2단계 설정) ──
    if (p.startsWith('/rest/v1/rpc/') && /^(gate_status|redeem_code|admin_members|admin_issue_code|admin_remove_member|admin_cleanup)$/.test(p.slice(13))) {
      const fn = p.slice(13);
      if (be.noTables || !be.gate) return noFn(fn);
      if (fn === 'gate_status') {
        const mine = user && be.members.find((m) => m.userId === user.id);
        return json(200, { members_only: !!be.gate.membersOnly, admin: isAdmin, member: isMember, name: mine ? mine.name : null });
      }
      if (fn === 'redeem_code') {
        if (!user) return denied(user, 'function redeem_code');
        if (be.ghosts.has(user.id)) return json(200, { ok: false, reason: 'no_session' });
        const mine = be.members.find((m) => m.userId === user.id);
        if (mine) return json(200, { ok: true, name: mine.name, already: true });
        const digits = String(body.code || '').replace(/\D/g, '');
        if (digits.length !== 8) return json(200, { ok: false, reason: 'format' });
        const fails = be.attempts[user.id] || 0;
        if (fails >= 5) return json(200, { ok: false, reason: 'locked', minutes: 57 });
        if (be.busy) return json(200, { ok: false, reason: 'busy' });
        const m = be.members.find((x) => x.code === digits);
        if (!m || m.expired) { be.attempts[user.id] = fails + 1; return json(200, { ok: false, reason: m ? 'expired' : 'wrong', left: Math.max(0, 4 - fails) }); }
        m.userId = user.id; m.code = null; m.approvedAt = new Date().toISOString(); delete be.attempts[user.id];
        return json(200, { ok: true, name: m.name });
      }
      if (!isAdmin) return denied(user, 'function ' + fn);       // 서버에서는 forbidden(42501) 예외
      if (fn === 'admin_members') return json(200, be.members.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(memberRow));
      if (fn === 'admin_issue_code') {
        let m;
        if (body.member_id) {
          m = be.members.find((x) => x.id === body.member_id);
          if (!m) return json(400, { code: 'P0002', details: null, hint: null, message: 'not_found' });
          m.code = String(10000000 + (++be.codeSeq) * 1234567).slice(0, 8); m.expired = false; m.expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
        } else {
          const nm = String(body.member_name || '').trim();
          if (!nm || nm.length > 40) return json(400, { code: '22023', details: null, hint: null, message: 'bad_name' });
          m = be.issue(nm);
        }
        return json(200, { id: m.id, name: m.name, code: m.code, expires_at: m.expiresAt });
      }
      if (fn === 'admin_remove_member') {
        const had = be.members.some((x) => x.id === body.member_id);
        be.members = be.members.filter((x) => x.id !== body.member_id);
        return json(200, had);
      }
      if (fn === 'admin_cleanup') return json(200, 0);
    }

    // ── 화면 디자인 (3단계 설정) ──
    if (p === '/rest/v1/rpc/app_theme' || p === '/rest/v1/rpc/admin_set_theme') {
      const fn = p.slice(13);
      if (be.noTables || be.theme === null) return noFn(fn);
      if (fn === 'app_theme' && be.themeHangs) return new Promise(() => {});   // 답이 끝내 오지 않는 연결
      if (fn === 'app_theme' && be.themeHold) { const then = be.theme; return new Promise((res) => be.themeHold.push(() => res(json(200, then)))); }   // 물은 때의 값을 붙잡아 두었다가 나중에 보냄
      if (fn === 'app_theme') return json(200, be.theme);
      if (!isAdmin) return denied(user, 'function admin_set_theme');
      if (be.themeFails) return json(500, { code: 'XX000', details: null, hint: null, message: 'internal error' });
      if (!/^(bright|warm|classic)$/.test(String(body.new_theme))) return json(400, { code: '22023', details: null, hint: null, message: 'unknown theme' });
      be.theme = body.new_theme;
      return json(200, be.theme);
    }

    // ── 로그인 ──
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const u = be.users.find((x) => x.email === body.email && x.password === body.password);
      return u ? json(200, session(u)) : json(400, { code: 'invalid_credentials', message: 'Invalid login credentials' });
    }
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') return json(400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token' });
    if (p === '/auth/v1/signup' && method === 'POST') {            // 휴대폰 이름표(익명 로그인)
      if (!be.anon.enabled) return json(422, { code: 'anonymous_provider_disabled', message: 'Anonymous sign-ins are disabled' });
      if (!be.anon.signups) return json(422, { code: 'signup_disabled', message: 'Signups not allowed for this instance' });
      if (be.anon.limited) return json(429, { code: 'over_request_rate_limit', message: 'Request rate limit reached' });
      const u = { id: crypto.randomUUID(), email: '', anonymous: true, admin: false };
      be.users.push(u);
      return json(200, session(u));
    }
    if (p === '/auth/v1/logout') { delete be.tokens[bearer]; return new Response(null, { status: 204 }); }
    if (p === '/auth/v1/user') return user ? json(200, userJson(user)) : json(401, { code: 'no_authorization', message: 'no auth' });

    // ── 사진 ──
    if (p === '/storage/v1/object/sign/post-images' && method === 'POST') {
      return json(200, (body.paths || []).map((k) => (canRead && be.objects[k])
        ? { error: null, path: k, signedURL: '/object/sign/post-images/' + k + '?token=signed-' + (++be.seq) }
        : { error: 'Either the object does not exist or you do not have access to it', path: k, signedURL: null }));
    }
    if (p.startsWith('/storage/v1/object/post-images/') && method === 'POST') {
      const key = decodeURIComponent(p.slice('/storage/v1/object/post-images/'.length));
      if (!isAdmin) return json(400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      let type = headers.get('content-type'), cache = headers.get('cache-control'), form = false;
      if (body && typeof body.get === 'function') { const f = body.get(''); form = true; type = f && f.type; cache = body.get('cacheControl'); }
      be.objects[key] = { type, cache, form };
      return json(200, { Id: 'obj-' + key, Key: 'post-images/' + key });
    }
    if (p === '/storage/v1/object/post-images' && method === 'DELETE') {
      if (!isAdmin) return json(200, []);
      (body.prefixes || []).forEach((k) => delete be.objects[k]);
      return json(200, (body.prefixes || []).map((name) => ({ name })));
    }
    return json(500, { message: 'unhandled ' + method + ' ' + p });
  };
  return be;
}

// opts: storage(저장된 값), noServer, ua(브라우저 종류 문자열), navStandalone(아이폰 홈 화면 앱 여부), displayStandalone(설치된 앱으로 열림)
function boot(be, { storage, noServer, ua, navStandalone, displayStandalone, touch } = {}) {
  const html = fs.readFileSync(root + '/index.html', 'utf8').replace(/<script src="[^"]+"><\/script>\n?/g, '');
  const dom = new JSDOM(html, { url: 'https://nstepanet.github.io/chanyang/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.assign(w, { fetch: be.fetch, Headers, Request, Response });
  w.matchMedia = (q) => ({ matches: !!displayStandalone && /standalone/.test(q) });
  if (ua) Object.defineProperty(w.navigator, 'userAgent', { value: ua, configurable: true });
  if (navStandalone !== undefined) Object.defineProperty(w.navigator, 'standalone', { value: navStandalone, configurable: true });
  if (touch) Object.defineProperty(w.navigator, 'maxTouchPoints', { value: touch, configurable: true });
  w.URL.createObjectURL = () => 'blob:fake'; w.URL.revokeObjectURL = () => {};
  w.__errors = []; w.addEventListener('error', (e) => w.__errors.push(e.message));
  w.addEventListener('unhandledrejection', (e) => w.__errors.push('unhandled: ' + (e.reason && e.reason.message)));
  if (storage) for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  w.eval(fs.readFileSync(root + '/vendor/supabase.js', 'utf8'));
  w.eval(noServer ? "window.CHANYANG_CONFIG = { supabaseUrl: '', supabaseKey: '' };" : fs.readFileSync(root + '/config.js', 'utf8'));
  w.eval(fs.readFileSync(root + '/server.js', 'utf8'));
  w.eval(fs.readFileSync(root + '/app.js', 'utf8'));
  const hooks = w.__chanyang.hooks;
  hooks.shrinkImage = (f) => Promise.resolve(new w.Blob(['jpeg:' + f.name], { type: 'image/jpeg' }));
  const opened = [], copied = [];
  hooks.openUrl = (u) => { opened.push(u); };
  hooks.copyText = (t) => { copied.push(t); return Promise.resolve(); };
  const d = w.document;
  const api = {
    w, d, S: w.__chanyang.state, opened, copied,
    $: (s) => d.querySelector(s), $$: (s) => [...d.querySelectorAll(s)],
    click: (s) => { const el = typeof s === 'string' ? d.querySelector(s) : s; if (!el) throw new Error('없는 요소: ' + s); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); },
    type: (s, v) => { const el = d.querySelector(s); if (!el) throw new Error('없는 입력칸: ' + s); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); },
    pick: (names) => { const el = d.querySelector('#pfiles'); Object.defineProperty(el, 'files', { value: names.map((n) => new w.File(['x'], n, { type: 'image/jpeg' })), configurable: true }); el.dispatchEvent(new w.Event('change', { bubbles: true })); },
    text: () => d.querySelector('#view').textContent.replace(/\s+/g, ' ').trim(),
    locked: () => d.querySelector('#app').classList.contains('locked'),
    sync: () => w.__chanyang.sync(),
    storage: () => { const o = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; }
  };
  return api;
}

module.exports = { makeBackend, boot, ok, result, waitFor, sleep, SB, root };
