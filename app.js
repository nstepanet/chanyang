/* 찬양하는교회 웹앱
 *
 * 화면과 동작은 이 파일에, 서버와 통신하는 부분은 server.js 에 있습니다.
 * 고칠 일이 많은 값은 아래 SETTINGS 에 모아 두었습니다.
 * 예배 영상 목록은 data/videos.txt, 서버에 연결되지 않을 때 보여 줄 기본 글은 data/content.json 에 있습니다.
 */
(function () {
  'use strict';

  var SETTINGS = {
    qtUrl: 'https://www.duranno.com/qt/view2/bible.asp',
    mapUrl: 'https://place.map.kakao.com/858335183',
    routeUrl: 'https://map.kakao.com/link/to/858335183',
    verse: { text: '호흡이 있는 자마다 여호와를 찬양할찌어다 할렐루야', ref: '시편 150:6' },
    times: [
      ['주일예배', '주일 오전 11시'], ['수요예배', '오후 7시'], ['금요기도회', '오후 8시'],
      ['새벽기도회', '오전 5시 30분'], ['교회학교', '주일 오전 9시'], ['고등부', '주일 오전 9시 30분'],
      ['청년부', '주일 오후 1시']
    ],
    maxPhotos: 8,        // 글 하나에 붙일 수 있는 사진 수
    photoMaxSide: 2000,  // 올리기 전에 긴 변을 이 크기(픽셀)로 줄입니다
    photoQuality: 0.85
  };

  var Server = window.Server;
  var TYPE_NAMES = { A: '주일예배', B: '주일저녁예배', C: '금요심야기도회' };
  var KIND_NAMES = { news: '소식', bulletin: '주보', event: '일정' };
  var TITLES = {
    home: '찬양하는교회', sermons: '설교 · 예배 영상', sermon: '설교 보기', news: '소식 · 주보 · 일정',
    detail: '자세히 보기', prayer: '기도제목', more: '더보기', info: '예배 안내',
    login: '관리자 로그인', post: '글 올리기', noti: '새 소식',
    gate: '찬양하는교회', members: '성도 승인'
  };
  var ERROR_TEXT = {
    network: '서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
    bad_login: '이메일 또는 비밀번호가 맞지 않습니다.',
    unconfirmed: '이메일 확인이 끝나지 않은 계정입니다. 교회 앱 담당자에게 알려 주세요.',
    not_admin: '관리자로 등록되지 않은 계정입니다.',
    not_ready: '서버 설정이 아직 끝나지 않았습니다. 교회 앱 담당자에게 알려 주세요.',
    setup: '서버 설정이 아직 끝나지 않아 승인번호를 확인할 수 없습니다. 교회 앱 담당자에게 알려 주세요.',
    too_many: '요청이 많아 잠시 막혔습니다. 한 시간쯤 뒤에 다시 시도해 주세요.',
    forbidden: '권한이 없습니다. 로그아웃한 뒤 다시 로그인해 주세요.',
    image: '사진을 읽지 못했습니다. 다른 사진으로 다시 시도해 주세요.',
    server: '서버에서 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
  };
  var TABS = ['home', 'sermons', 'news', 'prayer', 'more'];
  var ROOTS = TABS.concat(['gate']);   // 뒤로 단추가 없는 화면
  var DAYS = '일월화수목금토';

  // ---------- 저장 (이 휴대폰 안에만 보관) ----------
  var store = {
    get: function (key, fallback) {
      try { var v = localStorage.getItem('chanyang.' + key); return v === null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem('chanyang.' + key, JSON.stringify(value)); } catch (e) { /* 저장 공간을 못 쓰는 환경 */ }
    },
    drop: function (key) {
      try { localStorage.removeItem('chanyang.' + key); } catch (e) { /* 무시 */ }
    }
  };
  // 서버 없이 쓰던 첫 버전의 흔적을 정리합니다.
  ['isAdmin', 'notis', 'unread'].forEach(store.drop);

  var serverOn = !!(Server && Server.configured());
  var NO_GATE = { ready: false, membersOnly: false, admin: false, member: false, name: '' };
  var savedGate = serverOn ? store.get('gate', null) : null;
  var state = {
    screen: 'home', tab: 'home', backTo: 'home',
    videos: [], posts: [], sharedPrayers: [],
    postsFrom: 'none',            // 'server' | 'cache' | 'file' | 'none'
    serverReady: true,            // 서버에 표가 아직 만들어지지 않았으면 false
    fType: 'all', fYear: 0, fMonth: 0,
    seg: 'news', sermonId: '', postId: '',
    loaded: false, loadError: false, flash: '', flashText: '',
    admin: null,                  // 관리자로 로그인되어 있으면 { email }
    draft: { kind: 'news', title: '', meta: '', body: '' },
    postFiles: [], busy: false, busyText: '', confirmDelete: '',
    lastSeen: Number(store.get('lastSeen', 0)) || 0,   // 마지막으로 '새 소식'을 확인한 시각(밀리초)
    notes: store.get('notes', {}),
    myPosts: store.get('myPosts', []),       // 첫 버전에서 이 휴대폰에만 써 둔 글
    myPrayers: store.get('myPrayers', []),
    prayed: store.get('prayed', {}),

    // 성도 승인
    gate: savedGate || NO_GATE,   // 서버에 마지막으로 확인한 상태: 승인제가 켜져 있는지, 이 휴대폰이 승인됐는지
    gateKnown: !serverOn || !!savedGate,   // 한 번이라도 확인한 적이 있는지 (없으면 확인될 때까지 내용을 보여 주지 않음)
    gateOffline: false,           // 방금 확인하려 했지만 서버에 닿지 못함
    gateForce: false,             // 다른 앱 안의 화면이지만 그래도 여기서 입력하겠다고 함
    code: '', gateMsg: '',        // 입력 중인 승인번호와 안내 문구
    members: null, membersError: '',   // 관리자 화면의 명단
    memberName: '', issued: null, confirmRemove: '',   // issued: 방금 만든 승인번호 { id, name, code, expires_at }
    imageUrls: {}, imageError: ''      // 사진 경로 → { url, at }
  };

  var $app = document.getElementById('app');
  var $view = document.getElementById('view');
  var $title = document.getElementById('title');
  var $back = document.getElementById('back');
  var $dot = document.getElementById('dot');
  var $bell = document.querySelector('#bar [data-screen="noti"]');
  var $banner = document.getElementById('banner');
  var installEvent = null;
  var bannerTimer = 0;
  var syncedAt = 0;
  var cleaned = false;

  var hooks = {
    // 사진을 올리기 전에 크기를 줄여 JPEG 로 바꿉니다.
    shrinkImage: function (file) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight;
          var s = Math.min(1, SETTINGS.photoMaxSide / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * s));
          c.height = Math.max(1, Math.round(h * s));
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          c.toBlob(function (blob) {
            if (blob) { resolve(blob); } else { reject(codeError('image')); }
          }, 'image/jpeg', SETTINGS.photoQuality);
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(codeError('image')); };
        img.src = url;
      });
    },
    // 어떤 기기·브라우저에서 열렸는지 (설치 안내와 승인번호 입력 화면이 여기에 맞춰 달라집니다)
    platform: function () {
      var ua = navigator.userAgent || '';
      var standalone = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
      var ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
      var kakao = /KAKAOTALK/i.test(ua);
      var inApp = !standalone && (kakao || /NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|Line\/|DaumApps|BAND\/|; wv\)/i.test(ua));
      return {
        standalone: standalone, ios: ios, android: /Android/i.test(ua), kakao: kakao, inApp: inApp,
        safari: ios && /Safari\//i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)
      };
    },
    // 문자 앱·다른 브라우저를 여는 주소로 이동
    openUrl: function (url) { window.location.href = url; },
    copyText: function (text) {
      function oldWay() {
        return new Promise(function (resolve, reject) {
          var box = document.createElement('textarea');
          box.value = text; box.setAttribute('readonly', '');
          box.style.position = 'fixed'; box.style.opacity = '0';
          document.body.appendChild(box); box.select();
          var done = false;
          try { done = document.execCommand('copy'); } catch (e) { done = false; }
          box.remove();
          if (done) { resolve(); } else { reject(codeError('copy')); }
        });
      }
      if (navigator.clipboard && navigator.clipboard.writeText) { return navigator.clipboard.writeText(text).catch(oldWay); }
      return oldWay();
    }
  };

  // ---------- 도우미 ----------
  function codeError(code) { var e = new Error(code); e.code = code; return e; }
  function errorText(e) { return ERROR_TEXT[(e && e.code) || 'server'] || ERROR_TEXT.server; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function parseVideos(raw) {
    var out = [];
    raw.trim().split(';').forEach(function (part) {
      var kv = part.split(':');
      if (kv.length !== 2 || !/^\d{6}$/.test(kv[0])) { return; }
      var y = 2000 + Number(kv[0].slice(0, 2)), m = Number(kv[0].slice(2, 4)), d = Number(kv[0].slice(4, 6));
      var wd = DAYS[new Date(y, m - 1, d).getDay()];
      var seen = {};
      kv[1].split(',').forEach(function (it) {
        var t = it[0];
        if (!TYPE_NAMES[t]) { return; }
        seen[t] = (seen[t] || 0) + 1;
        out.push({
          id: it.slice(1, 12), type: t, priv: it.length > 12, y: y, m: m, key: kv[0],
          title: TYPE_NAMES[t] + (seen[t] > 1 ? ' (' + seen[t] + ')' : ''),
          dateLabel: m + '월 ' + d + '일 (' + wd + ')',
          fullDate: y + '년 ' + m + '월 ' + d + '일 (' + wd + ')'
        });
      });
    });
    return out;
  }
  function todayLabel() {
    var n = new Date();
    return (n.getMonth() + 1) + '월 ' + n.getDate() + '일';
  }
  function dateLabel(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return ''; }
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }
  function dayLabel(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return ''; }
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }
  // 서버에서 받은 한 줄을 화면에서 쓰는 모양으로 바꿉니다.
  function fromServer(row) {
    return {
      id: row.id, kind: row.kind, title: row.title, body: row.body || '',
      meta: row.meta || dateLabel(row.created_at), images: Array.isArray(row.images) ? row.images : [],
      createdAt: row.created_at, createdMs: Date.parse(row.created_at) || 0, server: true
    };
  }
  function allPosts() { return state.myPosts.concat(state.posts); }
  function findPost(id) {
    var list = allPosts();
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
    return null;
  }
  function newestStamp() {
    var best = 0;
    state.posts.forEach(function (p) { if (p.createdMs && p.createdMs > best) { best = p.createdMs; } });
    return best;
  }
  function hasUnread() {
    return state.lastSeen > 0 && newestStamp() > state.lastSeen;
  }
  function markSeen() {
    var newest = Math.max(newestStamp(), state.lastSeen);
    if (newest > state.lastSeen) { state.lastSeen = newest; store.set('lastSeen', newest); }
  }
  function allPrayers() {
    var mine = state.myPrayers.map(function (p) { return { id: p.id, text: p.text, tag: '나의 기도', meta: p.meta }; });
    var shared = state.sharedPrayers.map(function (p) { return { id: p.id, text: p.text, tag: '공동 기도', meta: '교회' }; });
    return mine.concat(shared);
  }
  function findVideo(id) {
    for (var i = 0; i < state.videos.length; i++) { if (state.videos[i].id === id) { return state.videos[i]; } }
    return state.videos[0];
  }
  // 승인제가 켜져 있는데 이 휴대폰은 승인도 받지 않았고 관리자도 아닐 때
  function locked() {
    var g = state.gate;
    return serverOn && g.ready && g.membersOnly && !g.member && !g.admin && !state.admin;
  }
  function appUrl() {
    return new URL('./', window.location.href).href.split('#')[0].split('?')[0];
  }
  function spaced(code) {
    var c = String(code || '');
    return c.slice(0, 4) + ' ' + c.slice(4);
  }
  // 성도에게 보내는 문자 내용
  function inviteText(it) {
    return '[찬양하는교회] ' + it.name + ' 님의 앱 승인번호는 ' + spaced(it.code) + ' 입니다. (' + dayLabel(it.expires_at) + '까지, 한 번만 사용)\n' +
      '1) 아래 주소를 열어 홈 화면에 설치합니다.\n' +
      '2) 설치한 앱을 열고 승인번호를 입력합니다.\n' + appUrl();
  }
  var chev = '<svg class="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>';
  var playIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5l12 7-12 7z"></path></svg>';

  function go(screen, extra) {
    var prevTab = state.tab;
    if (locked() && screen !== 'gate' && screen !== 'login') { screen = 'gate'; extra = null; }
    if (state.screen === 'members' && screen !== 'members') { state.issued = null; state.confirmRemove = ''; }
    state.flash = ''; state.flashText = ''; state.confirmDelete = '';
    if (extra) { for (var k in extra) { state[k] = extra[k]; } }
    if (TABS.indexOf(screen) >= 0) { state.tab = screen; }
    else if (!extra || !extra.backTo) { state.backTo = prevTab; }
    state.screen = screen;
    if (screen === 'noti') { markSeen(); }
    if (screen === 'news' || screen === 'home') { refreshIfStale(); }
    render();
    $view.scrollTop = 0;
    if (screen === 'detail') { loadImages(findPost(state.postId)); }
    if (screen === 'members') { loadMembers(); }
  }
  function toast(text) {
    $banner.textContent = text;
    $banner.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { $banner.hidden = true; }, 3500);
  }

  // ---------- 설치 안내 ----------
  function iosSteps(env) {
    return '<ol class="steps">' +
      '<li>Safari의 <b>공유</b> 단추(네모에서 화살표가 위로 나가는 모양)를 누릅니다. 보이지 않으면 주소 칸 옆의 <b>⋯</b>를 먼저 누릅니다.</li>' +
      '<li>목록을 아래로 내려 <b>홈 화면에 추가</b>를 누릅니다.</li>' +
      '<li>오른쪽 위의 <b>추가</b>를 누릅니다. "웹 앱으로 열기"가 보이면 켜 둔 채로 추가합니다.</li>' +
      '<li>홈 화면에 생긴 <b>찬양하는교회</b> 아이콘을 눌러 엽니다.</li></ol>' +
      (env.safari ? '' : '<div class="muted">Safari가 아닌 브라우저에서는 메뉴 위치가 다를 수 있습니다. 잘 되지 않으면 Safari로 열어 주세요.</div>');
  }
  function installCard(env) {
    var h = '<section class="card"><h2 class="h">휴대폰에 앱으로 설치하기</h2>';
    if (installEvent) {
      h += '<button class="btn line" data-act="install">앱 설치하기</button><div class="muted">설치 창이 뜨면 "설치"를 눌러 주세요.</div>';
    } else if (env.ios) {
      h += iosSteps(env);
    } else {
      h += '<div class="muted"><b>Chrome</b>: 오른쪽 위 메뉴(⋮)에서 "앱 설치" 또는 "홈 화면에 추가"를 누릅니다.<br>' +
        '<b>삼성 인터넷</b>: 아래쪽 메뉴(≡)에서 "현재 페이지 추가" → "홈 화면"을 누릅니다.</div>';
    }
    return h + '</section>';
  }
  function iosInstallCard(env) {
    return '<section class="card"><h2 class="h">먼저 홈 화면에 설치해 주세요</h2>' +
      '<div>아이폰은 홈 화면에 설치한 앱에서 승인번호를 입력합니다.</div>' + iosSteps(env) +
      '<div class="muted">설치한 앱을 열면 승인번호를 입력하는 칸이 나옵니다.</div></section>';
  }
  // 카카오톡 같은 다른 앱 안에서 열린 화면: 설치가 되지 않으므로 바깥 브라우저로 안내합니다.
  function inAppCard(env) {
    var url = appUrl();
    var target = env.ios ? 'Safari' : 'Chrome';
    var h = '<section class="card"><h2 class="h">' + (env.kakao && !env.ios ? '다른 브라우저' : target) + '에서 열어 주세요</h2>' +
      '<div>지금은 ' + (env.kakao ? '카카오톡' : '다른 앱') + ' 안에서 열린 화면이라 앱을 설치할 수 없습니다.</div>';
    if (env.kakao) {
      h += '<a class="btn" href="kakaotalk://web/openExternal?url=' + encodeURIComponent(url) + '">' + (env.ios ? 'Safari' : '다른 브라우저') + '에서 열기</a>';
    } else if (env.android) {
      h += '<a class="btn" href="intent://' + esc(url.replace(/^https?:\/\//, '')) + '#Intent;scheme=https;package=com.android.chrome;end">Chrome에서 열기</a>';
    }
    h += '<button class="btn line" data-act="copyUrl">앱 주소 복사</button>' +
      '<div class="muted">단추가 동작하지 않으면 화면의 메뉴(⋮ 또는 공유)에서 "다른 브라우저로 열기"를 누르거나, 복사한 주소를 ' + target + ' 주소 칸에 붙여 넣어 주세요.</div>';
    if (!env.ios) { h += '<button class="btn text" data-act="gateForce">그래도 이 화면에서 승인번호 입력하기</button>'; }
    return h + '</section>';
  }

  // ---------- 화면 ----------
  var screens = {};

  // 승인 전 첫 화면
  screens.gate = function () {
    var env = hooks.platform();
    var h = '<div class="stack" style="gap:14px"><section class="card gate-top">' +
      '<img src="icons/icon-192.png" alt="" width="64" height="64"><h2 class="h">찬양하는교회</h2>' +
      '<div>찬양하는교회 성도를 위한 앱입니다.<br>교회에서 문자로 받은 <b>승인번호</b>를 입력하면 사용할 수 있습니다.</div></section>';
    if (state.gateOffline) { h += '<div class="err" role="alert">서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.</div>'; }
    var canType = true;
    if (env.inApp && !(state.gateForce && !env.ios)) { canType = false; h += inAppCard(env); }
    else if (env.ios && !env.standalone) { canType = false; h += iosInstallCard(env); }
    if (canType) {
      h += '<section class="card"><label class="f" for="code">승인번호 (숫자 8자리)</label>' +
        '<input id="code" class="code-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="11" placeholder="0000 0000" data-bind="code" value="' + esc(state.code) + '">' +
        (state.gateMsg ? '<div class="err" role="alert">' + esc(state.gateMsg) + '</div>' : '') +
        '<button class="btn" data-act="redeem"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? '확인하는 중…' : '확인') + '</button>' +
        '<div class="muted">승인번호가 없거나 기한이 지났으면 교회 앱 담당자에게 문의해 주세요.</div></section>';
      if (!env.standalone) { h += installCard(env); }
    }
    return h + '<button class="btn text" data-act="go" data-screen="login">관리자 로그인</button></div>';
  };

  screens.home = function () {
    var latest = state.videos.filter(function (v) { return v.type === 'A'; })[0];
    var news = allPosts().filter(function (p) { return p.kind === 'news'; }).slice(0, 2);
    var h = '<div class="stack" style="gap:16px">';
    h += '<section class="card"><div class="muted" style="font-weight:700">오늘의 말씀 · ' + todayLabel() + '</div>' +
      '<div class="verse">' + esc(SETTINGS.verse.text) + '</div><div class="muted">' + esc(SETTINGS.verse.ref) + '</div>' +
      '<a class="qt" href="' + SETTINGS.qtUrl + '" target="_blank" rel="noopener"><span><b>생명의 삶 QT</b><small>오늘의 본문 · 두란노 페이지로 이동합니다</small></span>' + chev + '</a></section>';
    if (latest) {
      h += '<button class="hero" data-act="sermon" data-id="' + latest.id + '" data-back="home"><span class="play">' + playIcon + '</span>' +
        '<span><small>최근 주일예배</small><b>' + latest.fullDate + '</b><small>' + latest.title + '</small></span></button>';
    }
    h += '<div class="grid2">' +
      '<button class="tile" data-act="go" data-screen="news" data-seg="bulletin"><b>주보</b><span class="muted">이번 주 예배 순서</span></button>' +
      '<button class="tile" data-act="go" data-screen="news" data-seg="event"><b>행사 일정</b><span class="muted">다가오는 교회 일정</span></button>' +
      '<button class="tile" data-act="go" data-screen="info"><b>예배 안내</b><span class="muted">주일 오전 11시 · 부천역 8분</span></button>' +
      '<button class="tile" data-act="go" data-screen="info"><b>새가족 안내</b><span class="muted">처음 오신 분들께</span></button></div>';
    h += '<section class="stack" style="gap:8px"><div class="row between"><h2 class="h">교회 소식</h2>' +
      '<button class="btn text" data-act="go" data-screen="news" data-seg="news">전체 보기</button></div>';
    if (!news.length) { h += '<div class="empty">' + (state.loaded ? '아직 올라온 소식이 없습니다.' : '불러오는 중입니다…') + '</div>'; }
    news.forEach(function (p) {
      h += '<button class="item" data-act="detail" data-id="' + esc(p.id) + '" data-back="home"><span class="grow"><b>' + esc(p.title) + '</b><span class="muted">' + esc(p.meta) + '</span></span>' + chev + '</button>';
    });
    return h + '</section></div>';
  };

  screens.sermons = function () {
    if (!state.videos.length) {
      return '<div class="empty">' + (state.loadError ? '영상 목록을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 열어 주세요.' : '영상 목록을 불러오는 중입니다…') + '</div>';
    }
    var byType = state.videos.filter(function (v) { return state.fType === 'all' || v.type === state.fType; });
    var years = [], months = [];
    byType.forEach(function (v) { if (years.indexOf(v.y) < 0) { years.push(v.y); } });
    var fYear = years.indexOf(state.fYear) >= 0 ? state.fYear : years[0];
    byType.forEach(function (v) { if (v.y === fYear && months.indexOf(v.m) < 0) { months.push(v.m); } });
    var fMonth = months.indexOf(state.fMonth) >= 0 ? state.fMonth : months[0];
    var shown = byType.filter(function (v) { return v.y === fYear && v.m === fMonth; });
    var types = [['all', '전체'], ['A', '주일예배'], ['B', '주일저녁예배'], ['C', '금요심야기도회']];

    var h = '<div class="stack"><div class="grid2" style="gap:8px">';
    types.forEach(function (t) {
      h += '<button class="chip" data-act="ftype" data-v="' + t[0] + '" aria-pressed="' + (state.fType === t[0]) + '">' + t[1] + '</button>';
    });
    h += '</div><div class="scroller">';
    years.forEach(function (y) { h += '<button class="chip" data-act="fyear" data-v="' + y + '" aria-pressed="' + (y === fYear) + '">' + y + '년</button>'; });
    h += '</div><div class="scroller">';
    months.forEach(function (m) { h += '<button class="chip" data-act="fmonth" data-y="' + fYear + '" data-v="' + m + '" aria-pressed="' + (m === fMonth) + '">' + m + '월</button>'; });
    h += '</div><div class="muted">' + fYear + '년 ' + fMonth + '월 · 영상 ' + shown.length + '개 (전체 ' + state.videos.length + '개)</div>';
    if (!shown.length) { h += '<div class="empty">이 달에는 해당 예배 영상이 없습니다.</div>'; }
    shown.forEach(function (v, i) {
      if (i === 0 || shown[i - 1].key !== v.key) { h += '<div class="date-h">' + v.dateLabel + '</div>'; }
      var sub = (state.notes[v.id] ? '설교 노트 있음 · ' : '') + (v.priv ? '비공개 영상' : '예배 영상');
      h += '<button class="item" data-act="sermon" data-id="' + v.id + '" data-back="sermons"><span class="badge ' + v.type + '">' + playIcon + '</span>' +
        '<span class="grow"><b>' + v.title + '</b><span class="muted">' + sub + '</span></span>' + chev + '</button>';
    });
    return h + '</div>';
  };

  screens.sermon = function () {
    var v = findVideo(state.sermonId);
    if (!v) { return '<div class="empty">영상을 찾지 못했습니다.</div>'; }
    var url = 'https://www.youtube.com/watch?v=' + v.id;
    var h = '<div class="stack" style="gap:14px">';
    h += '<div class="player"><iframe src="https://www.youtube-nocookie.com/embed/' + v.id + '?rel=0&playsinline=1" title="' + v.title + ' ' + v.fullDate + '" loading="lazy" ' +
      'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>';
    h += '<div><div class="h" style="font-size:18px">' + v.title + '</div><div class="muted">' + v.fullDate + '</div></div>';
    h += '<a class="btn line" href="' + url + '" target="_blank" rel="noopener">유튜브에서 영상 보기</a>';
    if (v.priv) { h += '<div class="err" style="color:var(--warm-fg)">비공개로 설정된 영상입니다. 채널 관리자만 볼 수 있습니다.</div>'; }
    h += '<section class="card"><label class="f" for="note">설교 노트</label>' +
      '<textarea id="note" placeholder="말씀을 들으며 적고 싶은 내용을 남겨 보세요." style="min-height:140px">' + esc(state.notes[v.id] || '') + '</textarea>' +
      '<div class="row"><button class="btn" data-act="saveNote">노트 저장</button>' +
      (state.flash === 'noteSaved' ? '<span class="ok" role="status">저장했습니다</span>' : '') + '</div>' +
      '<div class="muted">노트는 이 휴대폰에만 저장됩니다.</div></section>';
    return h + '</div>';
  };

  screens.news = function () {
    var list = allPosts().filter(function (p) { return p.kind === state.seg; });
    var h = '<div class="stack"><div class="seg">';
    ['news', 'bulletin', 'event'].forEach(function (k) {
      h += '<button data-act="seg" data-v="' + k + '" aria-pressed="' + (state.seg === k) + '">' + KIND_NAMES[k] + '</button>';
    });
    h += '</div>';
    if (serverOn && state.serverReady && state.loaded && state.postsFrom !== 'server') {
      h += '<div class="muted">서버에 연결되지 않아 마지막으로 받아 둔 내용을 보여 드립니다.</div>';
    }
    if (!list.length) {
      h += '<div class="empty">' + (state.loaded
        ? { news: '아직 올라온 소식이 없습니다.', bulletin: '아직 올라온 주보가 없습니다.', event: '아직 등록된 일정이 없습니다.' }[state.seg]
        : '불러오는 중입니다…') + '</div>';
    }
    list.forEach(function (p) {
      var photos = p.images && p.images.length ? '<span class="tag">사진 ' + p.images.length + '장</span>' : '';
      h += '<button class="item" data-act="detail" data-id="' + esc(p.id) + '" data-back="news"><span class="grow"><b>' + esc(p.title) + '</b><span class="muted">' + esc(p.meta) + '</span></span>' +
        photos + (p.local ? '<span class="tag">이 휴대폰</span>' : '') + chev + '</button>';
    });
    if (state.admin) { h += '<button class="btn" data-act="go" data-screen="post">글 올리기</button>'; }
    return h + '</div>';
  };

  screens.detail = function () {
    var p = findPost(state.postId);
    if (!p) { return '<div class="empty">글을 찾지 못했습니다. 지워진 글일 수 있습니다.</div>'; }
    var h = '<article class="card" style="padding:18px"><div class="muted" style="font-weight:700;color:var(--primary)">' + KIND_NAMES[p.kind] + '</div>' +
      '<h2 class="h" style="font-size:20px;line-height:1.4">' + esc(p.title) + '</h2><div class="muted">' + esc(p.meta) + '</div>' +
      '<div style="height:1px;background:#E1E6ED"></div>';
    if (p.body) { h += '<div class="pre">' + esc(p.body) + '</div>'; }
    var shown = 0;
    (p.images || []).forEach(function (path, i) {
      // 성도 승인을 쓰기 전의 서버는 공개 주소, 쓰는 서버는 권한을 확인하고 받은 주소를 씁니다.
      var url = !serverOn ? '' : state.gate.ready ? (state.imageUrls[path] && state.imageUrls[path].url) : Server.imageUrl(path);
      if (url) {
        shown++;
        h += '<a class="shot" href="' + esc(url) + '" target="_blank" rel="noopener"><img src="' + esc(url) + '" loading="lazy" alt="' + esc(p.title) + ' 사진 ' + (i + 1) + '"></a>';
      } else {
        h += '<div class="shot wait">' + (state.imageError ? esc(state.imageError) : '사진을 불러오는 중입니다…') + '</div>';
      }
    });
    if (shown) { h += '<div class="muted">사진을 누르면 크게 볼 수 있습니다.</div>'; }
    var canDelete = p.local || (p.server && state.admin);
    if (canDelete) {
      if (state.flashText) { h += '<div class="err" role="alert">' + esc(state.flashText) + '</div>'; }
      var asking = state.confirmDelete === p.id;
      h += '<button class="btn ' + (asking ? 'danger' : 'line') + '" data-act="deletePost" data-id="' + esc(p.id) + '"' + (state.busy ? ' disabled' : '') + '>' +
        (state.busy ? '지우는 중…' : asking ? '정말 지울까요? 한 번 더 누르면 지워집니다' : '이 글 지우기') + '</button>';
      if (p.local) { h += '<div class="muted">예전 버전에서 이 휴대폰에만 저장해 둔 글입니다. 다른 성도에게는 보이지 않습니다.</div>'; }
    }
    return h + '</article>';
  };

  screens.prayer = function () {
    var h = '<div class="stack"><section class="card"><label class="f" for="prayer">나의 기도제목 적기</label>' +
      '<textarea id="prayer" placeholder="기도할 제목을 적어 주세요." style="min-height:72px"></textarea>' +
      '<button class="btn" data-act="addPrayer">저장</button>' +
      '<div class="muted">내가 적은 기도제목은 이 휴대폰에만 저장되고, 다른 성도에게는 보이지 않습니다.</div></section>';
    allPrayers().forEach(function (p) {
      var on = !!state.prayed[p.id];
      h += '<section class="card"><div class="row" style="gap:8px"><span class="tag">' + p.tag + '</span><span class="muted">' + esc(p.meta) + '</span></div>' +
        '<div class="pre">' + esc(p.text) + '</div><div class="row">' +
        '<button class="pray" data-act="pray" data-id="' + esc(p.id) + '" aria-pressed="' + on + '">' + (on ? '기도했습니다' : '기도합니다') + '</button>' +
        (p.tag === '나의 기도' ? '<button class="btn text" data-act="delPrayer" data-id="' + esc(p.id) + '">지우기</button>' : '') + '</div></section>';
    });
    return h + '</div>';
  };

  screens.more = function () {
    var env = hooks.platform();
    var h = '<div class="stack">' +
      '<button class="item" data-act="go" data-screen="info"><span class="grow"><b>예배 시간 · 오시는 길 · 새가족 안내</b></span>' + chev + '</button>' +
      '<button class="item" data-act="go" data-screen="news" data-seg="event"><span class="grow"><b>행사 일정</b></span>' + chev + '</button>' +
      '<a class="item" href="' + SETTINGS.qtUrl + '" target="_blank" rel="noopener"><span class="grow"><b>생명의 삶 QT</b><span class="muted">두란노 페이지로 이동</span></span>' + chev + '</a>';
    if (!env.standalone) { h += installCard(env); }
    if (!serverOn) {
      h += '<div class="muted" style="padding:4px">서버가 연결되지 않아 관리자 기능은 쓸 수 없습니다.</div>';
    } else if (!state.admin) {
      h += '<button class="item" data-act="go" data-screen="login" style="border:1px solid var(--line)"><span class="grow"><b>관리자 로그인</b></span>' + chev + '</button>';
    } else {
      h += '<section class="card"><div class="ok">관리자로 로그인되어 있습니다</div><div class="muted">' + esc(state.admin.email) + '</div>' +
        '<button class="btn" data-act="go" data-screen="post">글 올리기 (소식 · 주보 · 일정)</button>' +
        '<button class="btn line" data-act="go" data-screen="members">성도 승인 (승인번호 보내기)</button>' +
        '<button class="btn line" data-act="exportAll"' + (state.busy ? ' disabled' : '') + '>전체 내용 내려받기 (백업)</button>' +
        (state.flashText ? '<div class="err" role="alert">' + esc(state.flashText) + '</div>' : '') +
        '<button class="btn line" data-act="logout">로그아웃</button></section>';
    }
    if (state.gate.member && state.gate.name && !state.admin) {
      h += '<div class="muted" style="padding:4px">이 휴대폰은 ' + esc(state.gate.name) + ' 님으로 승인되어 있습니다.</div>';
    }
    return h + '<div class="muted" style="padding:4px">설교 노트와 나의 기도제목은 이 휴대폰에만 저장됩니다.</div></div>';
  };

  screens.info = function () {
    var h = '<div class="stack"><section class="card times"><h2 class="h">예배 시간</h2>';
    SETTINGS.times.forEach(function (t) { h += '<div><span>' + t[0] + '</span><span>' + t[1] + '</span></div>'; });
    h += '</section><section class="card"><div class="row" style="align-items:flex-start"><div class="grow stack" style="gap:10px"><h2 class="h">오시는 길</h2>' +
      '<div><b>찬양하는교회 본당</b><div>경기 부천시 소사구 경인로216번길 27, 2층</div><div class="muted">우편번호 14713</div></div></div>' +
      '<img class="photo" src="img/church-building.jpg" alt="찬양하는교회 건물 전경. 2층과 3층에 교회 간판이 있고 왼쪽 벽에 흰 십자가가 있습니다."></div>' +
      '<div class="note-box"><div class="muted" style="font-weight:700;color:var(--primary)">지하철</div><div>부천역 2번 출구에서 463m, 걸어서 8분</div></div>' +
      '<a class="btn" href="' + SETTINGS.mapUrl + '" target="_blank" rel="noopener">카카오맵에서 보기</a>' +
      '<a class="btn line" href="' + SETTINGS.routeUrl + '" target="_blank" rel="noopener">카카오맵 길찾기</a></section>' +
      '<section class="card"><h2 class="h">새가족 안내</h2><div>찬양하는교회에 처음 오신 분을 환영합니다.</div></section></div>';
    return h;
  };

  screens.login = function () {
    return '<section class="card" style="padding:18px"><div>주보와 소식을 올리는 분만 로그인하면 됩니다. 로그인하면 "글 올리기" 메뉴가 나타납니다.</div>' +
      '<label class="f" for="email">관리자 이메일</label><input id="email" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false">' +
      '<label class="f" for="pw">비밀번호</label><input id="pw" type="password" autocomplete="current-password">' +
      (state.flashText ? '<div class="err" role="alert">' + esc(state.flashText) + '</div>' : '') +
      '<button class="btn" data-act="login"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? '확인하는 중…' : '로그인') + '</button></section>';
  };

  screens.post = function () {
    if (!state.admin) { return '<div class="empty">관리자로 로그인한 뒤 글을 올릴 수 있습니다.</div>'; }
    var d = state.draft;
    var h = '<section class="card" style="padding:18px"><div class="f" style="font-weight:700">종류</div><div class="grid3">';
    ['news', 'bulletin', 'event'].forEach(function (k) {
      h += '<button class="chip" data-act="postKind" data-v="' + k + '" aria-pressed="' + (d.kind === k) + '">' + KIND_NAMES[k] + '</button>';
    });
    h += '</div><label class="f" for="ptitle">제목</label><input id="ptitle" type="text" maxlength="120" data-draft="title" value="' + esc(d.title) + '">';
    if (d.kind === 'event') {
      h += '<label class="f" for="pmeta">날짜와 시간</label><input id="pmeta" type="text" maxlength="80" data-draft="meta" placeholder="예: 12월 25일 (금) 오전 11시" value="' + esc(d.meta) + '">';
    }
    h += '<label class="f" for="pbody">내용</label><textarea id="pbody" maxlength="8000" data-draft="body" placeholder="' +
      (d.kind === 'bulletin' ? '주보 사진만 올릴 때는 비워 두어도 됩니다.' : '내용을 적어 주세요.') + '">' + esc(d.body) + '</textarea>';
    h += '<label class="f" for="pfiles">사진 (' + state.postFiles.length + '/' + SETTINGS.maxPhotos + ')</label>' +
      '<input id="pfiles" type="file" accept="image/*" multiple' + (state.postFiles.length >= SETTINGS.maxPhotos || state.busy ? ' disabled' : '') + '>';
    state.postFiles.forEach(function (f, i) {
      h += '<div class="row between file-row"><span class="grow">' + (i + 1) + '. ' + esc(f.name || '사진') + '</span>' +
        '<button class="btn text" data-act="removeFile" data-i="' + i + '"' + (state.busy ? ' disabled' : '') + '>빼기</button></div>';
    });
    h += '<div class="muted">사진은 올리기 전에 자동으로 크기를 줄입니다. 주보는 쪽마다 한 장씩 차례대로 고르면 그 순서로 보입니다.</div>';
    if (state.flashText) { h += '<div class="err" role="alert">' + esc(state.flashText) + '</div>'; }
    h += '<button class="btn" data-act="submitPost"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? esc(state.busyText || '올리는 중…') : '올리기') + '</button>' +
      '<div class="muted">' + (state.gate.ready && state.gate.membersOnly ? '올리면 승인된 성도의 앱에 바로 보입니다.' : '올리면 모든 성도의 앱에 바로 보입니다.') + '</div></section>';
    return h;
  };

  // 관리자: 성도 승인 (승인번호 만들기 · 문자 보내기 · 명단)
  screens.members = function () {
    if (!state.admin) { return '<div class="empty">관리자로 로그인한 뒤 사용할 수 있습니다.</div>'; }
    if (!state.gate.ready) {
      return '<div class="stack"><section class="card"><h2 class="h">서버 설정이 필요합니다</h2>' +
        '<div>성도 승인은 서버 설정 2단계를 실행한 뒤에 쓸 수 있습니다.</div>' +
        '<a class="btn line" href="supabase/" target="_blank" rel="noopener">서버 설정 페이지 열기</a>' +
        '<button class="btn text" data-act="retry">설정을 실행했습니다 · 다시 확인</button></section></div>';
    }
    var dis = state.busy ? ' disabled' : '';
    var h = '<div class="stack">';
    if (!state.gate.membersOnly) {
      h += '<div class="note-box">지금은 성도 승인이 꺼져 있어, 승인하지 않아도 누구나 볼 수 있습니다.</div>';
    }
    h += '<section class="card"><label class="f" for="mname">새로 승인할 성도 이름</label>' +
      '<input id="mname" type="text" maxlength="40" placeholder="예: 홍길동" autocomplete="off" data-bind="memberName" value="' + esc(state.memberName) + '">' +
      '<button class="btn" data-act="issueCode"' + dis + '>승인번호 만들기</button>' +
      '<div class="muted">전화번호는 저장하지 않습니다. 문자를 보낼 때 받는 사람을 직접 고릅니다.</div></section>';
    if (state.flashText) { h += '<div class="err" role="alert">' + esc(state.flashText) + '</div>'; }
    if (state.issued) {
      var it = state.issued;
      h += '<section class="card issued" role="status"><div class="muted" style="font-weight:700;color:var(--primary)">' + esc(it.name) + ' 님 승인번호</div>' +
        '<div class="code-big">' + esc(spaced(it.code)) + '</div>' +
        '<div class="muted">' + esc(dayLabel(it.expires_at)) + '까지 입력해야 하고, 한 번만 쓸 수 있습니다.</div>' +
        '<button class="btn" data-act="sendSms">문자 보내기</button>' +
        '<button class="btn line" data-act="copyInvite">내용 복사</button>' +
        '<div class="muted">이 번호는 이 화면을 벗어나면 다시 볼 수 없습니다. 놓쳤으면 명단에서 "다시 보내기"로 새 번호를 만드세요.</div></section>';
    }
    if (state.members === null) {
      h += '<div class="empty">' + (state.membersError ? esc(state.membersError) : '명단을 불러오는 중입니다…') + '</div>';
      return h + '</div>';
    }
    var approved = state.members.filter(function (m) { return m.state === 'approved'; }).length;
    h += '<h2 class="h" style="padding:6px 4px 0">명단 · 승인 ' + approved + '명 / 전체 ' + state.members.length + '명</h2>';
    if (!state.members.length) { h += '<div class="empty">아직 승인번호를 보낸 성도가 없습니다.</div>'; }
    state.members.forEach(function (m) {
      var tag = { approved: ['승인', 'ok'], waiting: ['입력 대기', 'wait'], expired: ['기한 지남', 'off'] }[m.state] || ['', ''];
      var sub = m.state === 'approved' ? dayLabel(m.approved_at) + ' 승인' + (m.code_waiting ? ' · 새 번호 입력 대기 (' + dayLabel(m.code_expires_at) + '까지)' : '')
        : m.state === 'waiting' ? dayLabel(m.code_expires_at) + '까지 입력' : '승인번호 기한이 지났습니다';
      var asking = state.confirmRemove === m.id;
      h += '<section class="card member"><div class="row between"><b class="grow">' + esc(m.name) + '</b><span class="tag ' + tag[1] + '">' + tag[0] + '</span></div>' +
        '<div class="muted">' + esc(sub) + '</div><div class="row">' +
        '<button class="btn line small" data-act="reissue" data-id="' + esc(m.id) + '"' + dis + '>다시 보내기</button>' +
        '<button class="btn ' + (asking ? 'danger' : 'line') + ' small" data-act="removeMember" data-id="' + esc(m.id) + '"' + dis + '>' +
        (asking ? '한 번 더 누르면 ' + (m.state === 'approved' ? '취소됩니다' : '지워집니다') : (m.state === 'approved' ? '승인 취소' : '삭제')) + '</button></div></section>';
    });
    if (state.members.length) {
      h += '<div class="muted" style="padding:4px">"다시 보내기"는 새 승인번호를 만듭니다. 이미 승인된 분은 새 번호를 입력할 때까지 지금 휴대폰을 그대로 쓸 수 있고, 새 번호를 입력하면 예전 휴대폰은 승인이 풀립니다.</div>';
    }
    return h + '</div>';
  };

  screens.noti = function () {
    var list = state.posts.filter(function (p) { return p.server; }).slice(0, 20);
    if (!list.length) { return '<div class="empty">새 소식이 없습니다.</div>'; }
    var h = '<div class="stack" style="gap:10px"><div class="muted">최근에 올라온 글입니다.</div>';
    list.forEach(function (p) {
      h += '<button class="item" data-act="detail" data-id="' + esc(p.id) + '" data-back="noti"><span class="grow"><b>' + KIND_NAMES[p.kind] + ' · ' + esc(p.title) + '</b><span class="muted">' + esc(dateLabel(p.createdAt)) + '</span></span>' + chev + '</button>';
    });
    return h + '</div>';
  };

  // 처음 여는 휴대폰: 승인제가 켜져 있는지 서버에 확인하기 전에는 내용을 보여 주지 않습니다.
  function checkingScreen() {
    if (!state.gateOffline) { return '<div class="empty">확인하는 중입니다…</div>'; }
    return '<div class="stack"><div class="empty">서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.</div>' +
      '<button class="btn" data-act="retry">다시 시도</button></div>';
  }

  function render() {
    var checking = serverOn && !state.gateKnown;
    var isLocked = locked();
    if (isLocked && state.screen !== 'gate' && state.screen !== 'login') { state.screen = 'gate'; }
    else if (!isLocked && state.screen === 'gate') { state.screen = state.tab; }
    if ($app) {
      if (isLocked || checking) { $app.classList.add('locked'); } else { $app.classList.remove('locked'); }
    }
    $title.textContent = checking ? '찬양하는교회' : (TITLES[state.screen] || '찬양하는교회');
    $back.hidden = checking || ROOTS.indexOf(state.screen) >= 0;
    $dot.hidden = isLocked || checking || !hasUnread();
    if ($bell) { $bell.hidden = isLocked || checking; }
    var tabButtons = document.querySelectorAll('#tabs button');
    for (var i = 0; i < tabButtons.length; i++) {
      if (tabButtons[i].getAttribute('data-screen') === state.tab) { tabButtons[i].setAttribute('aria-current', 'page'); }
      else { tabButtons[i].removeAttribute('aria-current'); }
    }
    // 입력하는 도중에 화면이 다시 그려져도 커서가 달아나지 않게 합니다.
    var active = document.activeElement;
    var keepId = active && active.id && $view.contains(active) ? active.id : '';
    var selStart = null, selEnd = null;
    if (keepId) { try { selStart = active.selectionStart; selEnd = active.selectionEnd; } catch (e) { selStart = null; } }
    $view.innerHTML = checking ? checkingScreen() : (screens[state.screen] || screens.home)();
    if (keepId) {
      var again = document.getElementById(keepId);
      if (again && !again.disabled) {
        again.focus();
        if (selStart !== null && selStart !== undefined) { try { again.setSelectionRange(selStart, selEnd); } catch (e) { /* 선택 범위가 없는 입력칸 */ } }
      }
    }
  }

  // ---------- 글 불러오기 ----------
  function loadFallbackFile() {
    return fetch('data/content.json').then(function (r) { if (!r.ok) { throw new Error('content'); } return r.json(); });
  }
  function loadPosts() {
    var file = loadFallbackFile().catch(function () { return {}; });
    if (!serverOn) {
      return file.then(function (j) {
        state.posts = j.posts || []; state.sharedPrayers = j.prayers || []; state.postsFrom = 'file';
      });
    }
    var server = Server.listPosts().then(function (rows) {
      store.set('postsCache', rows);
      return { rows: rows, from: 'server' };
    }).catch(function (e) {
      if (e && e.code === 'not_ready') { return { notReady: true }; }
      var cached = store.get('postsCache', null);
      return cached ? { rows: cached, from: 'cache' } : null;
    });
    return Promise.all([file, server]).then(function (res) {
      var j = res[0], s = res[1];
      state.sharedPrayers = j.prayers || [];
      state.serverReady = !(s && s.notReady);
      if (s && s.rows) { state.posts = s.rows.map(fromServer); state.postsFrom = s.from; }
      else { state.posts = j.posts || []; state.postsFrom = 'file'; }
      // 처음 연 날에는 "새 글" 표시를 띄우지 않고, 그 뒤에 올라온 글부터 표시합니다.
      if (!state.lastSeen && state.postsFrom === 'server') {
        state.lastSeen = newestStamp() || Date.now();
        store.set('lastSeen', state.lastSeen);
      }
    });
  }

  // ---------- 성도 승인 상태 ----------
  function checkGate() {
    if (!serverOn) { state.gateKnown = true; return Promise.resolve(); }
    return Server.gate().then(function (g) {
      state.gate = g; state.gateKnown = true; state.gateOffline = false;
      store.set('gate', g);
    }, function () {
      state.gateOffline = true;   // 서버에 닿지 못하면 마지막으로 확인한 상태를 그대로 씁니다.
    });
  }
  // 볼 수 없는 휴대폰에는 받아 둔 내용도 남기지 않습니다.
  function lockDown() {
    state.posts = []; state.postsFrom = 'none'; state.imageUrls = {};
    state.members = null; state.issued = null;
    store.drop('postsCache');
  }
  // 승인 상태를 서버에 다시 묻고, 그에 맞게 글을 불러오거나 잠급니다.
  function syncAccess() {
    syncedAt = Date.now();
    // 지난번에 볼 수 있었던 휴대폰은 확인을 기다리지 않고 글부터 불러옵니다.
    var early = state.gateKnown && !locked() ? loadPosts() : null;
    return checkGate().then(function () {
      if (!state.gateKnown) { return; }
      if (locked()) { return Promise.resolve(early).then(lockDown, lockDown); }
      return early || loadPosts();
    }).then(function () { state.gateMsg = locked() ? state.gateMsg : ''; render(); });
  }
  function refreshIfStale() {
    if (!serverOn || !state.loaded || Date.now() - syncedAt < 60000) { return; }
    syncAccess();
  }
  // 승인된 휴대폰만 받을 수 있는 사진 주소를 서버에서 받아 옵니다 (한 시간 동안 유효).
  function loadImages(p) {
    if (!serverOn || !state.gate.ready || !p || !p.server || !p.images || !p.images.length) { return; }
    var need = p.images.filter(function (path) {
      var c = state.imageUrls[path];
      return !c || Date.now() - c.at > 45 * 60000;
    });
    if (!need.length) { return; }
    state.imageError = '';
    Server.imageUrls(need).then(function (map) {
      var at = Date.now();
      need.forEach(function (path) { if (map[path]) { state.imageUrls[path] = { url: map[path], at: at }; } });
      if (need.some(function (path) { return !map[path]; })) { state.imageError = '사진을 불러오지 못했습니다.'; }
    }, function (e) { state.imageError = errorText(e); }).then(function () {
      if (state.screen === 'detail' && state.postId === p.id) { render(); }
    });
  }
  function loadMembers() {
    if (!serverOn || !state.admin || !state.gate.ready) { return Promise.resolve(); }
    if (!cleaned) { cleaned = true; Server.cleanup(); }
    return Server.listMembers().then(function (rows) {
      state.members = rows; state.membersError = '';
    }, function (e) {
      if (state.members === null) { state.membersError = errorText(e); }
    }).then(function () { if (state.screen === 'members') { render(); } });
  }
  var REDEEM_TEXT = {
    format: '승인번호는 숫자 8자리입니다. 다시 확인해 주세요.',
    expired: '기한이 지난 승인번호입니다. 교회 앱 담당자에게 새 번호를 요청해 주세요.',
    busy: '지금은 확인할 수 없습니다. 10분쯤 뒤에 다시 시도해 주세요.'
  };
  function redeemText(r) {
    if (r.reason === 'wrong') {
      return '승인번호가 맞지 않습니다. 다시 확인해 주세요.' + (typeof r.left === 'number' ? ' (남은 횟수 ' + r.left + '번)' : '');
    }
    if (r.reason === 'locked') {
      return '여러 번 틀려서 잠겼습니다. ' + (r.minutes ? '약 ' + r.minutes + '분' : '한 시간쯤') + ' 뒤에 다시 시도해 주세요.';
    }
    return REDEEM_TEXT[r.reason] || ERROR_TEXT.server;
  }

  // ---------- 동작 ----------
  var actions = {
    go: function (el) {
      var extra = {};
      var seg = el.getAttribute('data-seg');
      if (seg) { extra.seg = seg; }
      var screen = el.getAttribute('data-screen');
      if (screen === 'post' && state.screen === 'news') { state.draft.kind = state.seg; }
      go(screen, extra);
    },
    back: function () { if (!state.busy) { go(state.backTo || state.tab); } },
    sermon: function (el) { go('sermon', { sermonId: el.getAttribute('data-id'), backTo: el.getAttribute('data-back') }); },
    detail: function (el) { go('detail', { postId: el.getAttribute('data-id'), backTo: el.getAttribute('data-back') }); },
    ftype: function (el) { state.fType = el.getAttribute('data-v'); render(); },
    fyear: function (el) { state.fYear = Number(el.getAttribute('data-v')); state.fMonth = 0; render(); },
    fmonth: function (el) { state.fYear = Number(el.getAttribute('data-y')); state.fMonth = Number(el.getAttribute('data-v')); render(); },
    seg: function (el) { state.seg = el.getAttribute('data-v'); render(); },
    saveNote: function () {
      var text = document.getElementById('note').value.trim();
      if (text) { state.notes[state.sermonId] = text; } else { delete state.notes[state.sermonId]; }
      store.set('notes', state.notes);
      state.flash = 'noteSaved'; render();
    },
    addPrayer: function () {
      var text = document.getElementById('prayer').value.trim();
      if (!text) { return; }
      state.myPrayers.unshift({ id: 'my-' + Date.now(), text: text, meta: todayLabel() });
      store.set('myPrayers', state.myPrayers); render();
    },
    delPrayer: function (el) {
      var id = el.getAttribute('data-id');
      state.myPrayers = state.myPrayers.filter(function (p) { return p.id !== id; });
      store.set('myPrayers', state.myPrayers); render();
    },
    pray: function (el) {
      var id = el.getAttribute('data-id');
      if (state.prayed[id]) { delete state.prayed[id]; } else { state.prayed[id] = true; }
      store.set('prayed', state.prayed); render();
    },

    // --- 성도 승인 (성도 쪽) ---
    redeem: function () {
      if (state.busy) { return; }
      var box = document.getElementById('code');
      var raw = box ? box.value : state.code;
      var digits = String(raw || '').replace(/\D/g, '');
      state.code = raw || '';
      if (digits.length !== 8) { state.gateMsg = REDEEM_TEXT.format; render(); return; }
      state.busy = true; state.gateMsg = ''; render();
      Server.redeem(digits).then(function (r) {
        if (!r.ok) { state.busy = false; state.gateMsg = redeemText(r); render(); return; }
        state.code = '';
        return syncAccess().then(function () {
          state.busy = false;
          if (locked()) { state.gateMsg = ERROR_TEXT.server; render(); return; }
          go('home');
          toast((r.name ? r.name + ' 님, ' : '') + '승인되었습니다');
        });
      }).catch(function (e) {
        state.busy = false; state.gateMsg = errorText(e); render();
      });
    },
    gateForce: function () { state.gateForce = true; render(); },
    retry: function () { state.gateOffline = false; render(); syncAccess().then(function () { if (state.screen === 'members') { loadMembers(); } }); },
    copyUrl: function () {
      hooks.copyText(appUrl()).then(function () { toast('앱 주소를 복사했습니다'); }, function () { toast('복사하지 못했습니다. 주소: ' + appUrl()); });
    },

    // --- 관리자 ---
    login: function () {
      if (state.busy) { return; }
      var email = document.getElementById('email').value.trim();
      var pw = document.getElementById('pw').value;
      if (!email || !pw) { state.flashText = '이메일과 비밀번호를 모두 입력해 주세요.'; render(); return; }
      state.busy = true; state.flashText = ''; render();
      document.getElementById('email').value = email;
      Server.signIn(email, pw).then(function (admin) {
        state.admin = admin;
        return syncAccess().then(function () {
          state.busy = false;
          go('more');
          toast('관리자로 로그인했습니다');
        });
      }).catch(function (e) {
        state.busy = false; state.flashText = errorText(e); render();
        var box = document.getElementById('email');
        if (box) { box.value = email; }
      });
    },
    logout: function () {
      Server.signOut().then(function () {
        state.admin = null; state.members = null; state.issued = null;
        state.gate = { ready: state.gate.ready, membersOnly: state.gate.membersOnly, admin: false, member: state.gate.member, name: state.gate.name };
        store.set('gate', state.gate);
        if (locked()) { lockDown(); }
        render();
        toast('로그아웃했습니다');
        return syncAccess();   // 이 휴대폰이 성도로 승인되어 있었는지 서버에 다시 확인합니다
      });
    },
    postKind: function (el) { if (!state.busy) { state.draft.kind = el.getAttribute('data-v'); state.flashText = ''; render(); } },
    removeFile: function (el) { state.postFiles.splice(Number(el.getAttribute('data-i')), 1); render(); },
    submitPost: function () {
      if (state.busy) { return; }
      var d = state.draft;
      var input = { kind: d.kind, title: d.title.trim(), body: d.body.trim(), meta: d.kind === 'event' ? d.meta.trim() : '' };
      if (!input.title) { state.flashText = '제목을 입력해 주세요.'; render(); return; }
      if (!input.body && !state.postFiles.length) { state.flashText = '내용을 적거나 사진을 한 장 이상 골라 주세요.'; render(); return; }
      var files = state.postFiles.slice();
      state.busy = true; state.flashText = ''; state.busyText = files.length ? '사진 준비 중…' : '올리는 중…'; render();
      var blobs = [];
      var chain = Promise.resolve();
      files.forEach(function (f) { chain = chain.then(function () { return hooks.shrinkImage(f); }).then(function (b) { blobs.push(b); }); });
      chain.then(function () {
        return Server.createPost(input, blobs, function (i, n) { state.busyText = '사진 올리는 중… (' + i + '/' + n + ')'; render(); });
      }).then(function () {
        state.draft = { kind: input.kind, title: '', meta: '', body: '' };
        state.postFiles = [];
        return loadPosts();
      }).then(function () {
        state.busy = false; state.busyText = '';
        // 내가 방금 올린 글은 "새 글" 표시에서 뺍니다.
        markSeen();
        go('news', { seg: input.kind });
        toast('글을 올렸습니다');
      }, function (e) {
        state.busy = false; state.busyText = ''; state.flashText = errorText(e); render();
      });
    },
    deletePost: function (el) {
      if (state.busy) { return; }
      var id = el.getAttribute('data-id');
      var p = findPost(id);
      if (!p) { return; }
      if (state.confirmDelete !== id) { state.confirmDelete = id; state.flashText = ''; render(); return; }
      if (p.local) {
        state.myPosts = state.myPosts.filter(function (x) { return x.id !== id; });
        store.set('myPosts', state.myPosts);
        go('news', { seg: p.kind }); toast('글을 지웠습니다');
        return;
      }
      state.busy = true; render();
      Server.deletePost(p).then(function () { return loadPosts(); }).then(function () {
        state.busy = false;
        go('news', { seg: p.kind }); toast('글을 지웠습니다');
      }, function (e) {
        state.busy = false; state.confirmDelete = ''; state.flashText = errorText(e); render();
      });
    },
    exportAll: function () {
      if (state.busy) { return; }
      state.busy = true; state.flashText = ''; render();
      Server.exportAll().then(function (data) {
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'chanyang-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        state.busy = false; render(); toast('글 ' + data.posts.length + '개를 내려받았습니다');
      }, function (e) { state.busy = false; state.flashText = errorText(e); render(); });
    },

    // --- 성도 승인 (관리자 쪽) ---
    issueCode: function () {
      if (state.busy) { return; }
      var box = document.getElementById('mname');
      var name = String(box ? box.value : state.memberName).trim();
      state.memberName = name;
      if (!name) { state.flashText = '성도 이름을 입력해 주세요.'; render(); return; }
      issue(name, null);
    },
    reissue: function (el) {
      if (state.busy) { return; }
      issue(null, el.getAttribute('data-id'));
    },
    removeMember: function (el) {
      if (state.busy) { return; }
      var id = el.getAttribute('data-id');
      if (state.confirmRemove !== id) { state.confirmRemove = id; state.flashText = ''; render(); return; }
      state.busy = true; state.flashText = ''; render();
      Server.removeMember(id).then(function () {
        if (state.issued && state.issued.id === id) { state.issued = null; }
        state.confirmRemove = '';
        return loadMembers();
      }).then(function () {
        state.busy = false; render(); toast('명단에서 지웠습니다');
      }, function (e) {
        state.busy = false; state.confirmRemove = ''; state.flashText = errorText(e); render();
      });
    },
    sendSms: function () {
      if (!state.issued) { return; }
      // 받는 사람은 문자 앱에서 직접 고릅니다. 아이폰과 안드로이드는 내용을 붙이는 방식이 다릅니다.
      hooks.openUrl('sms:' + (hooks.platform().ios ? '&' : '?') + 'body=' + encodeURIComponent(inviteText(state.issued)));
    },
    copyInvite: function () {
      if (!state.issued) { return; }
      hooks.copyText(inviteText(state.issued)).then(function () { toast('문자 내용을 복사했습니다'); }, function () { toast('복사하지 못했습니다. 번호를 직접 적어 보내 주세요.'); });
    },
    install: function () {
      if (!installEvent) { return; }
      var ev = installEvent;
      installEvent = null;
      ev.prompt();
      render();
    }
  };
  function issue(name, id) {
    state.busy = true; state.flashText = ''; state.confirmRemove = ''; render();
    Server.issueCode(name, id).then(function (it) {
      state.issued = it;
      if (!id) { state.memberName = ''; }
      return loadMembers();
    }).then(function () {
      state.busy = false; render();
      $view.scrollTop = 0;
    }, function (e) {
      state.busy = false; state.flashText = errorText(e); render();
    });
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled) { return; }
    var fn = actions[el.getAttribute('data-act')];
    if (fn) { fn(el); }
  });
  // 입력하는 중에 화면이 다시 그려져도 내용이 사라지지 않게 적는 대로 기억해 둡니다.
  document.addEventListener('input', function (e) {
    if (!e.target.getAttribute) { return; }
    var key = e.target.getAttribute('data-draft');
    if (key) { state.draft[key] = e.target.value; }
    var bind = e.target.getAttribute('data-bind');
    if (bind) { state[bind] = e.target.value; }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target && e.target.id === 'code') { actions.redeem(); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id !== 'pfiles' || !e.target.files) { return; }
    var room = SETTINGS.maxPhotos - state.postFiles.length;
    var picked = Array.prototype.slice.call(e.target.files).filter(function (f) { return !f.type || /^image\//.test(f.type); });
    state.postFiles = state.postFiles.concat(picked.slice(0, Math.max(0, room)));
    state.flashText = picked.length > room ? '사진은 ' + SETTINGS.maxPhotos + '장까지 올릴 수 있습니다.' : '';
    render();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { refreshIfStale(); }
  });

  function installChanged() {
    if (state.screen === 'more' || state.screen === 'gate') { render(); }
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); installEvent = e;
    installChanged();
  });
  window.addEventListener('appinstalled', function () { installEvent = null; installChanged(); });

  // ---------- 시작 ----------
  function loadVideos() {
    return fetch('data/videos.txt').then(function (r) { if (!r.ok) { throw new Error('videos'); } return r.text(); })
      .then(function (t) {
        state.videos = parseVideos(t);
        if (state.videos.length) { state.fYear = state.videos[0].y; state.fMonth = state.videos[0].m; state.sermonId = state.videos[0].id; }
        state.loadError = false;
      }).catch(function () { state.loadError = true; });
  }
  function load() {
    return Promise.all([loadVideos(), syncAccess()]).then(function () { state.loaded = true; render(); });
  }
  function restoreAdmin() {
    if (!serverOn) { return Promise.resolve(); }
    // 로그인이 서버에서 풀렸을 때(관리자 로그인 만료, 승인 취소 등): 상태를 다시 확인합니다.
    Server.onSignedOut(function () {
      state.admin = null;
      syncAccess();
    });
    return Server.currentAdmin().then(function (admin) { state.admin = admin; render(); }, function () { /* 연결이 안 되면 로그인 안 한 상태로 둡니다 */ });
  }

  render();
  var ready = Promise.all([load(), restoreAdmin()]);
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  window.__chanyang = { state: state, go: go, load: load, ready: ready, hooks: hooks, sync: syncAccess }; // 점검용
})();
