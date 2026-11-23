// 서버 상태 읽기 도구(dev/server-status.mjs) 점검: 가짜 서버를 상대로, 단계별 상태를 바르게 읽고 읽기만 하는지
const { makeBackend, ok, result, SB } = require('./harness');
const path = require('path'); const fs = require('fs');

(async () => {
  const { readStatus, readConfig, describe } = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'server-status.mjs')).href);
  const cfg = readConfig();
  ok('서버 주소와 공개용 키를 앱의 config.js 에서 읽음', cfg.url === SB && /^sb_publishable_/.test(cfg.key), cfg.url);
  const ask = (be) => readStatus({ url: cfg.url, key: cfg.key, fetch: be.fetch });

  let be = makeBackend();   // 1단계만 실행한 서버
  let s = await ask(be);
  ok('2단계·3단계 설정 전의 서버', s.members === 'not_ready' && s.theme === 'not_ready', JSON.stringify(s));
  ok('안내 글: 두 단계 모두 "설정 전"', /2단계.*설정 전/.test(describe(s)[0]) && /3단계.*설정 전/.test(describe(s)[1]), describe(s).join(' | '));

  be = makeBackend(); be.gate = { membersOnly: true };
  s = await ask(be);
  ok('2단계까지 실행한 서버 (성도 승인 켜짐, 화면 디자인은 설정 전)', s.members === 'on' && s.theme === 'not_ready', JSON.stringify(s));

  be.gate = { membersOnly: false }; be.theme = 'warm';
  s = await ask(be);
  ok('성도 승인을 꺼 둔 서버, 따뜻한 화면', s.members === 'off' && s.theme === 'warm' && /꺼짐/.test(describe(s)[0]) && /따뜻한 화면/.test(describe(s)[1]), describe(s).join(' | '));

  be.gate = { membersOnly: true }; be.theme = 'bright';
  s = await ask(be);
  ok('3단계까지 실행한 서버, 밝은 화면', s.members === 'on' && s.theme === 'bright' && /밝은 화면/.test(describe(s)[1]));
  be.theme = 'classic';
  ok('클래식 화면', /클래식 화면/.test(describe(await ask(be))[1]));

  // 읽기만 하는지: 보낸 요청은 두 가지 질문뿐이고, 로그인·가입·글·사진 쪽은 건드리지 않음
  const sent = [...new Set(be.log)].sort().join(', ');
  ok('서버에 보낸 것은 두 가지 질문뿐 (로그인·가입·글 올리기 없음)', sent === 'POST /rest/v1/rpc/app_theme, POST /rest/v1/rpc/gate_status', sent);
  ok('서버의 내용이 바뀌지 않음', be.theme === 'classic' && be.members.length === 0 && be.posts.length === 3 && be.users.length === 2);
  const src = fs.readFileSync(path.join(__dirname, '..', 'server-status.mjs'), 'utf8');
  ok('도구에 로그인이나 쓰기 기능이 들어 있지 않음', !/auth\/v1|signIn|signUp|password|admin_|redeem|storage\/v1|\/rest\/v1\/posts/.test(src));

  let threw = false;
  be.offline = true;
  try { await ask(be); } catch (e) { threw = true; }
  ok('연결이 안 되면 오류로 알려 줌 (틀린 상태를 지어내지 않음)', threw);
  be.offline = false;
  const wrongKey = await readStatus({ url: cfg.url, key: 'sb_publishable_wrong', fetch: be.fetch });
  ok('키가 틀리면 "확인하지 못함"', wrongKey.members === 'error' && wrongKey.theme === 'error' && /확인하지 못함/.test(describe(wrongKey).join(' ')), JSON.stringify(wrongKey));

  process.exit(result() ? 1 : 0);
})().catch((e) => { console.error('점검 중단:', e); process.exit(2); });
