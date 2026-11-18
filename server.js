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
 *   'not_ready' 서버에 표가 아직 만들어지지 않음 (supabase/setup.sql 을 실행하기 전)
 *   'server'    그 밖의 서버 오류
 */
(function () {
  'use strict';

  var cfg = window.CHANYANG_CONFIG || {};
  var BUCKET = 'post-images';
  var POST_FIELDS = 'id,kind,title,body,meta,images,created_at';
  var client = null;

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

  // 서버가 준 오류를 위의 다섯 가지 가운데 하나로 정리합니다.
  function toErr(raw, where) {
    if (raw && raw.code && /^(network|bad_login|unconfirmed|not_admin|forbidden|not_ready|server)$/.test(raw.code)) { return raw; }
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

  function imageUrl(path) {
    return db().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
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

  // ---------- 관리자 ----------
  function checkAdmin() {
    return unwrap(db().rpc('is_admin')).then(function (v) { return v === true; });
  }

  // 로그인되어 있고 관리자이면 { email }, 아니면 null
  function currentAdmin() {
    return unwrap(db().auth.getSession()).then(function (d) {
      var s = d && d.session;
      if (!s || !s.user) { return null; }
      return checkAdmin().then(function (yes) { return yes ? { email: s.user.email } : null; });
    });
  }

  function signIn(email, password) {
    return unwrap(db().auth.signInWithPassword({ email: email, password: password }), 'login').then(function (d) {
      return checkAdmin().then(function (yes) {
        if (yes) { return { email: d.user.email }; }
        return Promise.resolve(db().auth.signOut()).then(function () { throw fail('not_admin'); }, function () { throw fail('not_admin'); });
      });
    });
  }

  function signOut() {
    return Promise.resolve(db().auth.signOut()).then(function () {}, function () {});
  }

  // 로그인이 풀리면(만료·다른 탭에서 로그아웃) 알려 줍니다.
  function onSignedOut(callback) {
    db().auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') { setTimeout(callback, 0); }
    });
  }

  // ---------- 백업 ----------
  function exportAll() {
    return listPosts(5000).then(function (rows) {
      return { app: 'chanyang', exportedAt: new Date().toISOString(), imageBase: cfg.supabaseUrl + '/storage/v1/object/public/' + BUCKET + '/', posts: rows };
    });
  }

  window.Server = {
    configured: configured,
    listPosts: listPosts,
    imageUrl: imageUrl,
    createPost: createPost,
    deletePost: deletePost,
    currentAdmin: currentAdmin,
    signIn: signIn,
    signOut: signOut,
    onSignedOut: onSignedOut,
    exportAll: exportAll
  };
})();
