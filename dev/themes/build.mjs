// app.css 뒤쪽의 "화면 디자인" 부분을 디자인 원본으로 다시 만듭니다.
//
//   node themes/build.mjs           app.css 를 고쳐 씀 (여러 번 돌려도 같은 결과)
//   node themes/build.mjs --check   고치지 않고, app.css 가 원본으로 만든 것과 같은지만 확인
//
// 원본 (이 폴더):
//   shared.css   세 디자인이 함께 쓰는 규칙. 그대로 들어갑니다.
//   bright.css   밝은 화면.   규칙마다 앞에 html[data-theme="bright"] 가 붙습니다.
//   warm.css     따뜻한 화면. 규칙마다 앞에 html[data-theme="warm"] 이 붙습니다.
// 클래식 화면은 app.css 앞쪽의 기본 모양 그대로라서 원본 파일이 없습니다.
//
// 원본을 쓰는 방법: 접두어 없이 평범한 규칙으로 적습니다. `:root` 는 그 디자인의 <html>, `body` 는 그 디자인의 <body> 가 됩니다.
// 좁은 화면용 규칙은 `@media (max-width: …px) { … }` 로 묶습니다. 주석은 줄을 따로 써서 그대로 옮겨집니다.
// 쓰지 않는 것: 겹쳐 쓰기(&), :has(), 쉼표가 든 선택자 함수(:is(a, b) 등). 오래된 휴대폰이 모르거나 이 도구가 다루지 못합니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, '..', '..', 'app.css');
const THEMES = [['bright', '밝은 화면 · 처음 값'], ['warm', '따뜻한 화면']];
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

// 원본의 규칙마다 앞에 html[data-theme="…"] 를 붙입니다.
export function prefix(css, theme) {
  const pre = `html[data-theme="${theme}"]`;
  const find = (text, what, from, where) => {
    const at = text.indexOf(what, from);
    if (at < 0) { throw new Error(`${theme}.css: "${what}" 가 빠졌습니다 → ${where}`); }
    return at;
  };
  function rules(text, indent) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      if (/\s/.test(text[i])) { i++; continue; }
      if (text.startsWith('/*', i)) {
        const j = find(text, '*/', i, text.slice(i, i + 40)) + 2;
        out.push('\n' + indent + text.slice(i, j));
        i = j; continue;
      }
      const j = find(text, '{', i, text.slice(i, i + 40));
      const head = text.slice(i, j).trim();
      if (head.startsWith('@media')) {
        let depth = 1, k = j + 1;
        while (depth) {
          if (k >= text.length) { throw new Error(`${theme}.css: 닫는 괄호 } 가 모자랍니다 → ${head}`); }
          if (text[k] === '{') { depth++; } else if (text[k] === '}') { depth--; }
          k++;
        }
        const inner = rules(text.slice(j + 1, k - 1), indent + '  ').map((x) => (x.startsWith('\n') ? x.replace(/^\n+/, '') : x));
        out.push(indent + head + ' {\n' + inner.join('\n') + '\n' + indent + '}');
        i = k; continue;
      }
      const k = find(text, '}', j, head);
      const body = text.slice(j + 1, k).trim();
      if (head.includes('/*') || body.includes('{')) { throw new Error(`${theme}.css: 이 도구가 다루지 못하는 모양입니다 (주석은 줄을 따로, 겹쳐 쓰기는 쓰지 않습니다) → ${head}`); }
      if (/\([^)]*,/.test(head)) { throw new Error(`${theme}.css: 쉼표가 든 선택자 함수는 쓰지 않습니다 → ${head}`); }
      const sels = head.split(',').map((s) => s.trim()).filter(Boolean)
        .map((sel) => (sel === ':root' ? pre : sel === 'body' ? pre + ' body' : pre + ' ' + sel));
      out.push(indent + sels.join(', ') + ' { ' + body + ' }');
      i = k + 1;
    }
    return out;
  }
  return rules(css, '').join('\n').trim() + '\n';
}

// 지금의 app.css 내용을 받아, 디자인 부분을 원본으로 다시 만든 전체 내용을 돌려줍니다.
export function build(app) {
  const shared = read(path.join(here, 'shared.css'));
  if (!shared.startsWith('/* ====')) { throw new Error('shared.css 는 "화면 디자인" 머리말 주석으로 시작해야 합니다.'); }
  const mark = shared.split('\n').slice(0, 2).join('\n');   // 머리말의 처음 두 줄: 여기부터가 디자인 부분
  const at = app.indexOf(mark);
  const base = (at >= 0 ? app.slice(0, at) : app).trimEnd() + '\n';
  let out = base + '\n' + shared;
  for (const [theme, label] of THEMES) {
    out += `\n/* ---------- ${label}  (data-theme="${theme}") ---------- */\n` + prefix(read(path.join(here, theme + '.css')), theme);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const now = read(APP);
  const made = build(now);
  const lines = (s) => s.split('\n').length - 1;
  if (process.argv.includes('--check')) {
    if (made === now) { console.log(`app.css 의 디자인 부분이 원본과 같습니다. (${lines(now)}줄)`); process.exit(0); }
    console.log('app.css 의 디자인 부분이 원본으로 만든 것과 다릅니다. dev/themes 의 원본을 고친 뒤 `npm run themes` 로 다시 만들어 주세요.');
    process.exit(1);
  }
  if (made === now) { console.log(`바뀐 것이 없습니다. (app.css ${lines(now)}줄)`); } else { fs.writeFileSync(APP, made); console.log(`app.css 를 다시 만들었습니다. (${lines(now)}줄 → ${lines(made)}줄)`); }
}
