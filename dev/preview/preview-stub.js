/* 미리보기 전용 (앱에는 들어가지 않습니다): 서버(Supabase) 응답을 흉내 냅니다.
   미리보기 서버(dev/preview/serve.mjs)가 index.html 을 내줄 때 이 파일을 끼워 넣습니다.
   그래서 미리보기에서는 실제 서버에 아무것도 보내지 않고, 주소 뒤에 붙인 값으로 상황을 고릅니다.

   디자인      ?theme=bright|warm|classic   서버가 정해 둔 디자인 (없으면 bright)
               ?notheme=1                   3단계 설정 전의 서버
               ?cached=warm                 이 휴대폰이 지난번에 받아 둔 디자인   ·   ?keep=1  받아 둔 값을 지우지 않음
   사람        ?open=1                      승인된 휴대폰 (없으면 승인번호 입력 화면)
               ?admin=1                     관리자로 로그인한 상태
   화면        ?tab=home|sermons|sermon|news|detail|prayer|more|info|login|noti|post|members|design
               ?seg=news|bulletin|event     소식 화면의 갈래   ·   ?post=글번호  자세히 볼 글
   상황        ?posts=0  글 없음   ·   ?note=1  설교 노트 있음   ·   ?outline=1  설교 전체 흐름을 펼치고 설교 부분부터 재생   ·   ?prayers=1  내 기도제목 있음
               ?issue=1  승인번호를 방금 만든 상태   ·   ?files=1  글 올리기에 사진 2장   ·   ?err=1  오류 안내
               ?noinstall=1  "앱 설치하기" 단추가 없는 브라우저

   예: http://127.0.0.1:8765/?theme=warm&open=1&admin=1&tab=design */
(function () {
  var q = new URLSearchParams(location.search);
  var real = window.fetch.bind(window);
  var theme = q.get('theme') || 'bright';
  try { if (q.get('cached')) localStorage.setItem('chanyang.theme', JSON.stringify(q.get('cached'))); else if (!q.get('keep')) localStorage.removeItem('chanyang.theme'); } catch (e) {}
  var POSTS = q.get('posts') === '0' ? [] : [
    { id: 'n-20261117', kind: 'news', title: '찬양하는교회 앱이 준비되었습니다', body: '예배 영상, 주보, 교회 소식, 예배 안내를 앱에서 보실 수 있습니다.\n홈 화면에 추가해 두시면 아이콘을 눌러 바로 열 수 있습니다.', meta: null, images: [], created_at: '2026-11-17T01:00:00+00:00' },
    { id: 'b-20261115', kind: 'bulletin', title: '11월 15일 주보', body: '', meta: null, images: [], created_at: '2026-11-15T03:00:00+00:00' },
    { id: 'e-20261225', kind: 'event', title: '성탄감사예배', body: '시간은 추후 안내드립니다.', meta: '2026년 12월 25일 (금)', images: [], created_at: '2026-11-16T01:00:00+00:00' },
    { id: 'e-20261231', kind: 'event', title: '송구영신예배', body: '시간은 추후 안내드립니다.', meta: '2026년 12월 31일 (목)', images: [], created_at: '2026-11-15T01:00:00+00:00' }
  ];
  var MEMBERS = [
    { id: 'm1', name: '홍길동', state: 'approved', created_at: '2026-11-18T01:00:00+00:00', approved_at: '2026-11-18T02:00:00+00:00', code_expires_at: null, code_waiting: false },
    { id: 'm2', name: '김은혜', state: 'waiting', created_at: '2026-11-18T03:00:00+00:00', approved_at: null, code_expires_at: '2026-11-25T03:00:00+00:00', code_waiting: true },
    { id: 'm3', name: '이소망', state: 'expired', created_at: '2026-11-01T03:00:00+00:00', approved_at: null, code_expires_at: '2026-11-08T03:00:00+00:00', code_waiting: false }
  ];
  function json(body, status) { return Promise.resolve(new Response(JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json' } })); }
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    if (url.indexOf('supabase.co') >= 0) {
      if (url.indexOf('/rest/v1/rpc/gate_status') >= 0) return json({ members_only: true, admin: q.get('admin') === '1', member: q.get('open') === '1', name: q.get('open') === '1' ? '홍길동' : null });
      if (url.indexOf('/rest/v1/rpc/app_theme') >= 0) return q.get('notheme') ? json({ code: 'PGRST202', message: 'Could not find the function public.app_theme' }, 404) : json(theme);
      if (url.indexOf('/rest/v1/rpc/admin_set_theme') >= 0) { try { theme = JSON.parse(init.body).new_theme; } catch (e) {} return json(theme); }
      if (url.indexOf('/rest/v1/rpc/admin_members') >= 0) return json(MEMBERS);
      if (url.indexOf('/rest/v1/rpc/admin_issue_code') >= 0) return json({ id: 'm2', name: '김은혜', code: '48271935', expires_at: '2026-11-25T03:00:00+00:00' });
      if (url.indexOf('/rest/v1/rpc/admin_cleanup') >= 0) return json(null);
      if (url.indexOf('/rest/v1/posts') >= 0) return json(POSTS);
      return json({ code: 'PGRST202', message: 'not found' }, 404);
    }
    return real(input, init);
  };
  if (navigator.serviceWorker) { navigator.serviceWorker.register = function () { return Promise.resolve({ addEventListener: function () {} }); }; }
  window.addEventListener('load', function () {
    var c = window.__chanyang; if (!c) return;
    try { var ev = new Event('beforeinstallprompt'); ev.prompt = function () {}; ev.userChoice = Promise.resolve({ outcome: 'dismissed' }); if (!q.get('noinstall')) window.dispatchEvent(ev); } catch (e) {}
    Promise.resolve(c.ready).then(function () { setTimeout(function () {
      if (q.get('admin') === '1') { c.state.admin = { email: 'admin@church.kr' }; }
      if (q.get('note')) { c.state.notes[c.state.sermonId] = '오늘 말씀: 찬양은 호흡이 있는 동안 계속되는 고백이다.'; }
      if (q.get('outline')) { c.state.outlineOpen = true; var sm = c.state.sermonData && c.state.sermonData.byId[c.state.sermonId]; if (sm) { c.state.playFrom = String(sm.start).split(':').reduce(function (n, x) { return n * 60 + Number(x); }, 0); } }
      if (q.get('prayers')) { c.state.myPrayers = [{ id: 'my-1', text: '가족의 건강과 이번 주 예배를 위해', meta: '11월 18일' }]; c.state.prayed = { 'p-1': true }; }
      if (q.get('tab')) { var extra = {}; if (q.get('seg')) extra.seg = q.get('seg'); if (q.get('post')) extra.postId = q.get('post'); c.go(q.get('tab'), extra); } else { c.go(c.state.screen); }
      if (q.get('issue')) { setTimeout(function () { var b = document.querySelector('[data-act=reissue]'); if (b) b.click(); }, 150); }
      if (q.get('files')) { c.state.postFiles = [{ name: '주보-1쪽.jpg' }, { name: '주보-2쪽.jpg' }]; c.state.draft = { kind: 'bulletin', title: '11월 22일 주보', meta: '', body: '' }; c.go('post'); }
      if (q.get('err')) { c.state.flashText = '서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.'; c.go(c.state.screen); c.state.flashText = '서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.'; }
    }, 100); });
  });
})();
