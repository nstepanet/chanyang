/* 찬양하는교회 웹앱 — 1단계 (서버 없이 동작)
 *
 * 고칠 일이 많은 값은 아래 SETTINGS 에 모아 두었습니다.
 * 소식·주보·일정은 data/content.json, 예배 영상 목록은 data/videos.txt 에 있습니다.
 */
(function () {
  'use strict';

  var SETTINGS = {
    // 서버가 없는 1단계에서는 형식적인 잠금입니다. 2단계에서 실제 로그인으로 바꿉니다.
    adminPassword: '1234',
    qtUrl: 'https://www.duranno.com/qt/view2/bible.asp',
    mapUrl: 'https://place.map.kakao.com/858335183',
    routeUrl: 'https://map.kakao.com/link/to/858335183',
    verse: { text: '호흡이 있는 자마다 여호와를 찬양할찌어다 할렐루야', ref: '시편 150:6' },
    times: [
      ['주일예배', '주일 오전 11시'], ['수요예배', '오후 7시'], ['금요기도회', '오후 8시'],
      ['새벽기도회', '오전 5시 30분'], ['교회학교', '주일 오전 9시'], ['고등부', '주일 오전 9시 30분'],
      ['청년부', '주일 오후 1시']
    ]
  };

  var TYPE_NAMES = { A: '주일예배', B: '주일저녁예배', C: '금요심야기도회' };
  var KIND_NAMES = { news: '소식', bulletin: '주보', event: '일정' };
  var TITLES = {
    home: '찬양하는교회', sermons: '설교 · 예배 영상', sermon: '설교 보기', news: '소식 · 주보 · 일정',
    detail: '자세히 보기', prayer: '기도제목', more: '더보기', info: '예배 안내',
    login: '관리자 로그인', post: '글 올리기', noti: '알림'
  };
  var TABS = ['home', 'sermons', 'news', 'prayer', 'more'];
  var DAYS = '일월화수목금토';

  // ---------- 저장 (이 휴대폰 안에만 보관) ----------
  var store = {
    get: function (key, fallback) {
      try { var v = localStorage.getItem('chanyang.' + key); return v === null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem('chanyang.' + key, JSON.stringify(value)); } catch (e) { /* 저장 공간을 못 쓰는 환경 */ }
    }
  };

  var state = {
    screen: 'home', tab: 'home', backTo: 'home',
    videos: [], posts: [], sharedPrayers: [],
    fType: 'all', fYear: 0, fMonth: 0,
    seg: 'news', sermonId: '', postId: '', postKind: 'news',
    loaded: false, loadError: false, flash: '',
    notes: store.get('notes', {}),
    myPosts: store.get('myPosts', []),
    myPrayers: store.get('myPrayers', []),
    prayed: store.get('prayed', {}),
    notis: store.get('notis', []),
    unread: store.get('unread', false),
    notiOn: store.get('notiOn', true),
    isAdmin: store.get('isAdmin', false)
  };

  var $view = document.getElementById('view');
  var $title = document.getElementById('title');
  var $back = document.getElementById('back');
  var $dot = document.getElementById('dot');
  var $banner = document.getElementById('banner');
  var installEvent = null;
  var bannerTimer = 0;

  // ---------- 도우미 ----------
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
  function allPosts() { return state.myPosts.concat(state.posts); }
  function allPrayers() {
    var mine = state.myPrayers.map(function (p) { return { id: p.id, text: p.text, tag: '나의 기도', meta: p.meta }; });
    var shared = state.sharedPrayers.map(function (p) { return { id: p.id, text: p.text, tag: '공동 기도', meta: '교회' }; });
    return mine.concat(shared);
  }
  function findVideo(id) {
    for (var i = 0; i < state.videos.length; i++) { if (state.videos[i].id === id) { return state.videos[i]; } }
    return state.videos[0];
  }
  var chev = '<svg class="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>';
  var playIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5l12 7-12 7z"></path></svg>';

  function go(screen, extra) {
    var prevTab = state.tab;
    state.flash = '';
    if (extra) { for (var k in extra) { state[k] = extra[k]; } }
    if (TABS.indexOf(screen) >= 0) { state.tab = screen; }
    else if (!extra || !extra.backTo) { state.backTo = prevTab; }
    state.screen = screen;
    if (screen === 'noti') { state.unread = false; store.set('unread', false); }
    render();
    $view.scrollTop = 0;
  }
  function showBanner(text) {
    $banner.innerHTML = '<small>찬양하는교회 · 이 휴대폰에만 표시되는 알림입니다</small>' + esc(text);
    $banner.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { $banner.hidden = true; }, 4500);
  }

  // ---------- 화면 ----------
  var screens = {};

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
    if (!list.length) {
      h += '<div class="empty">' + (state.loaded ? { news: '아직 올라온 소식이 없습니다.', bulletin: '아직 올라온 주보가 없습니다.', event: '아직 등록된 일정이 없습니다.' }[state.seg] : '불러오는 중입니다…') + '</div>';
    }
    list.forEach(function (p) {
      h += '<button class="item" data-act="detail" data-id="' + esc(p.id) + '" data-back="news"><span class="grow"><b>' + esc(p.title) + '</b><span class="muted">' + esc(p.meta) + '</span></span>' +
        (p.local ? '<span class="tag">이 휴대폰</span>' : '') + chev + '</button>';
    });
    if (state.isAdmin) { h += '<button class="btn" data-act="go" data-screen="post">글 올리기</button>'; }
    return h + '</div>';
  };

  screens.detail = function () {
    var p = allPosts().filter(function (x) { return x.id === state.postId; })[0];
    if (!p) { return '<div class="empty">글을 찾지 못했습니다.</div>'; }
    var h = '<article class="card" style="padding:18px"><div class="muted" style="font-weight:700;color:var(--primary)">' + KIND_NAMES[p.kind] + '</div>' +
      '<h2 class="h" style="font-size:20px;line-height:1.4">' + esc(p.title) + '</h2><div class="muted">' + esc(p.meta) + '</div>' +
      '<div style="height:1px;background:#E1E6ED"></div><div class="pre">' + esc(p.body) + '</div>';
    if (p.local && state.isAdmin) { h += '<button class="btn line" data-act="deletePost" data-id="' + esc(p.id) + '">이 글 지우기</button>'; }
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
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    var h = '<div class="stack">' +
      '<button class="item" data-act="go" data-screen="info"><span class="grow"><b>예배 시간 · 오시는 길 · 새가족 안내</b></span>' + chev + '</button>' +
      '<button class="item" data-act="go" data-screen="news" data-seg="event"><span class="grow"><b>행사 일정</b></span>' + chev + '</button>' +
      '<a class="item" href="' + SETTINGS.qtUrl + '" target="_blank" rel="noopener"><span class="grow"><b>생명의 삶 QT</b><span class="muted">두란노 페이지로 이동</span></span>' + chev + '</a>';
    if (!standalone) {
      h += '<section class="card"><h2 class="h">휴대폰에 앱으로 설치하기</h2>';
      if (installEvent) { h += '<button class="btn" data-act="install">홈 화면에 설치</button>'; }
      h += '<div class="muted"><b>아이폰</b>: Safari 아래쪽 공유 버튼을 누른 뒤 "홈 화면에 추가"를 선택하세요.<br><b>안드로이드</b>: Chrome 오른쪽 위 메뉴(⋮)에서 "홈 화면에 추가" 또는 "앱 설치"를 선택하세요.</div></section>';
    }
    if (!state.isAdmin) {
      h += '<button class="item" data-act="go" data-screen="login" style="border:1px solid var(--line)"><span class="grow"><b>관리자 로그인</b></span>' + chev + '</button>';
    } else {
      h += '<div class="ok">관리자로 로그인되어 있습니다</div>' +
        '<button class="btn" data-act="go" data-screen="post">글 올리기 (소식 · 주보 · 일정)</button>' +
        '<button class="btn line" data-act="logout">로그아웃</button>';
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
      '<label class="f" for="pw">관리자 비밀번호</label><input id="pw" type="password" autocomplete="off">' +
      (state.flash === 'pwError' ? '<div class="err" role="alert">비밀번호가 맞지 않습니다. 다시 입력해 주세요.</div>' : '') +
      '<button class="btn" data-act="login">로그인</button></section>';
  };

  screens.post = function () {
    var h = '<section class="card" style="padding:18px"><div class="f" style="font-weight:700">종류</div><div class="grid3">';
    ['news', 'bulletin', 'event'].forEach(function (k) {
      h += '<button class="chip" data-act="postKind" data-v="' + k + '" aria-pressed="' + (state.postKind === k) + '">' + KIND_NAMES[k] + '</button>';
    });
    h += '</div><label class="f" for="ptitle">제목</label><input id="ptitle" type="text">' +
      '<label class="f" for="pbody">내용</label><textarea id="pbody" placeholder="일정은 날짜와 시간을 함께 적어 주세요."></textarea>' +
      '<label class="check"><input id="ppush" type="checkbox" checked><span>알림 표시하기</span></label>' +
      (state.flash === 'postError' ? '<div class="err" role="alert">제목을 입력해 주세요.</div>' : '') +
      '<button class="btn" data-act="submitPost">올리기</button>' +
      '<div class="muted">지금은 서버가 연결되지 않아, 여기서 올린 글과 알림은 이 휴대폰에서만 보입니다. 모든 성도에게 보이는 글은 data/content.json 파일에 추가해 주세요.</div></section>';
    return h;
  };

  screens.noti = function () {
    if (!state.notis.length) { return '<div class="empty">받은 알림이 없습니다.</div>'; }
    var h = '<div class="stack" style="gap:10px">';
    state.notis.forEach(function (n) { h += '<section class="card" style="gap:2px;padding:14px"><b>' + esc(n.text) + '</b><span class="muted">' + esc(n.time) + '</span></section>'; });
    return h + '</div>';
  };

  function render() {
    $title.textContent = TITLES[state.screen] || '찬양하는교회';
    $back.hidden = TABS.indexOf(state.screen) >= 0;
    $dot.hidden = !state.unread;
    var tabButtons = document.querySelectorAll('#tabs button');
    for (var i = 0; i < tabButtons.length; i++) {
      if (tabButtons[i].getAttribute('data-screen') === state.tab) { tabButtons[i].setAttribute('aria-current', 'page'); }
      else { tabButtons[i].removeAttribute('aria-current'); }
    }
    $view.innerHTML = (screens[state.screen] || screens.home)();
  }

  // ---------- 동작 ----------
  var actions = {
    go: function (el) {
      var extra = {};
      var seg = el.getAttribute('data-seg');
      if (seg) { extra.seg = seg; }
      var screen = el.getAttribute('data-screen');
      if (screen === 'post') { extra.postKind = state.screen === 'news' ? state.seg : 'news'; }
      go(screen, extra);
    },
    back: function () { go(state.backTo || state.tab); },
    sermon: function (el) { go('sermon', { sermonId: el.getAttribute('data-id'), backTo: el.getAttribute('data-back') }); },
    detail: function (el) { go('detail', { postId: el.getAttribute('data-id'), backTo: el.getAttribute('data-back') }); },
    ftype: function (el) { state.fType = el.getAttribute('data-v'); render(); },
    fyear: function (el) { state.fYear = Number(el.getAttribute('data-v')); state.fMonth = 0; render(); },
    fmonth: function (el) { state.fYear = Number(el.getAttribute('data-y')); state.fMonth = Number(el.getAttribute('data-v')); render(); },
    seg: function (el) { state.seg = el.getAttribute('data-v'); render(); },
    postKind: function (el) {
      var t = document.getElementById('ptitle').value, b = document.getElementById('pbody').value;
      state.postKind = el.getAttribute('data-v'); render();
      document.getElementById('ptitle').value = t; document.getElementById('pbody').value = b;
    },
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
    login: function () {
      if (document.getElementById('pw').value === SETTINGS.adminPassword) {
        state.isAdmin = true; store.set('isAdmin', true); go('more');
      } else { state.flash = 'pwError'; render(); document.getElementById('pw').focus(); }
    },
    logout: function () { state.isAdmin = false; store.set('isAdmin', false); render(); },
    submitPost: function () {
      var title = document.getElementById('ptitle').value.trim();
      var body = document.getElementById('pbody').value.trim();
      var push = document.getElementById('ppush').checked;
      if (!title) { state.flash = 'postError'; render(); document.getElementById('pbody').value = body; return; }
      var kind = state.postKind;
      state.myPosts.unshift({ id: 'my-' + Date.now(), kind: kind, title: title, body: body || '(내용 없음)', meta: todayLabel() + ' · 이 휴대폰에서 작성', local: true });
      store.set('myPosts', state.myPosts);
      if (push) {
        var text = '새 ' + KIND_NAMES[kind] + ': ' + title;
        state.notis.unshift({ text: text, time: todayLabel() });
        state.notis = state.notis.slice(0, 30);
        state.unread = true;
        store.set('notis', state.notis); store.set('unread', true);
        showBanner(text);
      }
      go('news', { seg: kind });
    },
    deletePost: function (el) {
      var id = el.getAttribute('data-id');
      state.myPosts = state.myPosts.filter(function (p) { return p.id !== id; });
      store.set('myPosts', state.myPosts); go('news');
    },
    install: function () {
      if (!installEvent) { return; }
      installEvent.prompt();
      installEvent = null;
    }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) { return; }
    var fn = actions[el.getAttribute('data-act')];
    if (fn) { fn(el); }
  });

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); installEvent = e;
    if (state.screen === 'more') { render(); }
  });
  window.addEventListener('appinstalled', function () { installEvent = null; if (state.screen === 'more') { render(); } });

  // ---------- 시작 ----------
  function load() {
    var v = fetch('data/videos.txt').then(function (r) { if (!r.ok) { throw new Error('videos'); } return r.text(); })
      .then(function (t) {
        state.videos = parseVideos(t);
        if (state.videos.length) { state.fYear = state.videos[0].y; state.fMonth = state.videos[0].m; state.sermonId = state.videos[0].id; }
      }).catch(function () { state.loadError = true; });
    var c = fetch('data/content.json').then(function (r) { if (!r.ok) { throw new Error('content'); } return r.json(); })
      .then(function (j) { state.posts = j.posts || []; state.sharedPrayers = j.prayers || []; })
      .catch(function () { /* 소식을 못 받아도 나머지 화면은 그대로 씁니다 */ });
    return Promise.all([v, c]).then(function () { state.loaded = true; render(); });
  }

  render();
  load();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  window.__chanyang = { state: state, go: go, load: load }; // 점검용
})();
