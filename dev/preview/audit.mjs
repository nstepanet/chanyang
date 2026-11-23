// 화면 점검: 모든 화면을 디자인별·화면 폭별로 실제 브라우저에 띄워, 눈으로 놓치기 쉬운 것을 숫자로 찾아냅니다.
//   문제 (하나라도 있으면 실패로 끝남): 가로로 넘치는 화면, 화면 밖으로 나간 요소, 잘리거나 삐져나온 글자, 깨진 그림, 받지 못한 파일, 오류
//   참고 (보기만 함): 두 줄로 꺾인 단추·꼬리표 글자, 너무 낮은 누르는 곳
//
//   node preview/audit.mjs                          세 디자인 × 폭 390·360·320 × 화면 21개 (5분쯤)
//   node preview/audit.mjs bright,warm 360          디자인과 폭을 골라서
//   node preview/audit.mjs bright 360 --only 04-home,19-design
//   node preview/audit.mjs warm 360 --shots         화면도 찍어 dev/out/shots/<디자인>-<폭>/ 에 둠  (--out 폴더 로 바꿀 수 있음)
//
// 미리보기용 가짜 서버(preview-stub.js)로 띄우므로 실제 서버에는 아무것도 보내지 않습니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { launch } from './browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flagValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const plain = args.filter((a, i) => !a.startsWith('--') && !['--only', '--out'].includes(args[i - 1]));
const themes = (plain[0] || 'bright,warm,classic').split(',');
const widths = (plain[1] || '390,360,320').split(',').map(Number);
const only = flagValue('--only') ? flagValue('--only').split(',') : null;
const shotDir = args.includes('--shots') || flagValue('--out') ? path.resolve(flagValue('--out') || path.join(here, '..', 'out', 'shots')) : '';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const KAKAO = 'Mozilla/5.0 (Linux; Android 15; SM-S931N Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.0.0 Mobile Safari/537.36;KAKAOTALK 25.9.0';
// [이름, 미리보기 주소에 붙일 값, 브라우저 종류]. 화면을 새로 만들면 여기에 한 줄 더합니다.
const SCREENS = [
  ['01-gate', '', ANDROID], ['02-gate-ios', 'noinstall=1', IOS], ['03-gate-kakao', 'noinstall=1', KAKAO],
  ['04-home', 'open=1&tab=home'], ['05-sermons', 'open=1&tab=sermons&note=1'], ['06-sermon', 'open=1&tab=sermon&note=1'], ['06b-sermon-outline', 'open=1&tab=sermon&outline=1'],
  ['07-news', 'open=1&tab=news&seg=news'], ['08-events', 'open=1&tab=news&seg=event'], ['09-empty', 'open=1&tab=news&seg=bulletin&posts=0'],
  ['10-detail', 'open=1&tab=detail&post=n-20261117'], ['11-prayer', 'open=1&tab=prayer&prayers=1'], ['12-more', 'open=1&tab=more'],
  ['13-info', 'open=1&tab=info'], ['14-login', 'open=1&tab=login&err=1'], ['15-noti', 'open=1&tab=noti'],
  ['16-more-admin', 'open=1&admin=1&tab=more'], ['17-post', 'open=1&admin=1&tab=post&files=1'], ['18-members', 'open=1&admin=1&tab=members&issue=1'],
  ['19-design', 'open=1&admin=1&tab=design'], ['20-design-setup', 'notheme=1&open=1&admin=1&tab=design'], ['21-detail-admin', 'open=1&admin=1&tab=detail&post=e-20261225']
];

// 화면 안에서 돌리는 검사. 문제는 '!' 로, 참고는 '~' 로, 화면 정보는 '@' 로 시작하는 줄로 돌려줍니다.
const CHECK = `(async () => {
  try { await document.fonts.ready; } catch (e) {}
  await new Promise((r) => setTimeout(r, 120));
  const W = window.innerWidth, out = [];
  const de = document.documentElement;
  const label = (el) => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '') + ' "' + (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 26) + '"');
  if (de.scrollWidth > W + 1) out.push('!가로로 넘침: 문서 폭 ' + de.scrollWidth + ' > ' + W);
  const inScroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return true; } return false; };
  // 그 요소에 직접 적힌 글자가 몇 줄로 보이는지 (안에 든 다른 요소의 글자는 세지 않음)
  const lines = (el) => { const tops = new Set(); for (const n of el.childNodes) { if (n.nodeType !== 3 || !n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) { if (b.width > 0.5) tops.add(Math.round(b.top / 4)); } } return tops.size; };
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) continue;
    if (el.closest('[hidden]')) continue;
    if ((r.right > W + 1 || r.left < -1) && !inScroller(el)) out.push('!화면 밖: ' + label(el) + ' ' + Math.round(r.left) + '~' + Math.round(r.right));
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (s.display !== 'inline' && el.scrollWidth > el.clientWidth + 1 && !/(auto|scroll)/.test(s.overflowX) && (hasText || el.children.length)) {
      out.push((s.overflowX === 'visible' ? '!옆으로 삐져나옴: ' : '!옆이 잘림: ') + label(el) + ' ' + el.scrollWidth + ' > ' + el.clientWidth + (s.textOverflow === 'ellipsis' ? ' (말줄임 처리)' : ''));
    }
    if (s.display !== 'inline' && el.scrollHeight > el.clientHeight + 2 && !/(auto|scroll)/.test(s.overflowY) && el !== document.body && el.clientHeight > 0 && (hasText || /^(BUTTON|A|LABEL)$/.test(el.tagName))) {
      out.push((s.overflowY === 'visible' ? '!아래로 삐져나옴: ' : '!아래가 잘림: ') + label(el) + ' ' + el.scrollHeight + ' > ' + el.clientHeight);
    }
    if (hasText && (el.matches('button:not(.item), a.btn, .btn, .chip, .tag, h1, .h') || el.closest('#tabs, .tile, .seg, .tag, .chip, .hero'))) {
      const n = lines(el); if (n > 1) out.push('~글자가 ' + n + '줄: ' + label(el));
    }
    if (el.matches('button, a.btn, .btn, input, select, textarea, .chip') && !el.disabled && r.height < 40 && !el.matches('input[type=file], input[type=checkbox], input[type=radio]')) out.push('~누르는 곳 높이 ' + Math.round(r.height) + ': ' + label(el));
    if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0) out.push('!그림 깨짐: ' + el.getAttribute('src'));
  }
  const view = document.getElementById('view');
  out.push('@' + JSON.stringify({ theme: de.getAttribute('data-theme'), title: (document.querySelector('#bar h1') || {}).textContent, fonts: [...document.fonts].filter((f) => f.status === 'loaded').length, family: getComputedStyle(document.body).fontFamily.split(',')[0], h: view ? view.scrollHeight : 0 }));
  return out;
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = await startServer({ port: 0, stub: true });
let browser;
try { browser = await launch(); } catch (e) { console.log(e.message); await server.close(); process.exit(2); }
const { send, evaluate, takeEvents } = browser;
const bail = setTimeout(async () => { console.log('15분이 지나도 끝나지 않아 멈춥니다.'); await browser.close(); await server.close(); process.exit(2); }, 900000);

let problems = 0, notes = 0;
const summary = [];
for (const th of themes) {
  for (const w of widths) {
    for (const [name, q, ua] of SCREENS) {
      if (only && !only.includes(name)) { continue; }
      takeEvents();
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setUserAgentOverride', { userAgent: ua || ANDROID });
      // 20번 화면은 "서버에 3단계 설정이 없는데 휴대폰에는 지난번 디자인이 남아 있는" 경우라서, 디자인을 받아 둔 값으로만 줍니다.
      const query = (name === '20-design-setup' ? 'cached=' + th : 'theme=' + th) + (q ? '&' + q : '');
      await send('Page.navigate', { url: server.url + 'index.html?' + query });
      for (let i = 0; i < 40; i++) { await sleep(100); if (await evaluate('document.readyState === "complete" && !!window.__chanyang') === true) { break; } }
      await sleep(750);
      const found = await evaluate(CHECK);
      const list = Array.isArray(found) ? found : ['!검사를 돌리지 못함: ' + String(found).slice(0, 200)];
      const info = list.filter((x) => x[0] === '@').map((x) => JSON.parse(x.slice(1)))[0] || {};
      const bad = list.filter((x) => x[0] === '!').map((x) => x.slice(1));
      const mild = list.filter((x) => x[0] === '~').map((x) => x.slice(1));
      for (const e of takeEvents()) {
        if (e.method === 'Network.responseReceived' && e.params.response.status >= 400 && e.params.response.url.startsWith(server.url)) { bad.push('받지 못한 파일: ' + e.params.response.status + ' ' + e.params.response.url.replace(server.url, '')); }
        if (e.method === 'Runtime.exceptionThrown') { bad.push('오류: ' + String((e.params.exceptionDetails.exception || {}).description || e.params.exceptionDetails.text).slice(0, 200)); }
        if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') { bad.push('오류 기록: ' + e.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200)); }
      }
      const wantTheme = name === '20-design-setup' ? 'bright' : th;   // 설정 전의 서버에서는 처음 값(밝은 화면)으로 보여야 함
      if (info.theme !== wantTheme) { bad.push('디자인이 다름: ' + info.theme + ' (기대 ' + wantTheme + ')'); }
      problems += bad.length; notes += mild.length;
      summary.push({ th, w, bad: bad.length, mild: mild.length, fonts: info.fonts, family: info.family });
      if (bad.length || mild.length) {
        console.log(`\n[${th} ${w}] ${name}  (제목: ${info.title})`);
        for (const x of [...new Set(bad)]) { console.log('   문제 · ' + x); }
        for (const x of [...new Set(mild)]) { console.log('   참고 · ' + x); }
      }
      if (shotDir) {
        const dir = path.join(shotDir, th + '-' + w);
        fs.mkdirSync(dir, { recursive: true });
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: Math.min(Math.max(800, (info.h || 0) + 150), 1500), deviceScaleFactor: 2, mobile: true });
        await sleep(120);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        if (shot.result && shot.result.data) { fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(shot.result.data, 'base64')); }
      }
    }
  }
}
console.log('\n── 요약 ──');
for (const th of themes) {
  for (const w of widths) {
    const rows = summary.filter((r) => r.th === th && r.w === w);
    if (!rows.length) { continue; }
    const sum = (key) => rows.reduce((a, r) => a + r[key], 0);
    console.log(`${th} ${w}px: 화면 ${rows.length}개, 문제 ${sum('bad')}건, 참고 ${sum('mild')}건, 글꼴 ${[...new Set(rows.map((r) => r.family))].join(' / ')}`);
  }
}
console.log(`모두 문제 ${problems}건, 참고 ${notes}건` + (shotDir ? `  ·  찍은 화면: ${shotDir}` : ''));
clearTimeout(bail);
await browser.close(); await server.close();
process.exit(problems ? 1 : 0);
