// 2단계 기능 점검: 성도 승인 (승인번호 입력, 관리자 화면, 비공개 사진)
const { makeBackend, boot, ok, result, waitFor, sleep, SB, root } = require('./harness');
const fs = require('fs'); const path = require('path');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; SM-S931N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
const KAKAO_ANDROID = 'Mozilla/5.0 (Linux; Android 15; SM-S931N Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.0.0 Mobile Safari/537.36;KAKAOTALK 25.9.0';
const KAKAO_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.9.0';
const count = (be, what) => be.log.filter((x) => x === what).length;
const gated = () => { const be = makeBackend(); be.gate = { membersOnly: true }; return be; };
const adminLogin = async (a) => { a.click('[data-screen=login]'); a.type('#email', 'admin@church.kr'); a.type('#pw', 'pw-ok'); a.click('[data-act=login]'); await waitFor(() => !!a.S.admin && !a.S.busy, 'admin login'); };

(async () => {
  // ── 12. 2단계 설정 전: 지금처럼 열려 있어야 함 ─────────────────────
  console.log('\n[12] 서버 설정 2단계를 실행하기 전 (앱만 먼저 올린 상태)');
  let be = makeBackend();
  let a = boot(be); await a.w.__chanyang.ready;
  ok('승인 화면 없이 지금처럼 열림', a.S.screen === 'home' && !a.locked() && a.S.posts.length === 3 && a.S.gate.ready === false, a.S.screen);
  ok('아래 메뉴와 종 모양이 보임', !a.locked() && !!a.$('#tabs') && !!a.$('#bell'));
  a.click('#tabs [data-screen=more]'); await adminLogin(a);
  ok('관리자 메뉴에 "성도 승인"이 있음', !!a.$('[data-screen=members]'), a.text());
  a.click('[data-screen=members]');
  ok('성도 승인 화면: 서버 설정이 필요하다고 안내', /서버 설정 2단계를 실행한 뒤/.test(a.text()) && !a.$('#mname') && a.$('a[href="supabase/"]') !== null, a.text());
  be.gate = { membersOnly: true };                      // 이때 Jay 님이 서버 설정을 실행
  a.click('[data-act=retry]'); await waitFor(() => !!a.$('#mname'), 'members after setup');
  ok('설정을 실행한 뒤 "다시 확인"을 누르면 바로 쓸 수 있음', !!a.$('#mname') && a.S.gate.membersOnly === true && !a.locked(), a.text());
  ok('오류 없음', a.w.__errors.length === 0, a.w.__errors.join(' | '));

  // ── 13. 승인제가 켜진 서버 · 처음 여는 휴대폰 ──────────────────────
  console.log('\n[13] 승인제가 켜진 서버 · 처음 여는 휴대폰');
  be = gated(); const hong = be.issue('홍길동');
  be.posts.push({ id: 'b1', kind: 'bulletin', title: '11월 22일 주보', body: '', meta: null, images: ['b1/1.jpg', 'b1/2.jpg'], created_at: '2026-11-18T03:00:00+00:00' });
  be.objects['b1/1.jpg'] = { type: 'image/jpeg' }; be.objects['b1/2.jpg'] = { type: 'image/jpeg' };
  a = boot(be);
  ok('서버에 확인하기 전에는 아무 내용도 그리지 않음', /확인하는 중/.test(a.text()) && a.locked() && !/주일예배|교회 소식/.test(a.text()), a.text());
  await a.w.__chanyang.ready;
  ok('승인 화면이 뜸', a.S.screen === 'gate' && /승인번호/.test(a.text()) && !!a.$('#code'), a.text());
  const gimg = a.$('.gate-top img');
  ok('승인 화면 맨 위에 교회 십자가 그림(img/cross.jpg)이 보임', !!gimg && gimg.getAttribute('src') === 'img/cross.jpg' && fs.existsSync(path.join(root, 'img/cross.jpg')), gimg && gimg.getAttribute('src'));
  const shell = (fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/const SHELL = \[([\s\S]*?)\];/) || ['', ''])[1].match(/'[^']+'/g).map((x) => x.slice(1, -1));
  const missing = shell.filter((f) => f !== './' && !fs.existsSync(path.join(root, f)));
  ok('휴대폰에 보관해 두는 파일 목록에 십자가 그림이 있고, 목록의 파일이 모두 실제로 있음', shell.includes('img/cross.jpg') && shell.length >= 15 && missing.length === 0, missing.join(', '));
  ok('아래 메뉴와 종 모양이 감춰짐', a.locked() && a.$('#bar [data-screen=noti]').hidden === true);
  ok('글과 소식이 화면에도, 기억에도 없음', a.S.posts.length === 0 && !/성탄감사예배|찬양하는교회 앱이 준비/.test(a.d.body.textContent) && a.storage()['chanyang.postsCache'] === undefined);
  ok('승인 전에는 글을 달라고 요청하지도 않음', count(be, 'GET /rest/v1/posts') === 0, be.log.join(', '));
  ok('승인 전에는 임시 계정을 만들지 않음', count(be, 'POST /auth/v1/signup') === 0);
  ok('승인 전에도 설치 안내는 보임', /휴대폰에 앱으로 설치하기/.test(a.text()));
  ok('관리자 로그인으로 가는 길이 있음', !!a.$('[data-screen=login]'));
  a.w.__chanyang.go('news'); ok('다른 화면으로 가려 해도 승인 화면', a.S.screen === 'gate' && !!a.$('#code'));
  a.w.__chanyang.go('sermons'); ok('설교 화면도 막힘', a.S.screen === 'gate');
  a.w.__chanyang.go('members'); ok('성도 승인(관리자) 화면도 막힘', a.S.screen === 'gate');

  a.type('#code', '1234'); a.click('[data-act=redeem]');
  ok('자릿수가 모자라면 서버에 묻지 않고 안내', /숫자 8자리/.test(a.text()) && count(be, 'POST /rest/v1/rpc/redeem_code') === 0, a.text());
  ok('안내 뒤에도 입력한 값은 남아 있음', a.$('#code').value === '1234');
  a.type('#code', '0000 0000'); a.click('[data-act=redeem]');
  ok('확인하는 동안 단추가 잠김', a.S.busy && a.$('[data-act=redeem]').disabled);
  await waitFor(() => !a.S.busy, 'wrong code');
  ok('틀린 번호: 안내 + 남은 횟수', /승인번호가 맞지 않습니다/.test(a.text()) && /남은 횟수 4번/.test(a.text()) && a.locked(), a.text());
  ok('이때 휴대폰 이름표(임시 계정)를 한 번 받음', count(be, 'POST /auth/v1/signup') === 1);
  a.type('#code', '00000001'); a.click('[data-act=redeem]'); await waitFor(() => !a.S.busy, 'wrong code 2');
  ok('다시 틀려도 이름표를 또 받지는 않음', count(be, 'POST /auth/v1/signup') === 1 && /남은 횟수 3번/.test(a.text()), a.text());

  a.type('#code', hong.code.slice(0, 4) + ' ' + hong.code.slice(4)); a.click('[data-act=redeem]');
  await waitFor(() => !a.S.busy && a.S.screen === 'home', 'redeem ok');
  ok('맞는 번호 → 홈 화면이 열림 (종 모양도 다시 보임)', a.S.screen === 'home' && !a.locked() && a.S.gate.member === true && a.$('#bar [data-screen=noti]').hidden === false, a.S.screen);
  ok('승인 안내가 뜸', !a.$('#banner').hidden && /홍길동 님, 승인되었습니다/.test(a.$('#banner').textContent), a.$('#banner').textContent);
  ok('글이 보임', a.S.posts.length === 4 && a.S.postsFrom === 'server' && /찬양하는교회 앱이 준비되었습니다/.test(a.text()), a.S.posts.length);
  ok('서버 명단에 이 휴대폰이 승인으로 기록됨', !!be.members[0].userId && be.members[0].code === null);
  a.click('#tabs [data-screen=more]');
  ok('더보기에 승인된 이름이 보임', /홍길동 님으로 승인되어 있습니다/.test(a.text()), a.text());
  ok('성도에게는 관리자 메뉴가 없음', !a.$('[data-screen=members]') && !a.$('#view [data-screen=post]') && !!a.$('[data-screen=login]'));

  // 비공개 사진
  a.click('#tabs [data-screen=news]'); a.click('[data-act=seg][data-v=bulletin]'); a.click('#view .item');
  ok('사진: 받아 오는 동안 안내', /사진을 불러오는 중/.test(a.text()), a.text());
  await waitFor(() => a.$$('.shot img').length === 2, 'signed images');
  const srcs = a.$$('.shot img').map((i) => i.getAttribute('src'));
  ok('사진 2장이 권한 확인을 거친 주소로 보임', srcs.length === 2 && srcs.every((s) => s.startsWith(SB + '/storage/v1/object/sign/post-images/b1/') && /token=signed-/.test(s)), srcs.join(' , '));
  ok('공개 주소는 쓰지 않음', !srcs.some((s) => /object\/public/.test(s)));
  const signCalls = count(be, 'POST /storage/v1/object/sign/post-images');
  a.click('#back'); a.click('#view .item');
  ok('같은 사진을 다시 열 때는 다시 묻지 않음', count(be, 'POST /storage/v1/object/sign/post-images') === signCalls && a.$$('.shot img').length === 2);

  // 앱을 껐다 켬
  const kept = a.storage();
  const a2 = boot(be, { storage: kept });
  ok('다시 열면 확인을 기다리지 않고 바로 홈', a2.S.screen === 'home' && !a2.locked() && !/확인하는 중/.test(a2.text()), a2.text());
  await a2.w.__chanyang.ready;
  ok('다시 열어도 승인 상태와 글이 그대로', !a2.locked() && a2.S.gate.member && a2.S.posts.length === 4);
  ok('다시 열 때 이름표를 또 받지 않음', count(be, 'POST /auth/v1/signup') === 1);

  // 승인 취소
  be.members = [];
  await a2.sync();
  ok('관리자가 승인을 취소하면 다음 확인 때 바로 잠김', a2.locked() && a2.S.screen === 'gate' && a2.S.posts.length === 0, a2.S.screen);
  ok('받아 둔 글도 휴대폰에서 지움', a2.storage()['chanyang.postsCache'] === undefined && !/성탄감사예배/.test(a2.d.body.textContent));
  const a2b = boot(be, { storage: a2.storage() });
  ok('취소된 휴대폰을 다시 열면 처음부터 승인 화면', a2b.S.screen === 'gate' || a2b.locked(), a2b.S.screen);
  await a2b.w.__chanyang.ready;
  for (const x of [a, a2, a2b]) ok('오류 없음', x.w.__errors.length === 0, x.w.__errors.join(' | '));

  // ── 14. 승인번호가 통하지 않는 여러 경우 ──────────────────────────
  console.log('\n[14] 잠김 · 기한 지남 · 서버 설정 문제');
  be = gated(); const kim = be.issue('김철수'); kim.expired = true; const lee = be.issue('이영희');
  let b = boot(be); await b.w.__chanyang.ready;
  b.type('#code', kim.code); b.click('[data-act=redeem]'); await waitFor(() => !b.S.busy, 'expired');
  ok('기한 지난 번호: 새 번호를 요청하라고 안내', /기한이 지난 승인번호/.test(b.text()) && b.locked(), b.text());
  for (let i = 0; i < 4; i++) { b.type('#code', '9999999' + i); b.click('[data-act=redeem]'); await waitFor(() => !b.S.busy, 'wrong ' + i); }
  ok('마지막 기회까지 쓰면 남은 횟수 0번', /남은 횟수 0번/.test(b.text()), b.text());
  b.type('#code', lee.code); b.click('[data-act=redeem]'); await waitFor(() => !b.S.busy, 'locked');
  ok('5번 틀린 뒤에는 맞는 번호도 잠김 안내 (남은 시간 표시)', /여러 번 틀려서 잠겼습니다/.test(b.text()) && /약 57분/.test(b.text()) && b.locked(), b.text());
  ok('잠긴 동안 번호는 소모되지 않음', be.members.find((m) => m.name === '이영희').code === lee.code);
  be.attempts = {}; be.busy = true;
  b.click('[data-act=redeem]'); await waitFor(() => !b.S.busy, 'busy');
  ok('서버가 잠시 닫혀 있으면 나중에 다시 하라고 안내', /10분쯤 뒤에 다시/.test(b.text()), b.text());
  be.busy = false;
  b.d.querySelector('#code').dispatchEvent(new b.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await waitFor(() => !b.S.busy && b.S.screen === 'home', 'enter key');
  ok('입력칸에서 Enter 를 눌러도 확인됨', !b.locked() && b.S.gate.name === '이영희');

  for (const [why, set, text] of [
    ['익명 로그인이 꺼져 있음', (x) => { x.anon.enabled = false; }, /서버 설정이 아직 끝나지 않아 승인번호를 확인할 수 없습니다/],
    ['새 계정 가입이 꺼져 있음', (x) => { x.anon.signups = false; }, /서버 설정이 아직 끝나지 않아 승인번호를 확인할 수 없습니다/],
    ['요청이 너무 많음', (x) => { x.anon.limited = true; }, /요청이 많아 잠시 막혔습니다/]
  ]) {
    const bx = gated(); const m = bx.issue('박집사'); set(bx);
    const c = boot(bx); await c.w.__chanyang.ready;
    c.type('#code', m.code); c.click('[data-act=redeem]'); await waitFor(() => !c.S.busy, why);
    ok(`서버 설정 문제(${why}): 담당자에게 알리라는 안내, 번호는 그대로`, text.test(c.text()) && c.locked() && m.code !== null && c.w.__errors.length === 0, c.text());
  }
  // 승인이 취소되어 서버에서 이름표가 지워진 휴대폰이, 새로 받은 번호를 곧바로 입력하는 경우
  be = gated(); const re = be.issue('다시 승인');
  b = boot(be); await b.w.__chanyang.ready;
  b.type('#code', '00000000'); b.click('[data-act=redeem]'); await waitFor(() => !b.S.busy, 'first try');
  be.users.filter((u) => u.anonymous).forEach((u) => be.ghosts.add(u.id));
  b.type('#code', re.code); b.click('[data-act=redeem]'); await waitFor(() => !b.S.busy && !b.locked(), 'ghost retry');
  ok('지워진 이름표: 앱이 알아서 새 이름표를 받아 다시 시도해 승인됨', !b.locked() && b.S.gate.name === '다시 승인' && count(be, 'POST /auth/v1/signup') === 2 && count(be, 'POST /rest/v1/rpc/redeem_code') === 3, be.log.filter((x) => /signup|redeem/.test(x)).join(', '));
  ok('그 과정에서 오류나 엉뚱한 화면 전환 없음', b.w.__errors.length === 0 && b.S.screen === 'home', b.w.__errors.join(' | '));

  be = gated(); const net = be.issue('최권사');
  b = boot(be); await b.w.__chanyang.ready;
  be.offline = true; b.type('#code', net.code); b.click('[data-act=redeem]'); await waitFor(() => !b.S.busy, 'offline redeem');
  ok('입력 중 인터넷이 끊기면 연결 안내, 입력한 번호는 그대로', /서버에 연결하지 못했습니다/.test(b.text()) && b.$('#code').value === net.code, b.text());
  be.offline = false; b.click('[data-act=redeem]'); await waitFor(() => !b.S.busy && !b.locked(), 'online again');
  ok('다시 연결되면 같은 번호로 승인됨', !b.locked() && b.S.gate.name === '최권사');
  ok('오류 없음', b.w.__errors.length === 0, b.w.__errors.join(' | '));

  // ── 15. 관리자 흐름 ────────────────────────────────────────────
  console.log('\n[15] 승인제가 켜진 서버 · 관리자');
  be = gated();
  let ad = boot(be); await ad.w.__chanyang.ready;
  ok('관리자도 처음에는 승인 화면', ad.S.screen === 'gate');
  ad.click('[data-screen=login]');
  ok('승인 화면에서 관리자 로그인 화면으로', ad.S.screen === 'login' && !!ad.$('#email') && ad.locked());
  ad.click('#back'); ok('뒤로 가면 다시 승인 화면', ad.S.screen === 'gate');
  ad.click('[data-screen=login]'); ad.type('#email', 'member@x.com'); ad.type('#pw', 'pw-ok'); ad.click('[data-act=login]'); await waitFor(() => !ad.S.busy, 'non-admin');
  ok('관리자가 아닌 계정은 거절되고 계속 잠김', /관리자로 등록되지 않은 계정/.test(ad.text()) && ad.locked(), ad.text());
  ad.type('#email', 'admin@church.kr'); ad.type('#pw', 'pw-ok'); ad.click('[data-act=login]'); await waitFor(() => !!ad.S.admin && !ad.S.busy, 'admin');
  ok('관리자 로그인 → 승인번호 없이 열림', !ad.locked() && ad.S.screen === 'more' && ad.S.posts.length === 3, ad.S.screen);
  ok('관리자는 임시 계정을 만들지 않음', count(be, 'POST /auth/v1/signup') === 0);
  ad.click('[data-screen=members]'); await waitFor(() => ad.S.members !== null, 'members');
  ok('성도 승인 화면: 빈 명단', ad.S.screen === 'members' && /아직 승인번호를 보낸 성도가 없습니다/.test(ad.text()) && /명단 · 승인 0명 \/ 전체 0명/.test(ad.text()), ad.text());
  ad.click('[data-act=issueCode]');
  ok('이름 없이 누르면 안내', /성도 이름을 입력/.test(ad.text()) && be.members.length === 0);
  ad.type('#mname', '  홍길동 '); ad.click('[data-act=issueCode]'); await waitFor(() => !ad.S.busy && !!ad.S.issued, 'issue');
  const code1 = be.members[0].code;
  ok('승인번호가 만들어져 크게 보임 (4자리씩 띄움)', !!ad.$('.code-big') && ad.$('.code-big').textContent === code1.slice(0, 4) + ' ' + code1.slice(4) && /홍길동 님 승인번호/.test(ad.text()), ad.text());
  ok('명단에 입력 대기로 올라감', /명단 · 승인 0명 \/ 전체 1명/.test(ad.text()) && /입력 대기/.test(ad.text()) && /까지 입력/.test(ad.text()), ad.text());
  ok('이름 칸은 비워짐', ad.$('#mname').value === '');
  ok('전화번호를 묻는 칸이 없음', !ad.$('input[type=tel]') && ad.$$('#view input').length === 1);

  ad.click('[data-act=sendSms]');
  const sms = ad.opened[0] || '';
  const smsBody = decodeURIComponent(sms.replace(/^sms:\?body=/, ''));
  ok('문자 보내기: 문자 앱을 여는 주소 (받는 사람은 비움)', sms.startsWith('sms:?body='), sms.slice(0, 40));
  ok('문자 내용: 이름, 승인번호, 기한, 설치 순서, 앱 주소', smsBody.includes('홍길동') && smsBody.includes(code1.slice(0, 4) + ' ' + code1.slice(4)) && /까지, 한 번만 사용/.test(smsBody) && /홈 화면에 설치/.test(smsBody) && smsBody.trim().endsWith('https://nstepanet.github.io/chanyang/'), smsBody);
  ad.click('[data-act=copyInvite]'); await waitFor(() => ad.copied.length === 1, 'copy');
  ok('내용 복사: 같은 내용이 복사됨', ad.copied[0] === smsBody && /복사했습니다/.test(ad.$('#banner').textContent));
  ad.w.__chanyang.hooks.platform = () => ({ standalone: true, ios: true, android: false, kakao: false, inApp: false, safari: true });
  ad.click('[data-act=sendSms]');
  ok('아이폰에서는 아이폰 방식의 주소로 엶', (ad.opened[1] || '').startsWith('sms:&body='), (ad.opened[1] || '').slice(0, 20));

  ad.click('#back'); ad.click('[data-screen=members]'); await waitFor(() => ad.S.members !== null && ad.S.screen === 'members', 'back to members');
  ok('화면을 벗어났다 오면 승인번호는 다시 보이지 않음', !ad.$('.code-big') && !ad.S.issued && !ad.d.body.textContent.includes(code1.slice(0, 4) + ' ' + code1.slice(4)));
  ad.click('[data-act=reissue]'); await waitFor(() => !ad.S.busy && !!ad.S.issued, 'reissue');
  const code2 = be.members[0].code;
  ok('다시 보내기: 새 번호가 나오고 명단은 한 줄 그대로', code2 !== code1 && ad.$('.code-big').textContent.replace(' ', '') === code2 && be.members.length === 1);

  // 성도가 그 번호로 승인받고, 관리자가 명단에서 확인
  const phone = boot(be); await phone.w.__chanyang.ready;
  phone.type('#code', code1); phone.click('[data-act=redeem]'); await waitFor(() => !phone.S.busy, 'old code');
  ok('다시 보낸 뒤 예전 번호는 통하지 않음', /승인번호가 맞지 않습니다/.test(phone.text()) && phone.locked());
  phone.type('#code', code2); phone.click('[data-act=redeem]'); await waitFor(() => !phone.S.busy && !phone.locked(), 'new code');
  ok('새 번호로 승인됨', !phone.locked() && phone.S.posts.length === 3);
  ad.click('#back'); ad.click('[data-screen=members]'); await waitFor(() => ad.S.members && ad.S.members[0] && ad.S.members[0].state === 'approved', 'approved in list');
  ok('명단에 승인으로 바뀜', /명단 · 승인 1명 \/ 전체 1명/.test(ad.text()) && /승인 취소/.test(ad.text()) && / 승인/.test(ad.text()), ad.text());

  ad.click('[data-act=removeMember]');
  ok('승인 취소는 한 번 더 확인', /한 번 더 누르면 취소됩니다/.test(ad.text()) && be.members.length === 1);
  ad.click('[data-act=removeMember]'); await waitFor(() => !ad.S.busy && ad.S.members && ad.S.members.length === 0, 'remove');
  ok('명단에서 지워짐', be.members.length === 0 && /전체 0명/.test(ad.text()) && /명단에서 지웠습니다/.test(ad.$('#banner').textContent));
  await phone.sync();
  ok('취소된 성도의 휴대폰은 잠김', phone.locked() && phone.S.screen === 'gate');

  // 글 올리기는 그대로
  ad.w.__chanyang.go('post'); ad.type('#ptitle', '승인제에서 올린 글'); ad.type('#pbody', '본문'); ad.pick(['1.jpg']); ad.click('[data-act=submitPost]');
  await waitFor(() => !ad.S.busy && ad.S.screen === 'news', 'post under gate');
  ok('관리자: 글 올리기는 그대로 됨', be.posts.some((x) => x.title === '승인제에서 올린 글') && /승인제에서 올린 글/.test(ad.text()));
  ad.click('#view .item'); await waitFor(() => ad.$$('.shot img').length === 1, 'admin image');
  ok('관리자: 방금 올린 사진이 보임', /object\/sign\/post-images/.test(ad.$('.shot img').getAttribute('src')));
  let downloaded = null; const realCreate = ad.d.createElement.bind(ad.d);
  ad.d.createElement = (t) => { const el = realCreate(t); if (t === 'a') el.click = () => { downloaded = el.download; }; return el; };
  be.issue('백업용');
  ad.click('#tabs [data-screen=more]'); ad.click('[data-act=exportAll]'); await waitFor(() => !ad.S.busy && downloaded, 'export');
  ok('백업 내려받기', /^chanyang-backup-/.test(downloaded || '') && /글 4개/.test(ad.$('#banner').textContent), downloaded);

  // 로그아웃
  ad.click('[data-act=logout]'); await waitFor(() => !ad.S.admin && ad.S.screen === 'gate', 'logout');
  ok('로그아웃하면 다시 승인 화면 (이 휴대폰은 승인받은 적이 없으므로)', ad.locked() && ad.S.screen === 'gate' && ad.S.posts.length === 0 && ad.storage()['chanyang.postsCache'] === undefined);
  await sleep(50);
  ok('오류 없음', ad.w.__errors.length === 0 && phone.w.__errors.length === 0, ad.w.__errors.concat(phone.w.__errors).join(' | '));

  // ── 16. 승인받은 휴대폰에서 관리자로 로그인했다가 나오는 경우 ─────────
  console.log('\n[16] 승인된 휴대폰 + 관리자 로그인');
  be = gated(); const park = be.issue('박집사');
  let m = boot(be); await m.w.__chanyang.ready;
  m.type('#code', park.code); m.click('[data-act=redeem]'); await waitFor(() => !m.S.busy && !m.locked(), 'member');
  m.click('#tabs [data-screen=more]'); m.click('[data-screen=login]');
  m.type('#email', 'member@x.com'); m.type('#pw', 'pw-ok'); m.click('[data-act=login]'); await waitFor(() => !m.S.busy, 'not admin on member phone');
  await m.sync();
  ok('관리자가 아닌 계정으로 로그인을 시도해도 받은 승인은 그대로', /관리자로 등록되지 않은 계정/.test(m.text()) && !m.locked() && m.S.gate.member === true && m.S.gate.name === '박집사', m.text() + ' / ' + JSON.stringify(m.S.gate));
  m.type('#email', 'admin@church.kr'); m.type('#pw', 'wrong'); m.click('[data-act=login]'); await waitFor(() => !m.S.busy, 'bad pw on member phone');
  await m.sync();
  ok('비밀번호가 틀려도 받은 승인은 그대로', /이메일 또는 비밀번호가 맞지 않습니다/.test(m.text()) && !m.locked() && m.S.gate.member === true);
  m.type('#email', 'admin@church.kr'); m.type('#pw', 'pw-ok'); m.click('[data-act=login]'); await waitFor(() => !!m.S.admin && !m.S.busy, 'admin on member phone');
  ok('관리자로 로그인됨', m.S.screen === 'more' && !!m.$('[data-screen=members]'));
  const reopened = boot(be, { storage: m.storage() }); await reopened.w.__chanyang.ready;
  ok('관리자인 채로 앱을 다시 열어도 열려 있음', !reopened.locked() && !!reopened.S.admin);
  reopened.click('#tabs [data-screen=more]'); reopened.click('[data-act=logout]');
  await waitFor(() => !reopened.S.admin && reopened.S.gate.member === true, 'logout back to member');
  ok('로그아웃하면 성도로 승인된 상태로 돌아옴 (승인번호를 다시 받을 필요 없음)', !reopened.locked() && reopened.S.gate.member === true && reopened.S.gate.name === '박집사' && reopened.S.posts.length === 3, JSON.stringify(reopened.S.gate));
  ok('승인번호를 새로 쓰지 않았고 임시 계정도 하나뿐', count(be, 'POST /auth/v1/signup') === 1 && be.members.length === 1);
  ok('오류 없음', m.w.__errors.length === 0 && reopened.w.__errors.length === 0, m.w.__errors.concat(reopened.w.__errors).join(' | '));

  // ── 17. 기기별 화면 ─────────────────────────────────────────────
  console.log('\n[17] 아이폰 · 안드로이드 · 카카오톡 안의 화면');
  be = gated();
  let p = boot(be, { ua: IPHONE, navStandalone: false }); await p.w.__chanyang.ready;
  ok('아이폰 Safari: 승인번호 칸 없이 설치 안내만', !p.$('#code') && /먼저 홈 화면에 설치해 주세요/.test(p.text()) && /홈 화면에 추가/.test(p.text()) && p.$$('.steps li').length === 4, p.text());
  ok('아이폰 Safari: 관리자 로그인은 가능', !!p.$('[data-screen=login]'));
  p = boot(be, { ua: IPHONE, navStandalone: true }); await p.w.__chanyang.ready;
  ok('아이폰 홈 화면 앱: 승인번호 칸이 보이고 설치 안내는 없음', !!p.$('#code') && !/홈 화면에 추가/.test(p.text()), p.text());
  p = boot(be, { ua: IPHONE.replace('Version/18.5 Mobile/15E148 Safari/604.1', 'CriOS/142.0 Mobile/15E148 Safari/604.1'), navStandalone: false }); await p.w.__chanyang.ready;
  ok('아이폰의 다른 브라우저: Safari 로 열라는 도움말 추가', !p.$('#code') && /Safari로 열어 주세요/.test(p.text()), p.text());
  p = boot(be, { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15', navStandalone: false, touch: 5 }); await p.w.__chanyang.ready;
  ok('아이패드(데스크톱 방식 표시)도 아이폰처럼 처리', !p.$('#code') && /먼저 홈 화면에 설치/.test(p.text()));
  p = boot(be, { ua: ANDROID }); await p.w.__chanyang.ready;
  ok('안드로이드 Chrome: 승인번호 칸 + 설치 안내(메뉴 위치)', !!p.$('#code') && /오른쪽 위 메뉴/.test(p.text()) && /삼성 인터넷/.test(p.text()) && !p.$('[data-act=install]'), p.text());
  const ev = new p.w.Event('beforeinstallprompt'); let prompted = 0; ev.prompt = () => { prompted++; };
  p.type('#code', '1234'); p.$('#code').focus();
  p.w.dispatchEvent(ev);
  ok('브라우저가 허락하면 "앱 설치하기" 단추가 나타남', !!p.$('[data-act=install]') && /앱 설치하기/.test(p.text()), p.text());
  ok('단추가 나타나며 화면이 다시 그려져도 입력하던 번호와 커서는 그대로', p.$('#code').value === '1234' && p.d.activeElement === p.$('#code'));
  p.click('[data-act=install]');
  ok('단추를 누르면 설치 창을 띄움 (한 번만)', prompted === 1 && !p.$('[data-act=install]'));
  p = boot(be, { ua: ANDROID, displayStandalone: true }); await p.w.__chanyang.ready;
  ok('안드로이드에 설치된 앱: 설치 안내 없이 승인번호 칸만', !!p.$('#code') && !/앱으로 설치하기/.test(p.text()));

  p = boot(be, { ua: KAKAO_ANDROID }); await p.w.__chanyang.ready;
  const kLink = p.$('a[href^="kakaotalk://web/openExternal"]');
  ok('카카오톡(안드로이드): 다른 브라우저로 열라는 안내, 승인번호 칸 없음', !p.$('#code') && /카카오톡 안에서 열린 화면/.test(p.text()) && !!kLink, p.text());
  ok('바깥 브라우저로 여는 단추에 앱 주소가 담김', !!kLink && decodeURIComponent(kLink.getAttribute('href').split('url=')[1]) === 'https://nstepanet.github.io/chanyang/', kLink && kLink.getAttribute('href'));
  p.click('[data-act=copyUrl]'); await waitFor(() => p.copied.length === 1, 'copy url');
  ok('앱 주소 복사', p.copied[0] === 'https://nstepanet.github.io/chanyang/');
  p.click('[data-act=gateForce]');
  ok('"그래도 여기서 입력"을 누르면 승인번호 칸이 나옴', !!p.$('#code'));
  p = boot(be, { ua: KAKAO_IPHONE, navStandalone: false }); await p.w.__chanyang.ready;
  ok('카카오톡(아이폰): Safari 로 열라는 안내, 여기서 입력하는 길은 없음', !p.$('#code') && /Safari에서 열어 주세요/.test(p.text()) && !p.$('[data-act=gateForce]') && !!p.$('a[href^="kakaotalk://web/openExternal"]'), p.text());
  p = boot(be, { ua: 'Mozilla/5.0 (Linux; Android 15; SM-S931N Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.0.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.14.5)' }); await p.w.__chanyang.ready;
  const intent = p.$('a[href^="intent://"]');
  ok('다른 앱 안의 화면(안드로이드): Chrome 으로 여는 단추', !p.$('#code') && !!intent && intent.getAttribute('href') === 'intent://nstepanet.github.io/chanyang/#Intent;scheme=https;package=com.android.chrome;end', intent && intent.getAttribute('href'));

  // ── 18. 승인제가 꺼져 있을 때 · 켜지는 순간 ─────────────────────────
  console.log('\n[18] 승인제를 끈 서버 · 앱만 올린 뒤 서버 설정을 실행하는 순간');
  be = makeBackend(); be.gate = { membersOnly: false };
  be.posts.push({ id: 'c1', kind: 'bulletin', title: '사진 글', body: '', meta: null, images: ['c1/1.jpg'], created_at: '2026-11-18T03:00:00+00:00' }); be.objects['c1/1.jpg'] = {};
  let o = boot(be); await o.w.__chanyang.ready;
  ok('꺼져 있으면 승인 없이 누구나 볼 수 있음', !o.locked() && o.S.posts.length === 4 && o.S.gate.ready && !o.S.gate.membersOnly);
  o.click('#tabs [data-screen=news]'); o.click('[data-act=seg][data-v=bulletin]'); o.click('#view .item'); await waitFor(() => o.$$('.shot img').length === 1, 'open-mode image');
  ok('꺼져 있어도 사진은 서버가 내어 준 주소로 보임 (보관함은 비공개이므로)', /object\/sign\/post-images\/c1\/1\.jpg/.test(o.$('.shot img').getAttribute('src')));
  be.gate.membersOnly = true; await o.sync();
  ok('승인제를 켜면 승인받지 않은 휴대폰은 바로 잠김', o.locked() && o.S.screen === 'gate');

  be = makeBackend();                                      // 앱만 먼저 올린 상태에서 쓰던 휴대폰
  const before = boot(be, { storage: { 'chanyang.notes': JSON.stringify({ 'noUNXF2j-uY': '내 설교 노트' }), 'chanyang.myPrayers': JSON.stringify([{ id: 'my-1', text: '가족을 위해', meta: '11월 18일' }]) } }); await before.w.__chanyang.ready;
  ok('(준비) 서버 설정 전에는 열려 있고 그 상태를 기억함', !before.locked() && JSON.parse(before.storage()['chanyang.gate']).ready === false && !!before.storage()['chanyang.postsCache']);
  be.gate = { membersOnly: true };                         // 서버 설정 실행
  const after = boot(be, { storage: before.storage() }); await after.w.__chanyang.ready;
  ok('서버 설정을 실행한 뒤 다시 열면 승인 화면으로 바뀜', after.locked() && after.S.screen === 'gate' && after.S.posts.length === 0, after.S.screen);
  ok('예전에 받아 둔 글은 휴대폰에서 지워짐', after.storage()['chanyang.postsCache'] === undefined);
  ok('설교 노트와 나의 기도제목 같은 개인 기록은 남아 있음', JSON.parse(after.storage()['chanyang.notes'])['noUNXF2j-uY'] === '내 설교 노트' && JSON.parse(after.storage()['chanyang.myPrayers']).length === 1 && after.S.myPrayers.length === 1);
  ok('오류 없음', o.w.__errors.length === 0 && after.w.__errors.length === 0, o.w.__errors.concat(after.w.__errors).join(' | '));

  // ── 19. 인터넷이 끊겼을 때 ───────────────────────────────────────
  console.log('\n[19] 승인제 + 인터넷 끊김');
  be = gated(); const choi = be.issue('최권사');
  let f = boot(be); await f.w.__chanyang.ready;
  f.type('#code', choi.code); f.click('[data-act=redeem]'); await waitFor(() => !f.S.busy && !f.locked(), 'approve for offline');
  be.offline = true;
  const off = boot(be, { storage: f.storage() }); await off.w.__chanyang.ready;
  ok('승인된 휴대폰은 끊겨도 마지막으로 받아 둔 글을 봄', !off.locked() && off.S.postsFrom === 'cache' && off.S.posts.length === 3, off.S.postsFrom);
  const newOff = boot(be); await newOff.w.__chanyang.ready;
  ok('처음 여는 휴대폰은 끊긴 동안 아무 내용도 보지 못함', newOff.locked() && /서버에 연결하지 못했습니다/.test(newOff.text()) && newOff.S.posts.length === 0 && !!newOff.$('[data-act=retry]'), newOff.text());
  be.offline = false; newOff.click('[data-act=retry]'); await waitFor(() => newOff.S.screen === 'gate' && !!newOff.$('#code'), 'retry');
  ok('다시 연결해 "다시 시도"를 누르면 승인 화면', newOff.S.screen === 'gate' && !!newOff.$('#code'));
  const lockedOff = boot(be, { storage: newOff.storage() });
  be.offline = true; await lockedOff.w.__chanyang.ready;
  ok('승인받지 않은 휴대폰은 끊겨도 계속 잠김', lockedOff.locked() && lockedOff.S.screen === 'gate' && lockedOff.S.posts.length === 0);
  be.offline = false;
  for (const x of [f, off, newOff, lockedOff]) ok('오류 없음', x.w.__errors.length === 0, x.w.__errors.join(' | '));

  // ── 20. 다섯 탭의 제목 앞 십자가 ───────────────────────────────────
  console.log('\n[20] 다섯 탭의 제목 앞에 십자가');
  const marked = (x) => x.$('#title').classList.contains('mark');
  be = gated(); const yoon = be.issue('윤성도');
  a = boot(be);
  ok('서버에 확인하는 동안에는 십자가가 없음', /확인하는 중/.test(a.text()) && !marked(a));
  await a.w.__chanyang.ready;
  ok('승인 화면에는 넣지 않음 (지금 그대로)', a.S.screen === 'gate' && !marked(a) && a.$('#title').textContent === '찬양하는교회');
  a.click('[data-screen=login]');
  ok('승인 전 관리자 로그인 화면에도 없음', a.S.screen === 'login' && !marked(a));
  a.click('#back');
  a.type('#code', yoon.code); a.click('[data-act=redeem]'); await waitFor(() => !a.locked() && a.S.screen === 'home', 'redeem for mark');
  const TAB_TITLES = [['home', '찬양하는교회'], ['sermons', '설교 · 예배 영상'], ['news', '소식 · 주보 · 일정'], ['prayer', '기도제목'], ['more', '더보기']];
  const seen = TAB_TITLES.map(([tab, title]) => { a.click('#tabs [data-screen=' + tab + ']'); return tab + ':' + (marked(a) && a.$('#title').textContent === title && a.$('#back').hidden); });
  ok('승인된 휴대폰: 다섯 탭의 첫 화면 모두 제목 앞에 십자가', seen.every((x) => x.endsWith(':true')), seen.join(' '));
  ok('제목 글자는 그대로 (십자가는 글자가 아니라 꾸밈으로 들어감)', a.$('#title').textContent === '더보기' && a.$('#title').children.length === 0);
  const inner = ['info', 'noti', 'login'].map((scr) => { a.w.__chanyang.go(scr); return scr + ':' + (a.S.screen === scr && !marked(a) && !a.$('#back').hidden); });
  ok('뒤로 가기 화살표가 있는 안쪽 화면에는 없음 (예배 안내, 새 소식, 관리자 로그인)', inner.every((x) => x.endsWith(':true')), inner.join(' '));
  a.click('#tabs [data-screen=sermons]'); a.click('[data-act=sermon]');
  ok('설교 보기 화면에도 없음', a.S.screen === 'sermon' && !marked(a), a.S.screen);
  a.click('#back');
  ok('뒤로 돌아오면 다시 보임', a.S.screen === 'sermons' && marked(a), a.S.screen);
  a.click('#tabs [data-screen=more]'); await adminLogin(a);
  const adminInner = ['members', 'post'].map((scr) => { a.w.__chanyang.go(scr); return scr + ':' + (a.S.screen === scr && !marked(a)); });
  ok('관리자 화면(성도 승인, 글 올리기)에도 없음', adminInner.every((x) => x.endsWith(':true')), adminInner.join(' '));
  a.click('#tabs [data-screen=home]');
  ok('관리자로 들어와 있어도 탭 화면에는 보임', marked(a) && a.S.screen === 'home');
  const legacy = boot(makeBackend()); await legacy.w.__chanyang.ready;
  ok('성도 승인을 쓰지 않는 서버에서도 홈 제목 앞에 십자가', legacy.S.screen === 'home' && marked(legacy));
  const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
  const markFile = path.join(root, 'img/cross-mark.png');
  const markPng = fs.existsSync(markFile) ? fs.readFileSync(markFile) : null;
  ok('십자가 그림 파일이 있고(바탕이 투명한 PNG), 화면 꾸밈 파일이 그 그림을 제목 앞에 넣음',
    !!markPng && markPng.subarray(1, 4).toString() === 'PNG' && markPng[25] === 6 && markPng.readUInt32BE(20) >= 84 &&
    /#bar h1\.mark::before \{[^}]*url\(img\/cross-mark\.png\)/.test(css) && /#bar h1\.mark \{[^}]*display: flex/.test(css), markPng ? 'color ' + markPng[25] + ' h ' + markPng.readUInt32BE(20) : '파일 없음');
  ok('작은 십자가도 휴대폰 보관 목록에 들어 있음', shell.includes('img/cross-mark.png'));
  for (const x of [a, legacy]) ok('오류 없음', x.w.__errors.length === 0, x.w.__errors.join(' | '));

  process.exit(result() ? 1 : 0);
})().catch((e) => { console.error('점검 중단:', e); process.exit(2); });
