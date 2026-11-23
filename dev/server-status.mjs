// 실제 서버(Supabase)에 어느 단계의 설정까지 되어 있는지 읽어 보여 줍니다.
//
//   npm run server-status        (dev 폴더에서)
//
// 읽기만 합니다. 로그인하지 않고, 아무것도 만들거나 바꾸지 않습니다.
// 앱을 처음 여는 휴대폰이 서버에 하는 것과 똑같은 두 가지 질문(성도 승인이 켜져 있는지, 화면 디자인이 무엇인지)만 보냅니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEME_NAMES = { bright: '밝은 화면', warm: '따뜻한 화면', classic: '클래식 화면' };

// 앱이 쓰는 config.js 에서 서버 주소와 공개용 키를 읽습니다.
export function readConfig() {
  const text = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  return { url: (text.match(/supabaseUrl:\s*'([^']*)'/) || [])[1] || '', key: (text.match(/supabaseKey:\s*'([^']*)'/) || [])[1] || '' };
}

// 돌려주는 값
//   members: 'not_ready' (2단계 설정 전) | 'on' | 'off' | 'error'
//   theme:   'not_ready' (3단계 설정 전) | 'bright' | 'warm' | 'classic' | 'error'
export async function readStatus({ url, key, fetch: doFetch = fetch }) {
  const ask = async (fn) => {
    const r = await doFetch(url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: '{}' });
    let body = null;
    try { body = await r.json(); } catch (e) { /* 내용이 없는 답 */ }
    return { status: r.status, body };
  };
  const missing = (x) => x.status === 404 && !!x.body && x.body.code === 'PGRST202';   // 서버에 그 기능이 아직 없음 = 그 단계 설정 전
  const gate = await ask('gate_status');
  const theme = await ask('app_theme');
  return {
    members: missing(gate) ? 'not_ready' : gate.status === 200 && gate.body && typeof gate.body.members_only === 'boolean' ? (gate.body.members_only ? 'on' : 'off') : 'error',
    theme: missing(theme) ? 'not_ready' : theme.status === 200 && typeof theme.body === 'string' ? theme.body : 'error',
    answers: { gate_status: gate.status, app_theme: theme.status }
  };
}

export function describe(s) {
  const members = { not_ready: '설정 전 (2단계를 아직 실행하지 않음 → 누구나 글을 볼 수 있음)', on: '켜짐 (승인된 휴대폰과 관리자만 글을 볼 수 있음)', off: '꺼짐 (2단계는 실행했고, 지금은 누구나 볼 수 있음)', error: '확인하지 못함 (서버 답: ' + s.answers.gate_status + ')' }[s.members];
  const theme = s.theme === 'not_ready' ? '설정 전 (3단계를 아직 실행하지 않음 → 모든 휴대폰이 밝은 화면)'
    : s.theme === 'error' ? '확인하지 못함 (서버 답: ' + s.answers.app_theme + ')'
      : (THEME_NAMES[s.theme] || '이 앱이 모르는 값 "' + s.theme + '" → 밝은 화면으로 보임');
  return ['성도 승인 (2단계): ' + members, '화면 디자인 (3단계): ' + theme];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg = readConfig();
  if (!cfg.url || !cfg.key) { console.log('config.js 에 서버 주소와 공개용 키가 없습니다. (서버 없이 쓰는 상태)'); process.exit(1); }
  console.log('서버: ' + cfg.url);
  try {
    describe(await readStatus(cfg)).forEach((line) => console.log(line));
  } catch (e) {
    console.log('서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요. (' + ((e.cause && e.cause.code) || e.message) + ')');
    process.exit(1);
  }
}
