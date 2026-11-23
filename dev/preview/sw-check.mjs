// 휴대폰 보관(서비스 워커) · 설치 정보 · 글꼴을 실제 브라우저로 점검합니다. sw.js, manifest, 아이콘, 글꼴을 고쳤을 때 돌립니다.
//
//   node preview/sw-check.mjs
//
// 확인하는 것
//   1. 서비스 워커가 설치되고 보관 목록(sw.js 의 SHELL)을 모두 받아 두는지, 글꼴은 따로 보관되는지
//   2. 설치 정보(manifest)에 오류가 없고 아이콘이 모두 열리는지
//   3. 인터넷(여기서는 미리보기 서버)이 끊겨도 화면과 글꼴이 나오는지
//   4. (참고) 디자인마다 처음 받는 글꼴의 양
// 실제 서버(Supabase)로 가는 요청은 막아 두고 돌리므로, 서버에는 아무것도 보내지 않습니다.
import fs from 'node:fs';
import path from 'node:path';
import { startServer, ROOT } from './serve.mjs';
import { launch } from './browser.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log((cond ? '  ok  ' : ' FAIL ') + name + (extra !== undefined && !cond ? '  → ' + extra : '')); };

const swSource = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const VERSION = (swSource.match(/const VERSION = '([^']+)'/) || [])[1];
const FONTS = (swSource.match(/const FONTS = '([^']+)'/) || [])[1];
const SHELL = ((swSource.match(/const SHELL = \[([\s\S]*?)\];/) || ['', ''])[1].match(/'[^']+'/g) || []).map((x) => x.slice(1, -1));

const real = await startServer({ port: 0, stub: false });    // 저장소 그대로
const stub = await startServer({ port: 0, stub: true });     // 가짜 서버를 끼운 미리보기 (글꼴 양을 잴 때)
let browser;
try { browser = await launch(); } catch (e) { console.log(e.message); await real.close(); await stub.close(); process.exit(2); }
const { send, evaluate, takeEvents } = browser;
const bail = setTimeout(async () => { console.log('5분이 지나도 끝나지 않아 멈춥니다.'); await browser.close(); process.exit(2); }, 300000);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Network.setBlockedURLs', { urls: ['*supabase.co*'] });
const json = async (expression) => { const v = await evaluate(expression); try { return JSON.parse(v); } catch (e) { return { error: String(v).slice(0, 300) }; } };
const CACHES = `(async () => { const out = {}; for (const n of await caches.keys()) { const c = await caches.open(n); out[n] = (await c.keys()).map((r) => new URL(r.url).pathname.replace(/^\\//, '')); } return JSON.stringify(out); })()`;
const SCREEN = `(async () => { try { await document.fonts.ready; } catch (e) {} await new Promise((r) => setTimeout(r, 300));
  const probe = (family) => { const s = document.createElement('span'); s.textContent = '서버에 연결하지 못했습니다'; s.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:40px;font-family:' + family; document.body.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return Math.round(w); };
  return JSON.stringify({ theme: document.documentElement.getAttribute('data-theme'), family: getComputedStyle(document.body).fontFamily.split(',')[0].replace(/"/g, ''),
    loaded: [...document.fonts].filter((f) => f.status === 'loaded').length, failed: [...document.fonts].filter((f) => f.status === 'error').length,
    sheets: [...document.styleSheets].map((s) => { try { return (s.href || 'inline').split('/').pop() + ':' + s.cssRules.length; } catch (e) { return 'x'; } }).join(' '),
    controlled: !!navigator.serviceWorker.controller, title: (document.querySelector('#bar h1') || {}).textContent, text: (document.getElementById('view') || {}).textContent.trim().slice(0, 30),
    withFont: probe('"Pretendard Variable", monospace'), without: probe('monospace') }); })()`;

// ── 1. 설치와 보관 ──
console.log('\n[1] 서비스 워커 설치와 보관');
await send('Page.navigate', { url: real.url }); await sleep(2500);
const state = await evaluate(`Promise.race([(async () => { await navigator.serviceWorker.register('sw.js'); const reg = await navigator.serviceWorker.ready; for (let i = 0; i < 80 && !(reg.active && reg.active.state === 'activated'); i++) await new Promise((r) => setTimeout(r, 100)); return reg.active && reg.active.state; })(), new Promise((r) => setTimeout(() => r('시간 초과'), 15000))])`);
ok('서비스 워커가 설치되어 자리 잡음', state === 'activated', state);
await send('Page.navigate', { url: real.url }); await sleep(3000);   // 서비스 워커가 화면을 맡은 상태로 다시 열기
const first = await json(SCREEN);
const stored = await json(CACHES);
const appCache = stored['chanyang-' + VERSION] || [];
const want = SHELL.map((f) => (f === './' ? '' : f));
ok(`앱 보관함(chanyang-${VERSION})에 보관 목록 ${SHELL.length}개가 모두 들어 있음`, want.every((f) => appCache.includes(f)), want.filter((f) => !appCache.includes(f)).join(', ') || JSON.stringify(Object.keys(stored)));
ok('예전 버전의 보관함이 남아 있지 않음', Object.keys(stored).every((n) => n === 'chanyang-' + VERSION || n === FONTS), Object.keys(stored).join(', '));
ok('서비스 워커가 화면을 맡고 있음', first.controlled === true, JSON.stringify(first));
ok(`글꼴은 따로(${FONTS}) 보관되고, 앱 보관함에는 섞이지 않음`, (stored[FONTS] || []).some((f) => /pretendard\.css$/.test(f)) && (stored[FONTS] || []).some((f) => /\.woff2$/.test(f)) && !appCache.some((f) => f.startsWith('fonts/')), JSON.stringify((stored[FONTS] || []).slice(0, 4)));
ok('처음 값(밝은 화면)과 그 글꼴로 보임', first.theme === 'bright' && first.family === 'Pretendard Variable' && first.loaded > 0 && first.failed === 0 && first.withFont !== first.without, JSON.stringify(first));

// ── 2. 설치 정보와 아이콘 ──
console.log('\n[2] 설치 정보(manifest)와 아이콘');
const man = await send('Page.getAppManifest');
const parsed = man.result && man.result.data ? JSON.parse(man.result.data) : null;
ok('설치 정보를 읽을 수 있고 오류가 없음', !!parsed && (man.result.errors || []).length === 0, JSON.stringify(man.result && man.result.errors));
const inst = await send('Page.getInstallabilityErrors');
const instErrors = (inst.result && inst.result.installabilityErrors) || [];
ok('브라우저가 "설치할 수 있는 앱"으로 인정함', instErrors.length === 0, JSON.stringify(instErrors));
const icons = await json(`(async () => { const m = await (await fetch('manifest.webmanifest')).json(); const out = [];
  const list = m.icons.map((i) => [i.src, i.sizes]).concat([[document.querySelector('link[rel=icon]').getAttribute('href'), '32x32'], [document.querySelector('link[rel=apple-touch-icon]').getAttribute('href'), '180x180']]);
  for (const [src, sizes] of list) { const img = new Image(); img.src = src; await img.decode().catch(() => {}); out.push({ src, sizes, real: img.naturalWidth + 'x' + img.naturalHeight }); }
  return JSON.stringify(out); })()`);
ok('아이콘 5개가 모두 열리고 적힌 크기와 같음', Array.isArray(icons) && icons.length === 5 && icons.every((i) => i.real === i.sizes), JSON.stringify(icons));

// ── 3. 인터넷이 끊긴 상태 ──
console.log('\n[3] 인터넷이 끊긴 상태 (미리보기 서버를 끄고 다시 열기)');
await real.close();
takeEvents();
await send('Page.navigate', { url: real.url }); await sleep(3000);
const off = await json(SCREEN);
ok('서버가 꺼져도 화면이 뜸', off.title === '찬양하는교회' && !!off.text && /app\.css:\d{2,}/.test(off.sheets || ''), JSON.stringify(off));
ok('받아 둔 글꼴이 그대로 입혀짐', off.family === 'Pretendard Variable' && off.loaded > 0 && off.failed === 0 && off.withFont !== off.without && /pretendard\.css:\d+/.test(off.sheets || ''), JSON.stringify(off));

// ── 4. 참고: 디자인마다 처음 받는 글꼴의 양 ──
console.log('\n[4] 참고: 디자인마다 받는 글꼴 (홈 화면만 / 다섯 탭과 예배 안내까지)');
await send('Network.setCacheDisabled', { cacheDisabled: true });
const fontStats = (events) => {
  const got = new Map();
  for (const e of events) { if (e.method === 'Network.requestWillBeSent' && /\/fonts\//.test(e.params.request.url)) { got.set(e.params.requestId, { url: e.params.request.url, bytes: 0 }); } }
  for (const e of events) { if (e.method === 'Network.loadingFinished' && got.has(e.params.requestId)) { got.get(e.params.requestId).bytes = e.params.encodedDataLength; } }
  const all = [...got.values()];
  const kb = (list) => Math.round(list.reduce((a, x) => a + x.bytes, 0) / 1024);
  return `파일 ${all.length}개, ${kb(all)}KB (목록 파일 ${kb(all.filter((x) => /\.css/.test(x.url)))}KB 포함)`;
};
for (const th of ['bright', 'warm', 'classic']) {
  takeEvents();
  let events = [];
  await send('Page.navigate', { url: `${stub.url}index.html?theme=${th}&cached=${th}&open=1&tab=home` });
  await sleep(2500); await evaluate('document.fonts.ready.then(() => 1)'); await sleep(300);
  events = events.concat(takeEvents());
  const home = fontStats(events);
  for (const tab of ['sermons', 'news', 'prayer', 'more', 'info']) { await evaluate(`window.__chanyang.go('${tab}'), 1`); await sleep(500); }
  await evaluate('document.fonts.ready.then(() => 1)'); await sleep(400);
  events = events.concat(takeEvents());
  console.log(`      ${th.padEnd(8)} ${home}  /  ${fontStats(events)}`);
}

console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
clearTimeout(bail);
await browser.close(); await stub.close();
process.exit(fail ? 1 : 0);
