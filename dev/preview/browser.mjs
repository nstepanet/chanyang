// 이 컴퓨터의 Chrome(또는 Edge)을 창 없이 띄워, 점검 도구가 화면을 열고 들여다볼 수 있게 합니다.
// 따로 내려받는 것은 없습니다. 브라우저를 찾지 못하면 CHROME_PATH 환경 변수에 실행 파일 경로를 적어 주세요.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findBrowser() {
  const env = process.env;
  if (env.CHROME_PATH) { return env.CHROME_PATH; }
  let list = [];
  if (process.platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    list = roots.map((r) => path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      .concat(roots.map((r) => path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')));
  } else if (process.platform === 'darwin') {
    list = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  } else {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      try { const found = execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); if (found) { list.push(found); } } catch (e) { /* 없는 이름 */ }
    }
  }
  return list.find((p) => fs.existsSync(p)) || null;
}

// 브라우저를 띄우고 한 화면(탭)에 연결합니다. 돌려주는 것:
//   send(method, params)   브라우저에 명령 (Chrome DevTools Protocol)
//   evaluate(식)           화면 안에서 자바스크립트를 돌린 결과
//   takeEvents()           그동안 브라우저가 알려 온 일(받은 파일, 오류 등)을 꺼내고 비움
//   close()                브라우저를 끄고 임시 폴더를 지움
export async function launch({ width = 390, height = 844 } = {}) {
  const exe = findBrowser();
  if (!exe) { throw new Error('Chrome 이나 Edge 를 찾지 못했습니다. CHROME_PATH 환경 변수에 실행 파일 경로를 적어 주세요.'); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chanyang-browser-'));
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', '--user-data-dir=' + dir, '--window-size=' + width + ',' + height];
  // 관리자(root)로 도는 리눅스 작업 환경에서는 이 옵션이 있어야 브라우저가 켜집니다. 보통의 PC 에서는 붙지 않습니다.
  if (process.platform === 'linux' && process.getuid && process.getuid() === 0) { args.push('--no-sandbox'); }
  if (process.env.BROWSER_FLAGS) { args.push(...process.env.BROWSER_FLAGS.split(/\s+/).filter(Boolean)); }
  args.push('about:blank');
  const child = spawn(exe, args, { stdio: 'ignore' });
  let closed = false;
  const close = async () => {
    if (closed) { return; }
    closed = true;
    try { child.kill(); } catch (e) { /* 이미 꺼짐 */ }
    for (let i = 0; i < 10; i++) { try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch (e) { await sleep(200); } }
  };
  try {
    // 브라우저가 고른 포트는 임시 폴더의 DevToolsActivePort 파일 첫 줄에 적힙니다.
    let port = 0;
    for (let i = 0; i < 150 && !port; i++) {
      try { port = Number(fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch (e) { /* 아직 안 켜짐 */ }
      if (!port) { await sleep(100); }
    }
    if (!port) { throw new Error('브라우저가 켜지지 않았습니다: ' + exe); }
    let page;
    for (let i = 0; i < 50 && !page; i++) {
      try { page = (await (await fetch('http://127.0.0.1:' + port + '/json')).json()).find((t) => t.type === 'page'); } catch (e) { /* 준비 중 */ }
      if (!page) { await sleep(100); }
    }
    if (!page) { throw new Error('브라우저 화면에 연결하지 못했습니다.'); }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('브라우저에 연결하지 못했습니다.')); });
    let id = 0, events = [];
    const waiting = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } else if (d.method) { events.push(d); }
    };
    const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; waiting.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) { return '오류: ' + ((r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text); }
      return r.result && r.result.result ? r.result.result.value : JSON.stringify(r);
    };
    await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable'); await send('Log.enable');
    return { exe, send, evaluate, takeEvents: () => { const got = events; events = []; return got; }, close: async () => { try { ws.close(); } catch (e) { /* 이미 닫힘 */ } await close(); } };
  } catch (e) {
    await close();
    throw e;
  }
}
