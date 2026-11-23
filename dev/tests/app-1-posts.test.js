// 1단계 기능 점검: 글 올리기 공유, 관리자 로그인, 주보 사진 (성도 승인을 쓰기 전의 서버)
const { makeBackend, boot, ok, result, waitFor, SB } = require('./harness');

(async () => {
  // ── 1. 서버 설정(SQL) 실행 전 ─────────────────────────────────────────
  console.log('\n[1] 서버에 표가 아직 없을 때');
  let be = makeBackend(); be.noTables = true;
  let a = boot(be); await a.w.__chanyang.ready;
  ok('기본 글(파일)로 화면이 뜸', a.S.postsFrom === 'file' && a.S.posts.length === 3, a.S.postsFrom + ' ' + a.S.posts.length);
  a.click('#tabs [data-screen=news]');
  ok('"연결 안 됨" 안내를 띄우지 않음', !/연결되지 않아/.test(a.text()), a.text());
  a.click('#tabs [data-screen=more]'); a.click('[data-screen=login]');
  a.type('#email', 'admin@church.kr'); a.type('#pw', 'pw-ok'); a.click('[data-act=login]');
  await waitFor(() => !a.S.busy, 'login');
  ok('로그인 시 "설정이 끝나지 않았습니다" 안내', /서버 설정이 아직 끝나지 않았습니다/.test(a.text()), a.text());
  ok('오류 없이 동작', a.w.__errors.length === 0, a.w.__errors.join(' | '));

  // ── 2. 정상 동작 ───────────────────────────────────────────────────
  console.log('\n[2] 서버 연결됨 · 성도 화면');
  be = makeBackend(); a = boot(be); await a.w.__chanyang.ready;
  ok('서버 글 3개를 받아 옴', a.S.postsFrom === 'server' && a.S.posts.length === 3);
  ok('영상 844개도 그대로', a.S.videos.length === 844);
  ok('홈에 소식이 보임', /찬양하는교회 앱이 준비되었습니다/.test(a.text()));
  ok('처음에는 새 글 표시 없음', a.$('#dot').hidden === true);
  a.click('#tabs [data-screen=news]'); a.click('[data-act=seg][data-v=event]');
  ok('일정 2개, 날짜 표시', a.$$('#view .item').length === 2 && /2026년 12월 31일 \(목\)/.test(a.text()), a.text());
  ok('성도에게는 글 올리기 단추가 없음', !a.$('#view [data-screen=post]'));
  a.click('#view .item');
  ok('글 상세: 지우기 단추 없음', /시간은 추후 안내드립니다/.test(a.text()) && !a.$('[data-act=deletePost]'));
  a.click('#tabs [data-screen=more]');
  ok('더보기에 관리자 로그인이 보임', !!a.$('[data-screen=login]') && !/1234/.test(a.d.body.innerHTML));

  console.log('\n[3] 관리자 로그인');
  a.click('[data-screen=login]'); a.click('[data-act=login]');
  ok('빈칸이면 안내', /모두 입력/.test(a.text()));
  a.type('#email', 'admin@church.kr'); a.type('#pw', 'wrong'); a.click('[data-act=login]'); await waitFor(() => !a.S.busy, 'bad login');
  ok('비밀번호 틀림 안내', /이메일 또는 비밀번호가 맞지 않습니다/.test(a.text()) && !a.S.admin, a.text());
  ok('틀린 뒤에도 이메일은 남아 있음', a.$('#email').value === 'admin@church.kr');
  a.type('#email', 'member@x.com'); a.type('#pw', 'pw-ok'); a.click('[data-act=login]'); await waitFor(() => !a.S.busy, 'member login');
  ok('관리자가 아닌 계정은 거절', /관리자로 등록되지 않은 계정/.test(a.text()) && !a.S.admin, a.text());
  ok('거절된 계정은 로그아웃 처리됨', be.log.includes('POST /auth/v1/logout'), be.log.slice(-4).join(', '));
  a.type('#email', 'admin@church.kr'); a.type('#pw', 'pw-ok'); a.click('[data-act=login]'); await waitFor(() => !!a.S.admin, 'admin login');
  ok('관리자 로그인 성공 → 더보기에 관리자 메뉴', a.S.screen === 'more' && /관리자로 로그인되어 있습니다/.test(a.text()) && /admin@church\.kr/.test(a.text()), a.text());

  console.log('\n[4] 글 올리기 (주보 + 사진 2장)');
  a.click('#tabs [data-screen=news]'); a.click('[data-act=seg][data-v=bulletin]'); a.click('#view [data-screen=post]');
  ok('주보 탭에서 열면 종류가 주보로 선택됨', a.$('[data-act=postKind][data-v=bulletin]').getAttribute('aria-pressed') === 'true');
  a.click('[data-act=submitPost]');
  ok('제목 없으면 안내', /제목을 입력/.test(a.text()));
  a.type('#ptitle', '11월 22일 주보'); a.click('[data-act=submitPost]');
  ok('내용도 사진도 없으면 안내', /내용을 적거나 사진을/.test(a.text()));
  a.click('[data-act=postKind][data-v=event]');
  ok('종류를 바꿔도 제목 유지 + 일정에는 날짜 칸', a.$('#ptitle').value === '11월 22일 주보' && !!a.$('#pmeta'));
  a.click('[data-act=postKind][data-v=bulletin]');
  ok('주보에는 날짜 칸 없음', !a.$('#pmeta'));
  a.pick(['1쪽.jpg', '2쪽.jpg']);
  ok('고른 사진 2장이 목록에 보임', a.$$('.file-row').length === 2 && /1\. 1쪽\.jpg/.test(a.text()) && /사진 \(2\/8\)/.test(a.text()), a.text());
  a.pick(['3쪽.jpg']); a.click(a.$$('[data-act=removeFile]')[2]);
  ok('사진 추가 후 빼기 가능', a.$$('.file-row').length === 2);
  const logStart = be.log.length;
  a.click('[data-act=submitPost]');
  ok('올리는 동안 단추가 잠김', a.S.busy && a.$('[data-act=submitPost]').disabled);
  await waitFor(() => !a.S.busy && a.S.screen === 'news', 'post');
  const made = be.posts.find((x) => x.title === '11월 22일 주보');
  ok('서버에 글이 저장됨 (사진 경로 2개, 작성자 기록)', !!made && made.kind === 'bulletin' && made.images.length === 2 && made.created_by === be.users[0].id, JSON.stringify(made));
  ok('사진 2장이 저장 공간에 올라감 (JPEG)', made && made.images.every((k) => be.objects[k] && /image\/jpeg/.test(be.objects[k].type)) && /^[0-9a-f-]{36}\/1\.jpg$/.test(made.images[0]), JSON.stringify(be.objects));
  ok('요청 순서: 사진 → 사진 → 글 → 목록', be.log.slice(logStart).join(' | ').replace(/[0-9a-f-]{36}/g, 'ID') === 'POST /storage/v1/object/post-images/ID/1.jpg | POST /storage/v1/object/post-images/ID/2.jpg | POST /rest/v1/posts | GET /rest/v1/posts', be.log.slice(logStart).join(' | '));
  ok('주보 목록에 새 글 + "사진 2장"', a.S.seg === 'bulletin' && /11월 22일 주보/.test(a.text()) && /사진 2장/.test(a.text()), a.text());
  ok('올렸다는 안내가 뜸', !a.$('#banner').hidden && /글을 올렸습니다/.test(a.$('#banner').textContent));
  ok('내가 올린 글은 새 글 표시에 안 잡힘', a.$('#dot').hidden === true);
  a.click('#view .item');
  const imgs = a.$$('.shot img').map((i) => i.getAttribute('src'));
  ok('상세 화면에 사진 2장 (공개 주소)', imgs.length === 2 && imgs[0] === SB + '/storage/v1/object/public/post-images/' + made.images[0], imgs.join(' , '));
  a.click('#back'); a.click('#view [data-screen=post]');
  ok('올린 뒤에는 글쓰기 칸이 비워짐', a.$('#ptitle').value === '' && a.$$('.file-row').length === 0);

  console.log('\n[5] 일정 올리기 · 글 지우기 · 백업');
  a.click('[data-act=postKind][data-v=event]'); a.type('#ptitle', '새벽기도 특별주간'); a.type('#pmeta', '12월 1일 (화) 오전 5시 30분'); a.type('#pbody', '함께 기도합니다.'); a.click('[data-act=submitPost]');
  await waitFor(() => !a.S.busy && a.S.screen === 'news', 'event post');
  ok('일정이 날짜와 함께 보임', /새벽기도 특별주간/.test(a.text()) && /12월 1일 \(화\) 오전 5시 30분/.test(a.text()), a.text());
  a.click('[data-act=seg][data-v=bulletin]'); a.click('#view .item'); a.click('[data-act=deletePost]');
  ok('지우기는 한 번 더 확인', /한 번 더 누르면 지워집니다/.test(a.text()) && be.posts.some((x) => x.title === '11월 22일 주보'));
  a.click('[data-act=deletePost]'); await waitFor(() => !a.S.busy && a.S.screen === 'news', 'delete');
  ok('글과 사진이 서버에서 지워짐', !be.posts.some((x) => x.title === '11월 22일 주보') && Object.keys(be.objects).length === 0, JSON.stringify(Object.keys(be.objects)));
  ok('목록에서도 사라짐', /아직 올라온 주보가 없습니다/.test(a.text()), a.text());
  a.click('#tabs [data-screen=more]');
  let downloaded = null; const realCreate = a.d.createElement.bind(a.d);
  a.d.createElement = (t) => { const el = realCreate(t); if (t === 'a') el.click = () => { downloaded = el.download; }; return el; };
  a.click('[data-act=exportAll]'); await waitFor(() => !a.S.busy && downloaded, 'export');
  ok('백업 파일 내려받기', /^chanyang-backup-\d{4}-\d{2}-\d{2}\.json$/.test(downloaded || '') && /글 4개/.test(a.$('#banner').textContent), downloaded + ' / ' + a.$('#banner').textContent);
  ok('여기까지 오류 없음', a.w.__errors.length === 0, a.w.__errors.join(' | '));

  console.log('\n[6] 다른 성도 휴대폰: 새 글 표시');
  const b = boot(be); await b.w.__chanyang.ready;
  ok('다른 휴대폰에도 관리자가 올린 일정이 보임', b.S.posts.some((x) => x.title === '새벽기도 특별주간') && !b.S.admin);
  be.posts.push({ id: 'n9', kind: 'news', title: '성탄절 칸타타 안내', body: '12월 20일 주일 저녁', meta: null, images: [], created_at: new Date(Date.now() + 5000).toISOString() });
  await b.w.__chanyang.load();
  ok('새 글이 올라오면 종 모양에 점 표시', b.$('#dot').hidden === false);
  b.click('#bar [data-screen=noti]');
  ok('새 소식 목록에 보이고 점이 꺼짐', /소식 · 성탄절 칸타타 안내/.test(b.text()) && b.$('#dot').hidden === true, b.text());
  b.click('#view .item'); ok('새 소식에서 글 열기', /12월 20일 주일 저녁/.test(b.text()));
  b.click('#back'); ok('뒤로 가면 새 소식 목록', b.S.screen === 'noti');

  console.log('\n[7] 앱을 껐다 켰을 때 · 로그아웃');
  const a2 = boot(be, { storage: a.storage() }); await a2.w.__chanyang.ready;
  ok('다시 열어도 관리자 로그인 유지', !!a2.S.admin && a2.S.admin.email === 'admin@church.kr');
  a2.click('#tabs [data-screen=more]'); a2.click('[data-act=logout]'); await waitFor(() => !a2.S.admin, 'logout');
  ok('로그아웃하면 관리자 메뉴가 사라짐', !!a2.$('[data-screen=login]') && !a2.$('#view [data-screen=post]'));
  a2.w.__chanyang.go('post');
  ok('로그아웃 상태로는 글쓰기 화면이 막힘', /관리자로 로그인한 뒤/.test(a2.text()));

  console.log('\n[8] 인터넷이 끊겼을 때');
  be.offline = true;
  const c = boot(be, { storage: b.storage() }); await c.w.__chanyang.ready;
  ok('마지막으로 받아 둔 글을 보여 줌', c.S.postsFrom === 'cache' && c.S.posts.some((x) => x.title === '성탄절 칸타타 안내'), c.S.postsFrom);
  c.click('#tabs [data-screen=news]');
  ok('연결 안 됨 안내 표시', /서버에 연결되지 않아 마지막으로 받아 둔 내용/.test(c.text()));
  const fresh = boot(be); await fresh.w.__chanyang.ready;
  ok('처음 여는 휴대폰은 서버에 확인되기 전까지 내용을 보여 주지 않음', fresh.S.posts.length === 0 && /서버에 연결하지 못했습니다/.test(fresh.text()) && !!fresh.$('[data-act=retry]') && fresh.locked(), fresh.text());
  be.offline = false; const a3 = boot(be); await a3.w.__chanyang.ready;
  a3.click('#tabs [data-screen=more]'); a3.click('[data-screen=login]'); a3.type('#email', 'admin@church.kr'); a3.type('#pw', 'pw-ok'); a3.click('[data-act=login]'); await waitFor(() => !!a3.S.admin, 'login3');
  a3.w.__chanyang.go('post'); a3.type('#ptitle', '끊김 시험'); a3.type('#pbody', '본문'); a3.pick(['x.jpg']);
  be.offline = true; a3.click('[data-act=submitPost]'); await waitFor(() => !a3.S.busy, 'offline post');
  ok('올리다 끊기면 안내하고 쓴 내용은 그대로', /서버에 연결하지 못했습니다/.test(a3.text()) && a3.$('#ptitle').value === '끊김 시험' && a3.$$('.file-row').length === 1, a3.text());
  be.offline = false;

  console.log('\n[9] 권한이 없는데 올리려 할 때 (로그인이 서버에서 풀린 경우)');
  be.tokens = {};                                   // 서버 쪽에서 로그인 무효화
  a3.click('[data-act=submitPost]'); await waitFor(() => !a3.S.busy, 'forbidden post');
  ok('권한 없음 안내, 서버에는 저장 안 됨', /권한이 없습니다/.test(a3.text()) && !be.posts.some((x) => x.title === '끊김 시험') && Object.keys(be.objects).length === 0, a3.text());

  console.log('\n[10] 서버 주소를 비워 둔 경우 (서버 없이 동작)');
  const n = boot(makeBackend(), { noServer: true }); await n.w.__chanyang.ready;
  n.click('#tabs [data-screen=more]');
  ok('기본 글로 동작하고 관리자 기능 안내', n.S.postsFrom === 'file' && /서버가 연결되지 않아 관리자 기능은 쓸 수 없습니다/.test(n.text()) && !n.$('[data-screen=login]'));

  console.log('\n[11] 예전 기능이 그대로인지');
  const o = boot(makeBackend(), { storage: { 'chanyang.myPosts': JSON.stringify([{ id: 'my-1', kind: 'news', title: '예전에 이 휴대폰에 쓴 글', body: 'b', meta: '11월 17일 · 이 휴대폰에서 작성', local: true }]), 'chanyang.isAdmin': 'true', 'chanyang.notes': JSON.stringify({ '8NtSHTWvUpo': '예전 노트' }) } });
  await o.w.__chanyang.ready;
  ok('예전 관리자 표시는 정리되고 노트는 유지', !o.S.admin && o.storage()['chanyang.isAdmin'] === undefined && o.S.notes['8NtSHTWvUpo'] === '예전 노트');
  o.click('#tabs [data-screen=news]');
  ok('예전에 휴대폰에만 쓴 글은 "이 휴대폰" 표시로 남음', /예전에 이 휴대폰에 쓴 글/.test(o.text()) && /이 휴대폰/.test(o.text()));
  o.click('#view .item'); o.click('[data-act=deletePost]'); o.click('[data-act=deletePost]');
  ok('그 글은 로그인 없이도 지울 수 있음', !/예전에 이 휴대폰에 쓴 글/.test(o.text()) && o.S.myPosts.length === 0);
  o.click('#tabs [data-screen=home]'); o.click('.hero'); ok('설교 보기 + 노트', !!o.$('.player iframe') && o.$('#note').value === '예전 노트');
  o.click('#tabs [data-screen=sermons]'); ok('설교 목록', o.$$('#view .item').length === 11);
  o.click('#tabs [data-screen=prayer]'); o.$('#prayer').value = '가족'; o.click('[data-act=addPrayer]');
  ok('기도제목(휴대폰 저장)', o.$$('#view .card').length === 4);
  o.click('#tabs [data-screen=home]'); o.click('[data-screen=info]'); ok('예배 안내', o.$$('.times div').length === 7);
  for (const x of [a, b, a2, c, fresh, a3, n, o]) ok('오류 없음', x.w.__errors.length === 0, x.w.__errors.join(' | '));

  process.exit(result() ? 1 : 0);
})().catch((e) => { console.error('점검 중단:', e); process.exit(2); });
