// 모든 자동 검사를 차례로 돌리고 합계를 보여 줍니다. (dev 폴더에서)
//   npm test                 전부
//   npm test -- theme        이름에 theme 이 들어간 묶음만
//   npm test -- -v           통과한 줄까지 모두 보기
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const verbose = args.includes('-v');
const filters = args.filter((a) => !a.startsWith('-'));

// 서버 설정(SQL) → 앱 → 복사 페이지 → 아이콘·휴대폰 보관 → 개발용 도구 순서로 돌립니다.
const ORDER = ['sql-1-setup', 'sql-2-members', 'sql-3-theme', 'app-1-posts', 'app-2-members', 'app-3-theme', 'copy-page', 'icons-sw', 'server-status'];
const nameOf = (f) => f.replace(/\.test\.(js|mjs)$/, '');
const rank = (f) => { const i = ORDER.indexOf(nameOf(f)); return i < 0 ? ORDER.length : i; };
const files = readdirSync(path.join(here, 'tests'))
  .filter((f) => /\.test\.(js|mjs)$/.test(f))
  .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)));

if (!files.length) { console.log('돌릴 검사가 없습니다: ' + filters.join(', ')); process.exit(1); }

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, 'tests', file)], { cwd: here, env: { ...process.env, V: verbose ? '1' : '' } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (verbose) process.stdout.write(d); });
    child.stderr.on('data', (d) => { out += d; if (verbose) process.stderr.write(d); });
    const timer = setTimeout(() => { out += '\n(5분이 지나도 끝나지 않아 멈췄습니다)\n'; child.kill(); }, 300000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

const started = Date.now();
let pass = 0, fail = 0, broken = 0;
for (const file of files) {
  const { code, out } = await run(file);
  const m = [...out.matchAll(/결과: (\d+) 통과, (\d+) 실패/g)].pop();
  const p = m ? Number(m[1]) : 0, f = m ? Number(m[2]) : 0;
  const bad = !m || code !== 0 || f > 0;
  pass += p; fail += f; if (!m || (code !== 0 && f === 0)) { broken++; }
  console.log((bad ? ' 실패 ' : '  ok  ') + nameOf(file).padEnd(16) + String(p).padStart(4) + ' 통과' + (f ? ', ' + f + ' 실패' : '') + (!m ? '  (끝까지 돌지 못함)' : ''));
  if (bad && !verbose) {
    const lines = out.split('\n');
    const shown = lines.filter((l) => /^\s*FAIL /.test(l));
    // 검사가 중간에 멈췄으면 마지막 몇 줄(오류 내용)을 보여 줍니다.
    (shown.length ? shown : lines.filter((l) => l.trim()).slice(-12)).forEach((l) => console.log('      ' + l.trimEnd()));
  }
}
const secs = Math.round((Date.now() - started) / 1000);
console.log('\n모두 ' + pass + ' 통과, ' + fail + ' 실패' + (broken ? ', 끝까지 돌지 못한 묶음 ' + broken + '개' : '') + '  (' + files.length + '묶음, ' + secs + '초)');
process.exit(fail || broken ? 1 : 0);
