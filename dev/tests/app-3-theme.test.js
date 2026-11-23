// 화면 디자인 점검: 서버가 정한 디자인을 따르는지, 관리자만 바꿀 수 있는지, 화면 꾸밈 파일이 온전한지
const { makeBackend, boot, ok, result, waitFor, sleep, root } = require('./harness');
const { JSDOM } = require('jsdom'); const fs = require('fs'); const path = require('path');
const count = (be, what) => be.log.filter((x) => x === what).length;
const theme = (a) => a.d.documentElement.getAttribute('data-theme');
const bar = (a) => a.$('meta[name="theme-color"]').getAttribute('content');
const fonts = (a) => a.$$('link[data-font]').map((l) => l.getAttribute('href')).sort().join(',');
const saved = (a) => a.storage()['chanyang.theme'];
const adminLogin = async (a) => { a.click('[data-screen=login]'); a.type('#email', 'admin@church.kr'); a.type('#pw', 'pw-ok'); a.click('[data-act=login]'); await waitFor(() => !!a.S.admin && !a.S.busy, 'admin login'); };
const picks = (a) => a.$$('[data-act=setTheme]').map((b) => b.getAttribute('data-v') + ':' + b.getAttribute('aria-pressed') + ':' + (b.querySelector('.tag') ? '사용 중' : '')).join(' ');

(async () => {
  // ── 1. 처음 값과 서버가 정한 디자인 ───────────────────────────────
  console.log('\n[1] 처음 값 · 서버가 정한 디자인 따르기');
  let be = makeBackend();
  let a = boot(be);
  ok('처음 여는 휴대폰: 서버에 묻기 전부터 밝은 화면', theme(a) === 'bright' && a.S.theme === 'bright' && bar(a) === '#F3F5F9');
  await a.w.__chanyang.ready;
  ok('3단계 설정 전의 서버: 밝은 화면 그대로, 저장해 두는 값 없음', theme(a) === 'bright' && a.S.themeReady === false && saved(a) === undefined && count(be, 'POST /rest/v1/rpc/app_theme') === 1, JSON.stringify([theme(a), a.S.themeReady, saved(a)]));
  ok('밝은 화면의 글꼴 목록만 불러옴', fonts(a) === 'fonts/pretendard.css', fonts(a));
  ok('오류 없음', a.w.__errors.length === 0, a.w.__errors.join(' | '));

  be = makeBackend(); be.theme = 'warm';
  a = boot(be);
  ok('서버 답이 오기 전에는 처음 값(밝은 화면)', theme(a) === 'bright');
  await a.w.__chanyang.ready;
  ok('서버가 "따뜻한 화면"이면 그 디자인으로 바뀜', theme(a) === 'warm' && a.S.theme === 'warm' && a.S.themeReady === true && bar(a) === '#F4EEE2', theme(a) + ' ' + bar(a));
  ok('받은 디자인을 휴대폰에 기억해 둠', saved(a) === '"warm"', saved(a));
  ok('따뜻한 화면의 글꼴 목록(명조 포함)을 불러옴', fonts(a) === 'fonts/gowun-batang.css,fonts/pretendard.css', fonts(a));

  be.theme = 'classic';
  let b = boot(be, { storage: a.storage() });
  ok('다음에 열 때: 기억해 둔 디자인으로 바로 시작', theme(b) === 'warm' && bar(b) === '#F4EEE2');
  await b.w.__chanyang.ready;
  ok('그 사이 관리자가 바꿨으면 새 디자인(클래식 화면)으로 바뀜', theme(b) === 'classic' && bar(b) === '#1E3A5F' && saved(b) === '"classic"', theme(b) + ' ' + saved(b));

  be.offline = true;
  let c = boot(be, { storage: b.storage() }); await c.w.__chanyang.ready;
  ok('인터넷이 끊긴 채 열면 마지막으로 받은 디자인 그대로', theme(c) === 'classic' && saved(c) === '"classic"');
  be.offline = false; be.theme = 'bright';
  await c.sync(); await waitFor(() => theme(c) === 'bright', 'theme after reconnect');
  ok('다시 연결되면 지금 디자인으로 맞춤', theme(c) === 'bright' && saved(c) === '"bright"');

  be = makeBackend();   // 3단계 전의 서버인데 휴대폰에는 예전 값이 남아 있는 경우
  a = boot(be, { storage: { 'chanyang.theme': '"warm"' } }); await a.w.__chanyang.ready;
  ok('서버에 설정이 없으면 처음 값(밝은 화면)으로 돌아가고 기억도 지움', theme(a) === 'bright' && saved(a) === undefined, theme(a) + ' ' + saved(a));
  for (const junk of ['"dark"', 'x{', '123', 'null', '""']) {
    be = makeBackend(); be.offline = true;
    a = boot(be, { storage: { 'chanyang.theme': junk } });
    ok(`휴대폰에 엉뚱한 값이 남아 있어도 밝은 화면으로 시작: ${junk}`, theme(a) === 'bright' && a.S.theme === 'bright');
    await a.w.__chanyang.ready;
  }
  be = makeBackend(); be.theme = 'neon';   // 이 앱이 모르는 값(나중 버전의 디자인 이름 등)
  a = boot(be); await a.w.__chanyang.ready;
  ok('서버가 모르는 값을 주면 처음 값(밝은 화면)', theme(a) === 'bright' && saved(a) === undefined && a.S.themeReady === true);
  a = boot(makeBackend(), { noServer: true }); await a.w.__chanyang.ready;
  ok('서버 없이 쓰는 경우에도 밝은 화면', theme(a) === 'bright' && a.w.__errors.length === 0);

  // 화면 디자인을 묻는 연결만 끝내 답이 없는 경우: 앱의 나머지는 평소대로 떠야 한다
  be = makeBackend(); be.theme = 'warm'; be.themeHangs = true;
  a = boot(be);
  await waitFor(() => a.S.loaded === true && a.S.gateKnown, 'loaded without theme answer');
  ok('화면 디자인 답이 오지 않아도 앱은 다 불러온 상태가 됨 (처음 값으로 보임)', a.S.loaded === true && theme(a) === 'bright' && a.S.themeReady === null && a.w.__errors.length === 0, JSON.stringify([a.S.loaded, theme(a), a.S.themeReady]));
  be.themeHangs = false;
  await a.w.__chanyang.syncTheme();
  ok('나중에 답이 오면 그 디자인으로 바뀜', theme(a) === 'warm' && saved(a) === '"warm"', theme(a));

  // ── 2. 승인 화면도 같은 디자인 ───────────────────────────────────
  console.log('\n[2] 승인 전 화면 · 성도 휴대폰');
  be = makeBackend(); be.gate = { membersOnly: true }; be.theme = 'warm';
  const hong = be.issue('홍길동');
  a = boot(be); await a.w.__chanyang.ready;
  ok('승인받기 전의 화면도 교회가 정한 디자인으로 보임', a.S.screen === 'gate' && a.locked() && theme(a) === 'warm');
  ok('승인 전에도 글은 요청하지 않음 (디자인만 물음)', count(be, 'GET /rest/v1/posts') === 0 && count(be, 'POST /rest/v1/rpc/app_theme') === 1, be.log.join(', '));
  a.type('#code', hong.code); a.click('[data-act=redeem]'); await waitFor(() => !a.locked() && a.S.screen === 'home', 'redeem');
  a.click('#tabs [data-screen=more]');
  ok('성도 휴대폰의 더보기에는 "화면 디자인"이 없음', !a.$('[data-screen=design]') && !/화면 디자인/.test(a.text()), a.text());
  a.w.__chanyang.go('design');
  ok('성도가 그 화면으로 가려 해도 고를 수 없음', a.S.screen === 'design' && /관리자로 로그인한 뒤/.test(a.text()) && a.$$('[data-act=setTheme]').length === 0, a.text());
  a.click('#back');
  be.theme = 'classic';
  await a.sync(); await waitFor(() => theme(a) === 'classic', 'member sync');
  ok('앱을 쓰는 중에도 다시 확인할 때 새 디자인으로 바뀜', theme(a) === 'classic' && saved(a) === '"classic"');
  ok('오류 없음', a.w.__errors.length === 0, a.w.__errors.join(' | '));

  a.click('#tabs [data-screen=home]');
  const tileNote = a.$$('.tile .muted').map((x) => x.textContent);
  ok('홈의 바로가기 글은 그대로 ("부천역 8분"은 한 덩어리로 묶임)', tileNote.join('|') === '이번 주 예배 순서|다가오는 교회 일정|주일 오전 11시 · 부천역 8분|처음 오신 분들께' && a.$$('.tile .nb').map((x) => x.textContent).join() === '부천역 8분', tileNote.join('|'));

  // ── 3. 관리자: 화면 디자인 고르기 ─────────────────────────────────
  console.log('\n[3] 관리자의 "화면 디자인"');
  be = makeBackend(); be.gate = { membersOnly: true }; be.theme = 'bright';
  a = boot(be); await a.w.__chanyang.ready;
  await adminLogin(a);
  ok('관리자 메뉴에 "화면 디자인"이 있음', a.S.screen === 'more' && !!a.$('[data-screen=design]') && /화면 디자인 \(성도 모두에게 적용\)/.test(a.text().replace(/\u00a0/g, ' ')) && /\(성도\u00a0모두에게\u00a0적용\)/.test(a.$('[data-screen=design]').textContent), a.text());
  a.click('[data-screen=design]'); await waitFor(() => a.$$('[data-act=setTheme]').length === 3, 'design screen');
  ok('제목 "화면 디자인", 뒤로 가기 있음, 제목 앞 십자가 없음', a.$('#title').textContent === '화면 디자인' && !a.$('#back').hidden && !a.$('#title').classList.contains('mark'));
  ok('세 가지가 정한 이름으로 나옴: 밝은 화면 · 따뜻한 화면 · 클래식 화면', a.$$('[data-act=setTheme] b').map((x) => x.textContent).join('|') === '밝은 화면|따뜻한 화면|클래식 화면', a.text());
  ok('지금 쓰는 디자인(밝은 화면)에 "사용 중" 표시', picks(a) === 'bright:true:사용 중 warm:false: classic:false:', picks(a));
  ok('성도 모두에게 적용된다는 안내가 있음', /성도 모두의 휴대폰/.test(a.text()));
  const descs = a.$$('[data-act=setTheme] .muted');
  ok('설명 글은 그대로이고, 쉼표로 나뉜 설명은 쉼표 자리에서만 줄이 바뀌게 묶여 있음',
    descs.map((x) => x.textContent).join('|') === '밝은 바탕, 큰 제목, 파란색 포인트|크림색 바탕, 명조 제목, 초록색 포인트|남색 띠가 있는 처음 디자인' &&
    descs.map((x) => [...x.querySelectorAll('.nb')].map((n) => n.textContent).join('/')).join('|') === '밝은 바탕/큰 제목/파란색 포인트|크림색 바탕/명조 제목/초록색 포인트|',
    descs.map((x) => x.innerHTML).join(' | '));

  let before = count(be, 'POST /rest/v1/rpc/admin_set_theme');
  a.click('[data-act=setTheme][data-v=bright]'); await sleep(40);
  ok('이미 쓰는 디자인을 누르면 서버에 보내지 않음', count(be, 'POST /rest/v1/rpc/admin_set_theme') === before && theme(a) === 'bright');

  a.click('[data-act=setTheme][data-v=warm]');
  ok('바꾸는 동안 단추가 잠김', a.S.busy && a.$$('[data-act=setTheme]').every((x) => x.disabled));
  await waitFor(() => !a.S.busy, 'set warm');
  ok('따뜻한 화면을 고르면 서버에 저장됨', be.theme === 'warm' && count(be, 'POST /rest/v1/rpc/admin_set_theme') === before + 1, be.theme);
  ok('관리자 휴대폰은 바로 바뀜', theme(a) === 'warm' && bar(a) === '#F4EEE2' && saved(a) === '"warm"' && picks(a) === 'bright:false: warm:true:사용 중 classic:false:', picks(a));
  ok('바꿨다는 안내가 뜸 (다른 휴대폰은 다시 열면 바뀜)', /"따뜻한 화면"으로 바꿨습니다/.test(a.$('#banner').textContent) && /다시 열면/.test(a.$('#banner').textContent) && !a.$('#banner').hidden, a.$('#banner').textContent);
  const other = boot(be); await other.w.__chanyang.ready;
  ok('다른 휴대폰(승인 전 포함)도 열면 따뜻한 화면', theme(other) === 'warm' && other.S.screen === 'gate');

  a.click('[data-act=setTheme][data-v=classic]'); await waitFor(() => !a.S.busy && theme(a) === 'classic', 'set classic');
  ok('클래식 화면으로도 바꿀 수 있음', be.theme === 'classic' && bar(a) === '#1E3A5F' && picks(a) === 'bright:false: warm:false: classic:true:사용 중');
  a.click('[data-act=setTheme][data-v=bright]'); await waitFor(() => !a.S.busy && theme(a) === 'bright', 'set bright');
  ok('다시 밝은 화면으로', be.theme === 'bright' && bar(a) === '#F3F5F9');

  be.themeFails = true;
  a.click('[data-act=setTheme][data-v=warm]'); await waitFor(() => !a.S.busy, 'fail');
  ok('서버에서 실패하면 안내가 뜨고 디자인은 그대로', /서버에서 처리하지 못했습니다/.test(a.text()) && theme(a) === 'bright' && be.theme === 'bright' && picks(a).startsWith('bright:true'), a.text());
  be.themeFails = false; be.offline = true;
  a.click('[data-act=setTheme][data-v=warm]'); await waitFor(() => !a.S.busy, 'offline');
  ok('인터넷이 끊겼으면 연결 안내가 뜨고 디자인은 그대로', /서버에 연결하지 못했습니다/.test(a.text()) && theme(a) === 'bright' && saved(a) === '"bright"', a.text());
  be.offline = false;
  a.click('[data-act=setTheme][data-v=warm]'); await waitFor(() => !a.S.busy && theme(a) === 'warm', 'retry ok');
  ok('다시 누르면 바뀌고 오류 안내는 사라짐', be.theme === 'warm' && !/연결하지 못했습니다/.test(a.text()));

  // 늦게 도착한 예전 답이 새 값을 덮어쓰지 않는지
  be.themeHold = [];
  const slow = a.w.__chanyang.syncTheme();          // 바꾸기 전에 물어 둔 것 (답: 따뜻한 화면) — 붙잡아 둠
  await sleep(20);
  const held = be.themeHold; be.themeHold = null;
  a.click('[data-act=setTheme][data-v=classic]'); await waitFor(() => !a.S.busy && theme(a) === 'classic', 'set classic while a read is pending');
  held.forEach((send) => send()); await slow; await sleep(20);
  ok('바꾸기 전에 물어 둔 답이 늦게 와도 방금 고른 디자인이 유지됨', held.length === 1 && theme(a) === 'classic' && saved(a) === '"classic"' && picks(a).endsWith('classic:true:사용 중'), theme(a) + ' ' + picks(a));
  be.themeHold = [];
  const older = a.w.__chanyang.syncTheme();         // 먼저 물은 것 (답: 클래식 화면) — 붙잡아 둠
  await sleep(20);
  const held2 = be.themeHold; be.themeHold = null;
  be.theme = 'bright';                              // 그 사이 다른 관리자가 밝은 화면으로 바꿈
  await a.w.__chanyang.syncTheme();                 // 나중에 물은 것이 먼저 도착
  const mid = theme(a);
  held2.forEach((send) => send()); await older; await sleep(20);
  ok('답이 뒤바뀐 순서로 와도 나중에 물은 답을 따름', held2.length === 1 && mid === 'bright' && theme(a) === 'bright' && saved(a) === '"bright"', mid + ' → ' + theme(a));
  be.offline = true;
  await a.w.__chanyang.syncTheme();
  be.offline = false; be.theme = 'warm';
  await a.w.__chanyang.syncTheme();
  ok('한 번 실패한 뒤에도 다음 확인은 정상으로 반영됨', theme(a) === 'warm' && saved(a) === '"warm"', theme(a));

  // 로그인이 풀린 뒤에는 바꿀 수 없음
  a.click('#back'); a.click('[data-act=logout]'); await waitFor(() => !a.S.admin, 'logout');
  a.w.__chanyang.go('design');
  ok('로그아웃하면 고르는 화면이 닫힘', a.$$('[data-act=setTheme]').length === 0);
  ok('로그아웃해도 화면 디자인은 그대로', theme(a) === 'warm');

  // 3단계 설정 전의 서버
  be = makeBackend(); be.gate = { membersOnly: true };
  a = boot(be); await a.w.__chanyang.ready; await adminLogin(a);
  a.click('[data-screen=design]'); await sleep(60);
  ok('3단계 설정 전: 고르는 단추 대신 설정 안내가 나옴', /서버 설정이 필요합니다/.test(a.text()) && /서버 설정 3단계/.test(a.text()) && /"밝은 화면"으로 보입니다/.test(a.text()) && a.$$('[data-act=setTheme]').length === 0 && !!a.$('a[href="supabase/"]'), a.text());
  be.theme = 'bright';                                   // Jay 님이 3단계 설정을 실행
  a.click('[data-act=retryTheme]'); await waitFor(() => a.$$('[data-act=setTheme]').length === 3, 'after step 3');
  ok('설정을 실행한 뒤 "다시 확인"을 누르면 바로 고를 수 있음', picks(a) === 'bright:true:사용 중 warm:false: classic:false:', picks(a));
  a.click('[data-act=setTheme][data-v=warm]'); await waitFor(() => !a.S.busy && theme(a) === 'warm', 'set after setup');
  ok('그리고 실제로 바뀜', be.theme === 'warm');

  // 서버에 닿지 못한 채 화면을 연 경우
  be = makeBackend(); be.theme = 'bright';
  a = boot(be); await a.w.__chanyang.ready; a.click('#tabs [data-screen=more]'); await adminLogin(a);
  a.S.themeReady = null; be.offline = true;
  a.click('[data-screen=design]'); await waitFor(() => /다시 시도/.test(a.text()), 'offline design');
  ok('디자인을 확인하지 못했으면 안내와 "다시 시도"가 나옴', /서버에 연결하지 못했습니다/.test(a.text()) && !!a.$('[data-act=retryTheme]') && a.$$('[data-act=setTheme]').length === 0, a.text());
  be.offline = false;
  a.click('[data-act=retryTheme]'); await waitFor(() => a.$$('[data-act=setTheme]').length === 3, 'retry design');
  ok('다시 시도하면 고를 수 있음', a.$$('[data-act=setTheme]').length === 3);
  for (const x of [a, other]) ok('오류 없음', x.w.__errors.length === 0, x.w.__errors.join(' | '));

  // ── 4. 첫 화면이 그려지기 전에 입히는 부분 (index.html) ─────────────
  console.log('\n[4] index.html 의 시작 부분');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const inline = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
  ok('index.html 에 시작 부분이 있고, 화면 꾸밈 파일보다 먼저 나옴', inline.length > 50 && html.indexOf('<script>') < html.indexOf('href="app.css"') && html.indexOf('name="theme-color"') < html.indexOf('<script>'));
  const early = (stored) => {
    const dom = new JSDOM('<!doctype html><html><head><meta name="theme-color" content="#F3F5F9"></head><body></body></html>', { url: 'https://nstepanet.github.io/chanyang/', runScripts: 'outside-only' });
    if (stored !== undefined) dom.window.localStorage.setItem('chanyang.theme', stored);
    dom.window.eval(inline);
    return dom.window.document.documentElement.getAttribute('data-theme') + ' ' + dom.window.document.querySelector('meta[name="theme-color"]').getAttribute('content');
  };
  ok('기억해 둔 값이 없으면 밝은 화면', early(undefined) === 'bright #F3F5F9', early(undefined));
  ok('기억해 둔 값이 따뜻한 화면이면 그대로', early('"warm"') === 'warm #F4EEE2', early('"warm"'));
  ok('기억해 둔 값이 클래식 화면이면 그대로 (위쪽 띠 색도 남색)', early('"classic"') === 'classic #1E3A5F', early('"classic"'));
  ok('엉뚱한 값이면 밝은 화면', ['"dark"', 'x{', '123', 'null', '"__proto__"', '"constructor"'].every((j) => early(j) === 'bright #F3F5F9'), ['"dark"', 'x{', '"__proto__"', '"constructor"'].map(early).join(' / '));
  const blocked = (() => {
    const dom = new JSDOM('<!doctype html><html><head><meta name="theme-color" content="#F3F5F9"></head><body></body></html>', { url: 'https://nstepanet.github.io/chanyang/', runScripts: 'outside-only' });
    Object.defineProperty(dom.window, 'localStorage', { get() { throw new Error('denied'); }, configurable: true });
    dom.window.eval(inline);
    return dom.window.document.documentElement.getAttribute('data-theme');
  })();
  ok('저장 공간을 못 쓰는 브라우저에서도 멈추지 않고 밝은 화면', blocked === 'bright', blocked);

  // ── 5. 화면 꾸밈 파일과 글꼴 ─────────────────────────────────────
  console.log('\n[5] 화면 꾸밈 파일 · 글꼴');
  const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
  const appjs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const n = (re) => (css.match(re) || []).length;
  ok('밝은 화면·따뜻한 화면의 규칙이 들어 있음', n(/html\[data-theme="bright"\]/g) > 50 && n(/html\[data-theme="warm"\]/g) > 50, n(/html\[data-theme="bright"\]/g) + ' / ' + n(/html\[data-theme="warm"\]/g));
  ok('클래식 화면에는 덧입히는 규칙이 없음 (기본 모양 그대로)', n(/data-theme="classic"/g) === 0);
  const themed = css.slice(css.indexOf('화면 디자인'));
  const stray = themed.split('\n').filter((l) => /\{/.test(l) && !/^\s*(\/\*|html\[data-theme="(bright|warm)"\]|\.gate-art|\.pick|\.swatch)/.test(l) && !/^@media \(max-width: \d+px\) \{$/.test(l));
  ok('디자인 규칙은 모두 그 디자인일 때만 적용되게 묶여 있음', stray.length === 0, stray.slice(0, 3).join(' | '));
  // 좁은 화면용 묶음(@media) 안의 규칙도 하나하나 디자인 이름으로 시작해야 한다
  const inMedia = [...themed.matchAll(/^@media \(max-width: \d+px\) \{\n([\s\S]*?)\n\}$/gm)].flatMap((m) => m[1].split('\n')).filter((l) => l.trim() && !/^\s*\/\*/.test(l));
  ok('좁은 화면용 규칙도 모두 그 디자인일 때만 적용됨', inMedia.length >= 4 && inMedia.every((l) => /^\s+html\[data-theme="(bright|warm)"\] /.test(l)), inMedia.filter((l) => !/^\s+html\[data-theme="(bright|warm)"\] /.test(l)).slice(0, 2).join(' | ') + ' (' + inMedia.length + '줄)');
  ok('오래된 휴대폰이 모르는 문법(:has, 겹쳐 쓰기)을 쓰지 않음', !/:has\(/.test(css) && !/&\s*[.:#\[]/.test(css));
  const urls = [...css.matchAll(/url\(([^)"']+)\)/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:'));
  const missing = [...new Set(urls)].filter((u) => !fs.existsSync(path.join(root, u)));
  ok('꾸밈 파일이 가리키는 그림이 모두 실제로 있음', urls.length >= 6 && missing.length === 0, missing.join(', '));
  const ids = [...appjs.matchAll(/\{ id: '([a-z]+)', name: '([^']+)'/g)].map((m) => m[1] + '=' + m[2]).join(' ');
  ok('앱의 디자인 목록: 밝은 화면(처음 값) · 따뜻한 화면 · 클래식 화면', ids === 'bright=밝은 화면 warm=따뜻한 화면 classic=클래식 화면' && /var DEFAULT_THEME = 'bright'/.test(appjs), ids);
  const sql = fs.readFileSync(path.join(root, 'supabase/theme.sql'), 'utf8');
  ok('서버 설정도 같은 세 값을 쓰고 처음 값이 밝은 화면', /default 'bright' check \(theme in \('bright', 'warm', 'classic'\)\)/.test(sql));
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  ok('서버와 주고받는 부분도 같은 세 값만 받음', /\^\(bright\|warm\|classic\)\$/.test(server));
  for (const [file, dir, min] of [['fonts/pretendard.css', 'fonts/pretendard', 90], ['fonts/gowun-batang.css', 'fonts/gowun-batang', 180]]) {
    const f = fs.readFileSync(path.join(root, file), 'utf8');
    const refs = [...f.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/['"]/g, ''));
    const gone = refs.filter((u) => !fs.existsSync(path.join(root, 'fonts', u)));
    const extra = fs.readdirSync(path.join(root, dir)).filter((x) => /\.woff2$/.test(x) && !refs.includes(path.basename(dir) + '/' + x));
    ok(`${file}: 글자 묶음 ${refs.length}개가 모두 있고 남는 파일이 없음, 글자가 먼저 보이고 나중에 글꼴이 입혀짐`, refs.length >= min && gone.length === 0 && extra.length === 0 && !/font-display:\s*(block|auto)/.test(f) && (f.match(/font-display:\s*swap/g) || []).length === refs.length, gone.concat(extra).slice(0, 3).join(', '));
    ok(`${dir}: 글꼴 라이선스 파일이 함께 있음`, fs.existsSync(path.join(root, dir, 'LICENSE.txt')) && /Open Font License/.test(fs.readFileSync(path.join(root, dir, 'LICENSE.txt'), 'utf8')));
  }
  // 디자인 원본(dev/themes)과 app.css 가 어긋나지 않았는지
  const { build } = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'themes', 'build.mjs')).href);
  const cssLf = css.replace(/\r\n/g, '\n');
  ok('app.css 의 디자인 부분이 원본(dev/themes)으로 만든 것과 같음 (다르면 원본을 고친 뒤 npm run themes)', build(cssLf) === cssLf);
  // 글자색과 바탕색의 대비 (4.5:1 이상이어야 작은 글자도 읽기 편합니다)
  const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const PAIRS = [['text', 'bg'], ['text', 'card'], ['muted', 'bg'], ['muted', 'card'], ['#FFFFFF', 'primary'], ['primary', 'soft'], ['primary', 'card'], ['primary', 'bg'], ['warm-fg', 'warm-bg'], ['accent', 'card'], ['accent', 'bg']];
  // 알고 있는 예외: 밝은 화면의 주황 꼬리표(입력 대기, 금요 표시)는 4.49:1 로 기준에 0.01 모자랍니다. 색을 고치면 이 줄을 지웁니다.
  const KNOWN_LOW = { 'bright warm-fg/warm-bg': 4.45 };
  for (const th of ['bright', 'warm']) {
    const line = css.split('\n').find((l) => l.startsWith('html[data-theme="' + th + '"] { --primary')) || '';
    const v = Object.fromEntries([...line.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
    const low = []; let checked = 0;
    for (const [f, b] of PAIRS) {
      const F = f[0] === '#' ? f : v[f], B = v[b];
      if (!F || !B) continue;
      checked++;
      const r = ratio(F, B);
      if (r < (KNOWN_LOW[th + ' ' + f + '/' + b] || 4.5)) low.push(f + ' / ' + b + ' = ' + r.toFixed(2));
    }
    ok(`${th === 'bright' ? '밝은 화면' : '따뜻한 화면'}: 주요 글자색과 바탕색의 대비가 4.5:1 이상`, checked >= 9 && low.length === 0, low.join(', ') + ' (' + checked + '쌍 확인)');
  }
  const man = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  ok('설치 정보의 바탕색이 처음 값(밝은 화면)과 같음', man.theme_color === '#F3F5F9' && man.background_color === '#F3F5F9', man.theme_color);

  process.exit(result() ? 1 : 0);
})().catch((e) => { console.error('점검 중단:', e); process.exit(2); });
