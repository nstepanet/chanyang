// 미리보기 서버: 저장소의 앱 파일을 이 컴퓨터에서 그대로 보여 줍니다. 파일을 고치고 새로 고치면 바로 보입니다.
//
//   node preview/serve.mjs              가짜 서버를 끼운 미리보기  → http://127.0.0.1:8765/
//                                       실제 서버(Supabase)에 아무것도 보내지 않습니다. 고를 수 있는 상황은 preview-stub.js 맨 위에 있습니다.
//   node preview/serve.mjs --real       앱 그대로. 실제 서버에 연결되므로 글을 올리거나 승인번호를 넣지 마세요.
//   node preview/serve.mjs --port 9000  다른 포트로
//
// 휴대폰 보관(서비스 워커)은 https 주소에서만 켜지므로, 미리보기에서는 동작하지 않습니다. 그 점검은 sw-check.mjs 로 합니다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.sql': 'application/sql; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2'
};
const LIB = '<script src="vendor/supabase.js"></script>';
const STUB = '<script src="dev/preview/preview-stub.js"></script>\n';

// stub: true 면 index.html 에 가짜 서버(preview-stub.js)를 끼워 넣습니다. port: 0 이면 비어 있는 포트를 고릅니다.
export function startServer({ port = 8765, stub = true } = {}) {
  const server = http.createServer((req, res) => {
    const fail = (code, text) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); };
    if (req.method !== 'GET' && req.method !== 'HEAD') { return fail(405, '읽기만 됩니다'); }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname); } catch (e) { return fail(400, '잘못된 주소'); }
    if (pathname.endsWith('/')) { pathname += 'index.html'; }
    const file = path.join(ROOT, pathname);
    // 저장소 밖의 파일, 숨김 폴더(.git), 내려받은 도구(node_modules)는 내주지 않습니다.
    if (!file.startsWith(ROOT + path.sep) || /(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(path.relative(ROOT, file))) { return fail(404, '없는 파일'); }
    fs.readFile(file, (err, buf) => {
      if (err) { return fail(404, '없는 파일'); }
      let body = buf;
      if (stub && pathname === '/index.html') {
        const html = buf.toString('utf8');
        if (!html.includes(LIB)) { return fail(500, 'index.html 에서 ' + LIB + ' 줄을 찾지 못해 미리보기용 가짜 서버를 끼우지 못했습니다.'); }
        body = Buffer.from(html.replace(LIB, STUB + LIB));
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolve({ url: 'http://127.0.0.1:' + actual + '/', port: actual, stub, close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }) });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const real = args.includes('--real');
  const port = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 8765;
  try {
    const s = await startServer({ port, stub: !real });
    console.log('미리보기: ' + s.url + (real ? '' : '?theme=bright&open=1&tab=home'));
    console.log(real
      ? '앱 그대로입니다. 실제 서버에 연결되므로 글을 올리거나 승인번호를 넣지 마세요.'
      : '가짜 서버를 끼운 미리보기입니다. 실제 서버에는 아무것도 보내지 않습니다. 주소 뒤에 붙일 수 있는 값은 dev/preview/preview-stub.js 맨 위에 있습니다.');
    console.log('끝내려면 Ctrl+C');
  } catch (e) {
    console.log(e.code === 'EADDRINUSE' ? port + '번 포트를 다른 프로그램이 쓰고 있습니다. --port 로 다른 번호를 주세요.' : '서버를 켜지 못했습니다: ' + e.message);
    process.exit(1);
  }
}
