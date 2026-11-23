// 서버 설정 복사 페이지 점검
const { JSDOM } = require('jsdom'); const fs = require('fs'); const path = require('path');
const root = path.resolve(__dirname, '..', '..', 'supabase') + '/';
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : ' FAIL ') + n + (x !== undefined && !c ? '  → ' + x : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open({ translate, noClipboard, missing } = {}) {
  const html = fs.readFileSync(root + 'index.html', 'utf8');
  const dom = new JSDOM(html, { url: 'https://nstepanet.github.io/chanyang/supabase/', runScripts: 'outside-only' });
  const w = dom.window; const copied = [];
  w.fetch = async (u) => { const name = String(u).split('?')[0]; if (name === missing) { return new Response('Not Found', { status: 404 }); } let t = fs.readFileSync(root + name, 'utf8'); if (translate) t = t.replace(/create schema if not exists app_private;/, 'app_private 스키마가 존재하지 않으면 생성합니다.').replace(/create table if not exists public\.members/, 'public.members 표를 만듭니다').replace(/create table if not exists public\.app_look/, 'public.app_look 표를 만듭니다'); return new Response(t, { status: 200 }); };
  if (!noClipboard) Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => { copied.push(t); } }, configurable: true });
  w.document.execCommand = () => { copied.push('execCommand:' + w.document.activeElement.value); return true; };
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  w.eval(script); await sleep(60);
  return { w, d: w.document, copied };
}
(async () => {
  const setup = fs.readFileSync(root + 'setup.sql', 'utf8'), members = fs.readFileSync(root + 'members.sql', 'utf8'), theme = fs.readFileSync(root + 'theme.sql', 'utf8');
  let p = await open();
  const bm = p.d.querySelector('[data-copy=members]'), bs = p.d.querySelector('[data-copy=setup]'), bt = p.d.querySelector('[data-copy=theme]');
  ok('세 단추가 준비됨', !bm.disabled && !bs.disabled && !bt.disabled && /준비되었습니다/.test(p.d.getElementById('status-members').textContent) && /준비되었습니다/.test(p.d.getElementById('status-theme').textContent));
  bm.click(); await sleep(20);
  ok('2단계 단추: members.sql 원본이 글자 하나 다르지 않게 복사됨', p.copied[0] === members, (p.copied[0] || '').length + ' vs ' + members.length);
  ok('복사 안내에 줄 수 표시', new RegExp('복사했습니다 \\(' + members.trim().split('\n').length + '줄\\)').test(p.d.getElementById('status-members').textContent), p.d.getElementById('status-members').textContent);
  bs.click(); await sleep(20);
  ok('1단계 단추: setup.sql 원본이 그대로 복사됨', p.copied[1] === setup);
  const t = [...p.d.querySelectorAll('[data-text]:not([data-say])')]; t[0].click(); await sleep(20); t[1].click(); await sleep(20);
  ok('끄기·켜기 한 줄 복사', t.length === 2 && p.copied[2] === 'select app_private.set_members_only(false);' && p.copied[3] === 'select app_private.set_members_only(true);', p.copied.slice(2).join(' | '));
  ok('끄기·켜기 결과는 그 단추 아래에 표시', /복사했습니다: select app_private\.set_members_only\(true\);/.test(p.d.getElementById('status-toggle').textContent) && p.d.getElementById('status-look').textContent === '');
  ok('번역 방지 표시가 있음', p.d.documentElement.getAttribute('translate') === 'no' && !!p.d.querySelector('meta[name=google][content=notranslate]'));
  ok('Supabase 설정·SQL Editor 로 가는 주소', !!p.d.querySelector('a[href="https://supabase.com/dashboard/project/nagicayumoqssqeozmze/auth/providers"]') && !!p.d.querySelector('a[href="https://supabase.com/dashboard/project/nagicayumoqssqeozmze/sql/new"]'));

  // ---- 3단계 · 화면 디자인 ----
  bt.click(); await sleep(20);
  ok('3단계 단추: theme.sql 원본이 글자 하나 다르지 않게 복사됨', p.copied[4] === theme, (p.copied[4] || '').length + ' vs ' + theme.length);
  ok('3단계 복사 안내에 줄 수 표시', new RegExp('복사했습니다 \\(' + theme.trim().split('\n').length + '줄\\)').test(p.d.getElementById('status-theme').textContent), p.d.getElementById('status-theme').textContent);
  ok('3단계 아래 칸에도 원본이 들어 있음', p.d.getElementById('box-theme').value === theme && p.d.getElementById('box-theme').getAttribute('translate') === 'no');
  const look = [...p.d.querySelectorAll('[data-text][data-say=look]')];
  for (const b of look) { b.click(); await sleep(20); }
  ok('디자인을 바꾸는 한 줄 세 가지', look.length === 3 && p.copied.slice(5).join('|') === "select app_private.set_theme('bright');|select app_private.set_theme('warm');|select app_private.set_theme('classic');", p.copied.slice(5).join('|'));
  ok('한 줄에 적힌 이름이 단추 글과 맞음', /밝은 화면/.test(look[0].textContent) && /따뜻한 화면/.test(look[1].textContent) && /클래식 화면/.test(look[2].textContent));
  ok('디자인 한 줄의 결과는 3단계 칸 안에 표시', /복사했습니다: select app_private\.set_theme\('classic'\);/.test(p.d.getElementById('status-look').textContent) && /set_members_only\(true\)/.test(p.d.getElementById('status-toggle').textContent));
  ok('한 줄에서 부르는 함수가 theme.sql 에 실제로 있고, 세 값을 모두 받음', /create or replace function app_private\.set_theme\(new_theme text\)/.test(theme) && /new_theme not in \('bright', 'warm', 'classic'\)/.test(theme));
  const cards = [...p.d.querySelectorAll('.card')];
  ok('3단계가 맨 위 칸이고 펼쳐져 있음', /3단계 · 화면 디자인/.test(cards[0].querySelector('h2').textContent) && bt.closest('.card') === cards[0] && !bt.closest('details'));
  ok('이미 실행한 2단계와 1단계는 접혀 있음', !!bm.closest('details') && !bm.closest('details').open && /이미 실행했습니다/.test(bm.closest('.card').querySelector('summary').textContent) && !bs.closest('details').open);
  const text3 = cards[0].textContent;
  ok('3단계 안내: 어디서 고르는지, 결과 표에서 무엇을 보는지', /더보기 → 화면 디자인/.test(text3) && /밝은 화면 · 따뜻한 화면 · 클래식 화면/.test(text3) && /화면 디자인 칸에 밝은 화면/.test(text3.replace(/\s+/g, ' ')));
  ok('3단계 결과 표의 칸 이름이 theme.sql 과 같음', /as "화면 디자인"/.test(theme) && /when 'bright' then '밝은 화면'/.test(theme));

  p = await open({ translate: true });
  ok('내용이 번역되어 바뀐 경우에는 복사를 막음', p.d.querySelector('[data-copy=members]').disabled && p.d.querySelector('[data-copy=setup]').disabled && p.d.querySelector('[data-copy=theme]').disabled && /불러오지 못했습니다/.test(p.d.getElementById('status-members').textContent) && /불러오지 못했습니다/.test(p.d.getElementById('status-theme').textContent));
  p = await open({ noClipboard: true });
  p.d.querySelector('[data-copy=members]').click(); await sleep(20);
  ok('자동 복사가 없는 브라우저: 아래 칸을 골라 복사', p.copied[0] === 'execCommand:' + members && p.d.getElementById('box-members').closest('details').open);
  p.d.querySelector('[data-copy=theme]').click(); await sleep(20);
  ok('자동 복사가 없는 브라우저: 3단계도 아래 칸을 골라 복사', p.copied[1] === 'execCommand:' + theme && p.d.getElementById('box-theme').closest('details').open);
  p = await open({ missing: 'theme.sql' });
  ok('3단계 파일만 못 불러와도 다른 단추는 그대로 쓸 수 있음', p.d.querySelector('[data-copy=theme]').disabled && /불러오지 못했습니다/.test(p.d.getElementById('status-theme').textContent) && !p.d.querySelector('[data-copy=members]').disabled && !p.d.querySelector('[data-copy=setup]').disabled);
  console.log(`\n결과: ${pass} 통과, ${fail} 실패`); process.exit(fail ? 1 : 0);
})();
