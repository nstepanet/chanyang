/* 서버와 통신하는 부분은 모두 이 파일에 모여 있습니다.
 *
 * 앱의 나머지(app.js)는 window.Server 의 함수만 사용합니다.
 * 나중에 서버를 다른 것으로 바꾸면 이 파일만 새 서버에 맞게 다시 쓰면 됩니다.
 *
 * 모든 함수는 Promise 를 돌려주고, 실패하면 e.code 에 아래 중 하나가 들어 있습니다.
 *   'network'   인터넷 연결 또는 서버 응답 없음
 *   'bad_login' 이메일이나 비밀번호가 틀림
 *   'not_admin' 로그인은 됐지만 관리자로 등록되지 않은 계정
 *   'unconfirmed' 이메일 확인이 끝나지 않은 계정
 *   'forbidden' 권한 없음 (로그인이 풀렸거나 관리자가 아님)
 *   'not_ready' 서버에 표나 함수가 아직 만들어지지 않음 (supabase/ 의 설정을 실행하기 전)
 *   'setup'     서버 설정에서 "새 계정 가입"이나 "익명 로그인"이 꺼져 있어 휴대폰 승인을 진행할 수 없음
 *   'too_many'  요청이 너무 많아 서버가 잠시 막음
 *   'server'    그 밖의 서버 오류
 */
(function () {
  'use strict';

  var cfg = window.CHANYANG_CONFIG || {};
  var BUCKET = 'post-images';
  var POST_FIELDS = 'id,kind,title,body,meta,images,created_at';
  var SIGN_SECONDS = 3600;          // 사진 주소가 살아 있는 시간
  var GUEST_KEY = 'chanyang.guest'; // 관리자로 로그인해 있는 동안, 이 휴대폰이 받아 둔 승인을 보관하는 자리
  var client = null;
  var gateReady = null;             // 서버에 성도 승인 기능이 있는지: null 아직 모름 · true 있음 · false 없음(1단계 설정만 된 서버)
  var selfSignOut = 0;              // 이 파일이 스스로 로그아웃시키는 중이면 0 보다 큼

  function configured() {
    return !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase && window.supabase.createClient);
  }

  function db() {
    if (!client) {
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'chanyang.auth' }
      });
    }
    return client;
  }

  function fail(code, detail) {
    var e = new Error(code);
    e.code = code;
    e.detail = detail || '';
    return e;
  }

  // 서버가 준 오류를 위의 몇 가지 가운데 하나로 정리합니다.
  function toErr(raw, where) {
    if (raw && raw.code && /^(network|bad_login|unconfirmed|not_admin|forbidden|not_ready|setup|too_many|server)$/.test(raw.code)) { return raw; }
    var msg = String((raw && (raw.message || raw.msg || raw.error_description)) || raw || '');
    var code = String((raw && raw.code) || '');
    var status = Number((raw && (raw.status || raw.statusCode)) || 0);
    var name = String((raw && raw.name) || '');
    if (/failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg) || name === 'AuthRetryableFetchError' || name === 'StorageUnknownError' || status === 0 && /TypeError|FetchError/.test(msg + name)) {
      return fail('network', msg);
    }
    if (where === 'login') {
      if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) { return fail('unconfirmed', msg); }
      if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg) || status === 400) { return fail('bad_login', msg); }
    }
    if (status === 429 || code === 'over_request_rate_limit' || /rate limit/i.test(msg)) { return fail('too_many', msg); }
    if (where === 'guest') {
      // 휴대폰에 이름표를 붙이는 단계: 서버 설정에서 가입이나 익명 로그인이 꺼져 있으면 여기서 막힙니다.
      if (/anonymous_provider_disabled|signup_disabled|captcha_failed/.test(code) || /anonymous sign-ins are disabled|signups not allowed/i.test(msg) || status === 422) {
        return fail('setup', msg);
      }
    }
    // 표나 함수가 아직 없을 때 (설정 SQL 을 실행하기 전)
    if (code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883' || /could not find the (table|function)|does not exist/i.test(msg)) {
      return fail('not_ready', msg);
    }
    if (code === '42501' || code === 'PGRST301' || status === 401 || status === 403 || /row-level security|permission denied|unauthorized|jwt/i.test(msg)) {
      return fail('forbidden', msg);
    }
    return fail('server', msg || code || String(status));
  }

  // supabase-js 는 실패해도 예외 대신 { error } 를 돌려주므로 한 곳에서 풀어 줍니다.
  function unwrap(thenable, where) {
    return Promise.resolve(thenable).then(function (r) {
      if (r && r.error) { throw toErr(r.error, where); }
      return r ? r.data : null;
    }, function (e) { throw toErr(e, where); });
  }

  function newId() {
    if (window.crypto && window.crypto.randomUUID) { return window.crypto.randomUUID(); }
    var b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // ---------- 글 ----------
  function listPosts(limit) {
    return unwrap(
      db().from('posts').select(POST_FIELDS).order('created_at', { ascending: false }).limit(limit || 300)
    ).then(function (rows) { return rows || []; });
  }

  // 공개 주소. 성도 승인(2단계 설정)을 쓰기 전의 서버에서만 열립니다.
  function imageUrl(path) {
    return db().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  // 사진 경로 목록 → { 경로: 볼 수 있는 주소 }.
  // 성도 승인을 쓰는 서버에서는 볼 권한이 있는 휴대폰에만 한 시간짜리 주소를 내어 줍니다.
  function imageUrls(paths) {
    var list = (paths || []).filter(Boolean);
    if (!list.length) { return Promise.resolve({}); }
    var known = gateReady === null ? gate() : Promise.resolve();
    return known.then(function () {
      var out = {};
      if (gateReady === false) {
        list.forEach(function (p) { out[p] = imageUrl(p); });
        return out;
      }
      return unwrap(db().storage.from(BUCKET).createSignedUrls(list, SIGN_SECONDS)).then(function (rows) {
        (rows || []).forEach(function (it) {
          if (it && it.path && it.signedUrl && !it.error) { out[it.path] = it.signedUrl; }
        });
        return out;
      });
    });
  }

  // input: { kind, title, body, meta }, blobs: 줄여 둔 사진(JPEG) 목록, onStep(몇 번째, 전체)
  function createPost(input, blobs, onStep) {
    var id = newId();
    var paths = [];
    var chain = Promise.resolve();
    (blobs || []).forEach(function (blob, i) {
      chain = chain.then(function () {
        if (onStep) { onStep(i + 1, blobs.length); }
        var path = id + '/' + (i + 1) + '.jpg';
        return unwrap(
          db().storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
        ).then(function () { paths.push(path); });
      });
    });
    return chain.then(function () {
      return unwrap(db().from('posts').insert({
        id: id, kind: input.kind, title: input.title, body: input.body || '', meta: input.meta || null, images: paths
      }));
    }).then(function () { return id; }, function (e) {
      // 글 저장까지 가지 못했으면 먼저 올라간 사진을 치워 둡니다.
      if (!paths.length) { throw e; }
      return Promise.resolve(db().storage.from(BUCKET).remove(paths)).then(function () { throw e; }, function () { throw e; });
    });
  }

  function deletePost(post) {
    return unwrap(db().from('posts').delete().eq('id', post.id).select('id')).then(function (rows) {
      if (!rows || !rows.length) { throw fail('forbidden', '지워진 글이 없습니다'); }
      var paths = post.images || [];
      if (!paths.length) { return; }
      // 사진 지우기는 실패해도 글 삭제는 끝난 것으로 봅니다.
      return Promise.resolve(db().storage.from(BUCKET).remove(paths)).then(function () {}, function () {});
    });
  }

  // ---------- 성도 승인 ----------
  // 승인제가 켜져 있는지, 이 휴대폰이 승인됐는지 묻습니다.
  // { ready, membersOnly, admin, member, name }. ready 가 false 면 2단계 설정을 하기 전의 서버입니다(누구나 볼 수 있음).
  function gate() {
    return unwrap(db().rpc('gate_status')).then(function (g) {
      gateReady = true;
      g = g || {};
      return { ready: true, membersOnly: g.members_only === true, admin: g.admin === true, member: g.member === true, name: g.name || '' };
    }, function (e) {
      if (e.code === 'not_ready') {
        gateReady = false;
        return { ready: false, membersOnly: false, admin: false, member: false, name: '' };
      }
      throw e;
    });
  }

  // 이 파일이 스스로 로그아웃시킬 때는 "로그인이 풀렸다"는 알림을 보내지 않습니다.
  function quietSignOut() {
    selfSignOut++;
    function done() { setTimeout(function () { selfSignOut--; }, 0); }
    return Promise.resolve(db().auth.signOut({ scope: 'local' })).then(done, done);
  }

  // 승인번호를 입력하려면 서버가 이 휴대폰을 알아볼 이름표(임시 계정)가 필요합니다. 없으면 받아 옵니다.
  function guestSession() {
    return unwrap(db().auth.getSession()).then(function (d) {
      if (d && d.session) { return d.session; }
      return unwrap(db().auth.signInAnonymously(), 'guest').then(function (x) {
        if (!x || !x.session) { throw fail('setup', 'no session'); }
        return x.session;
      });
    });
  }

  // 승인번호 입력. { ok: true, name } 또는 { ok: false, reason, left, minutes }
  // reason: wrong(틀림) · expired(기한 지남) · locked(여러 번 틀려 잠김) · busy(잠시 닫힘) · format(자릿수)
  function redeem(code) {
    function attempt(canRetry) {
      return guestSession().then(function () {
        return unwrap(db().rpc('redeem_code', { code: String(code || '') }));
      }).then(function (r) {
        if (r && r.reason === 'no_session' && canRetry) { return quietSignOut().then(function () { return attempt(false); }); }
        if (!r || r.reason === 'no_session') { throw fail('server', 'no session'); }
        return r;
      }, function (e) {
        // 예전에 받아 둔 이름표가 더는 통하지 않을 때: 새로 받아 한 번만 다시 해 봅니다.
        if (e.code === 'forbidden' && canRetry) { return quietSignOut().then(function () { return attempt(false); }); }
        throw e;
      });
    }
    return attempt(true);
  }

  // ---------- 관리자 ----------
  function checkAdmin() {
    return unwrap(db().rpc('is_admin')).then(function (v) { return v === true; });
  }

  // 로그인되어 있고 관리자이면 { email }, 아니면 null
  function currentAdmin() {
    return unwrap(db().auth.getSession()).then(function (d) {
      var s = d && d.session;
      if (!s || !s.user || s.user.is_anonymous) { return null; }
      return checkAdmin().then(function (yes) { return yes ? { email: s.user.email } : null; });
    });
  }

  function readGuest() {
    try { return JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); } catch (e) { return null; }
  }
  function dropGuest() {
    try { localStorage.removeItem(GUEST_KEY); } catch (e) { /* 무시 */ }
  }
  // 관리자로 로그인하기 전에 이 휴대폰이 승인받은 상태였다면, 로그아웃할 때 그 승인을 되살립니다.
  function restoreGuest() {
    var g = readGuest();
    dropGuest();
    if (!g || !g.access_token || !g.refresh_token) { return Promise.resolve(false); }
    return Promise.resolve(db().auth.setSession({ access_token: g.access_token, refresh_token: g.refresh_token }))
      .then(function (r) { return !(r && r.error); }, function () { return false; });
  }
  function leave() {
    return quietSignOut().then(restoreGuest);
  }

  function signIn(email, password) {
    return unwrap(db().auth.getSession()).then(function (d) {
      var s = d && d.session;
      if (s && s.user && s.user.is_anonymous && s.access_token && s.refresh_token) {
        try { localStorage.setItem(GUEST_KEY, JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token })); } catch (e) { /* 무시 */ }
      } else {
        dropGuest();
      }
      return unwrap(db().auth.signInWithPassword({ email: email, password: password }), 'login');
    }).then(function (d) {
      return checkAdmin().then(function (yes) {
        if (yes) { return { email: d.user.email }; }
        return leave().then(function () { throw fail('not_admin'); });
      }, function (e) {
        return leave().then(function () { throw e; });
      });
    }, function (e) {
      dropGuest();   // 로그인이 되지 않았으므로 원래 상태 그대로입니다.
      throw e;
    });
  }

  function signOut() {
    return leave().then(function () {}, function () {});
  }

  // 로그인이 풀리면(만료·서버에서 취소) 알려 줍니다.
  function onSignedOut(callback) {
    db().auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT' && !selfSignOut) { setTimeout(callback, 0); }
    });
  }

  // 명단: [{ id, name, state, created_at, approved_at, code_expires_at, code_waiting }]
  // state: approved(승인) · waiting(승인번호 입력 대기) · expired(기한 지남)
  function listMembers() {
    return unwrap(db().rpc('admin_members')).then(function (rows) { return rows || []; });
  }

  // 승인번호 만들기. id 가 있으면 그 사람에게 새 번호를, 없으면 name 으로 새 사람을 넣습니다.
  // { id, name, code, expires_at } — 승인번호는 이때 한 번만 받을 수 있습니다.
  function issueCode(name, id) {
    return unwrap(db().rpc('admin_issue_code', id ? { member_id: id } : { member_name: name }));
  }

  function removeMember(id) {
    return unwrap(db().rpc('admin_remove_member', { member_id: id }));
  }

  // 승인번호를 넣다 만 임시 계정을 치웁니다. 실패해도 괜찮은 일입니다.
  function cleanup() {
    return unwrap(db().rpc('admin_cleanup')).then(function () {}, function () {});
  }

  // ---------- 화면 디자인 ----------
  // 교회가 정한 화면 디자인을 묻습니다. { ready, theme }
  // theme: 'bright'(밝은 화면) · 'warm'(따뜻한 화면) · 'classic'(클래식 화면). 모르는 값이면 ''.
  // ready 가 false 면 3단계 설정을 하기 전의 서버입니다(앱은 처음 값으로 보입니다).
  function theme() {
    return unwrap(db().rpc('app_theme')).then(function (t) {
      return { ready: true, theme: /^(bright|warm|classic)$/.test(String(t || '')) ? t : '' };
    }, function (e) {
      if (e.code === 'not_ready') { return { ready: false, theme: '' }; }
      throw e;
    });
  }

  // 관리자가 화면 디자인을 바꿉니다. 성도 모두의 휴대폰에 적용됩니다. 바뀐 값을 돌려줍니다.
  function setTheme(name) {
    return unwrap(db().rpc('admin_set_theme', { new_theme: String(name || '') })).then(function (t) { return t || name; });
  }

  // ---------- 백업 ----------
  function exportAll() {
    return listPosts(5000).then(function (rows) {
      var out = {
        app: 'chanyang', exportedAt: new Date().toISOString(),
        imageBucket: BUCKET, imagesPrivate: gateReady === true,
        imageBase: cfg.supabaseUrl + '/storage/v1/object/public/' + BUCKET + '/',
        posts: rows
      };
      if (gateReady !== true) { return out; }
      return listMembers().then(function (m) { out.members = m; return out; }, function () { return out; });
    });
  }

  window.Server = {
    configured: configured,
    listPosts: listPosts,
    imageUrl: imageUrl,
    imageUrls: imageUrls,
    createPost: createPost,
    deletePost: deletePost,
    gate: gate,
    redeem: redeem,
    currentAdmin: currentAdmin,
    signIn: signIn,
    signOut: signOut,
    onSignedOut: onSignedOut,
    listMembers: listMembers,
    issueCode: issueCode,
    removeMember: removeMember,
    cleanup: cleanup,
    theme: theme,
    setTheme: setTheme,
    exportAll: exportAll
  };
})();
