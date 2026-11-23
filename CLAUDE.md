# 찬양하는교회 앱 · 작업 안내

부천 찬양하는교회 성도를 위한 설치형 웹앱(PWA)입니다. 화면은 GitHub Pages 가, 글과 주보 사진은 Supabase 서버가 내줍니다.
**성도들이 실제로 쓰고 있는 앱입니다.** `gh-pages` 브랜치에 올리면 1~2분 뒤 모든 휴대폰에 반영됩니다.

- 앱: https://nstepanet.github.io/chanyang/
- 서버 설정 복사 페이지: https://nstepanet.github.io/chanyang/supabase/
- 기능, 파일 구성, 운영 방법: `README.md`
- **지금 상태와 남은 일: `dev/STATUS.md`** (일을 시작할 때 읽고, 마치면 고칩니다)
- 검사와 도구 쓰는 법: `dev/README.md`

## 일하는 방식

1. **시작하기 전에 확인받습니다.** 지시를 받으면 이해한 내용과 하려는 일을 먼저 말하고, 저장소 주인의 확인을 받은 뒤 시작합니다. 단순한 질문에는 바로 답합니다. 화면이 바뀌는 일은 미리보기 그림을 함께 보여 주면 확인이 쉽습니다.
2. **한국어로 씁니다.** 답, 화면 글, 주석, 커밋 메시지 모두 한국어입니다. 화면 글과 안내문은 어르신 성도도 읽으므로 쉬운 말로 씁니다("단추", "화면", "다시 열면").
3. **확인한 것과 못 한 것을 나눠 말합니다.** 실제 휴대폰에서의 모습, 실제 서버에서의 동작처럼 여기서 볼 수 없는 것은 못 봤다고 말합니다.
4. **말씀하신 범위만 고칩니다.** 범위 밖에서 고칠 곳을 찾으면 고치지 말고 알립니다.

## 하지 않는 것

- **비밀 값을 저장소나 대화에 넣지 않습니다.** `sb_secret_` 로 시작하는 Secret key 와 Database Password 는 어디에도 쓰지 않습니다. 쓰는 값은 `config.js` 의 Project URL 과 Publishable key 둘뿐이고, 둘 다 공개되어도 되는 값입니다.
- **실제 서버를 직접 바꾸지 않습니다.** 서버 설정(SQL)은 저장소 주인이 Supabase SQL Editor 에서 직접 실행합니다. 할 일은 `supabase/*.sql` 을 쓰고, 검사로 확인하고, 복사 페이지(`supabase/index.html`)에 그 단계의 칸을 만드는 데까지입니다.
- **실제 서버에 계정·글·사진을 만들지 않습니다.** 계정 만들기, 비밀번호와 인증번호 입력은 사람만 합니다. 시험용 익명 계정도 만들지 않습니다. 실제 서버는 읽기만 합니다(`npm run server-status`).
- **성도의 전화번호를 서버에 저장하지 않습니다.** 서버에는 이름과 승인 기록만 둡니다.
- **저장소는 공개입니다.** 성도 이름, 연락처, 관리자 이메일 같은 개인 정보를 파일에 넣지 않습니다.
- 유튜브 영상의 공개 설정은 바꾸지 않습니다.
- 다른 곳에서 파일을 받아 오게 만들지 않습니다. 글꼴과 라이브러리는 모두 저장소에 들어 있습니다. (예외: 유튜브 영상, Supabase 서버)

## 명령

`dev` 폴더에서 돌립니다. Node 22 이상이 필요하고, 처음 한 번 `npm install` 을 합니다.

| 명령 | 하는 일 |
|---|---|
| `npm test` | 자동 검사 전부 (40초쯤). `npm test -- theme` 처럼 이름으로 고를 수 있음 |
| `npm run themes` | `dev/themes` 의 디자인 원본으로 `app.css` 의 디자인 부분을 다시 만듦 |
| `npm run preview` | 미리보기 서버. 가짜 서버를 끼워서 실제 서버에 아무것도 보내지 않음 |
| `npm run audit` | 모든 화면을 세 디자인 × 세 폭으로 띄워 넘침·잘림을 찾음 (Chrome 이나 Edge 필요). `npm run audit -- --shots` 로 화면도 찍음 |
| `npm run sw-check` | 휴대폰 보관(서비스 워커), 설치 정보, 글꼴, 인터넷이 끊긴 상태 점검 |
| `npm run server-status` | 실제 서버에 몇 단계 설정까지 되어 있는지 읽기 |

## 고친 뒤에 할 일

- 무엇을 고치든 `npm test` 가 모두 통과해야 합니다. 기능을 더하면 검사도 더합니다.
- 화면(꾸밈, 화면 글)을 고쳤으면 `npm run audit` 에서 문제가 0건이어야 하고, 찍은 화면을 직접 봅니다. 기준 폭은 갤럭시의 360px 이고 320px, 390px 도 봅니다.
- `sw.js`, `manifest.webmanifest`, 아이콘, 글꼴을 고쳤으면 `npm run sw-check` 도 돌립니다.
- 서버 설정(SQL)을 고쳤으면 `dev/tests/sql-*.test.mjs` 에 경우를 더합니다. 이 검사는 실제 Postgres(PGlite)에서 SQL 을 돌립니다.
- `dev/STATUS.md` 를 지금 상태에 맞게 고칩니다.

## 올리기

- 앱은 `gh-pages` 브랜치의 파일로 서비스되고, `main` 은 같은 내용의 사본입니다. 항상 둘을 같게 둡니다.

  ```
  git push origin main
  git push origin main:gh-pages
  ```

- 올리면 곧바로 성도들의 휴대폰에 반영됩니다. 올리는 것까지 확인받았는지 분명하지 않으면 올리기 전에 묻습니다.
- 올린 뒤 GitHub 의 Pages 빌드가 끝났는지 확인합니다(저장소의 Actions 화면, 또는 `gh api repos/nstepanet/chanyang/actions/runs --jq ".workflow_runs[0].status"`).
- **앱 파일을 고쳤으면 `sw.js` 맨 위의 `VERSION` 을 올립니다.** 그래야 이미 설치한 휴대폰이 새 파일을 받습니다. `data/` 안의 파일만 고쳤거나 `dev/`, `README.md`, `CLAUDE.md` 만 고쳤으면 올리지 않습니다.
- 글꼴 파일을 바꾸면 `sw.js` 의 `FONTS` 끝 숫자를 올립니다.
- 아이콘 그림을 바꾸면 파일 이름의 `-v2` 도 바꾸고 `manifest.webmanifest`, `index.html`, `sw.js`, `app.css` 네 곳에 똑같이 적습니다. 이유는 `README.md` 의 "아이콘을 바꿀 때"에 있습니다.

## 구조

빌드 과정이 없습니다. 저장소의 파일이 그대로 서비스됩니다.

| 파일 | 역할 |
|---|---|
| `index.html` | 뼈대. 머리 부분의 짧은 스크립트가 지난번 화면 디자인을 첫 화면 전에 입힘 |
| `app.js` | 화면과 동작 전부. 상태(`state`), 화면(`screens.이름`), 누름 처리(`actions.이름`), 그리기(`render`). 자주 고치는 값은 맨 위 `SETTINGS` |
| `server.js` | 서버와 통신하는 코드 전부(`window.Server`). `app.js` 는 서버를 직접 부르지 않음 |
| `app.css` | 앞부분은 기본 모양(= 클래식 화면). "화면 디자인" 표시 아래는 `dev/themes` 원본으로 만든 것이라 직접 고치지 않음 |
| `sw.js` | 휴대폰 보관 규칙. 화면 파일은 새것 먼저, 그림은 받아 둔 것 먼저, 글꼴은 따로 보관 |
| `config.js` | 서버 주소와 공개용 키 |
| `supabase/*.sql` | 서버 설정 1단계(글·사진), 2단계(성도 승인), 3단계(화면 디자인). 여러 번 실행해도 안전하게 씀 |
| `supabase/index.html` | 서버 설정을 단추로 복사하는 페이지 (브라우저 자동 번역이 SQL 을 바꾸는 문제를 피하려는 것) |
| `data/` | 예배 영상 목록(`videos.txt`), 서버에 연결되지 않을 때의 기본 글(`content.json`) |
| `fonts/`, `vendor/` | 글꼴(Pretendard, 고운바탕), Supabase 라이브러리 |
| `dev/` | 자동 검사, 디자인 원본, 점검 도구. 앱에는 들어가지 않음 |

## 코드 규칙

- **`app.js`, `server.js`, `index.html` 안의 스크립트는 옛 문법으로 씁니다.** `var` 와 `function` 을 쓰고, 화살표 함수, `let`/`const`, 백틱 문자열, `async`/`await`, `class` 를 쓰지 않습니다. 오래된 휴대폰에서도 돌아가야 하기 때문입니다. `sw.js` 와 `dev/` 안의 파일은 새 문법을 써도 됩니다.
- **꾸밈(CSS)에는 `:has()` 와 겹쳐 쓰기(`&`)를 쓰지 않습니다.**
- **클래식 화면은 지금 모습 그대로 둡니다.** `app.css` 앞부분(기본 모양)을 고치면 클래식 화면이 바뀝니다. 밝은 화면과 따뜻한 화면만 바꾸려면 `dev/themes/bright.css`, `warm.css` 를 고치고 `npm run themes` 를 돌립니다.
- 디자인 값 `bright`, `warm`, `classic` 은 `app.css`, `app.js`, `index.html`, `server.js`, `supabase/theme.sql` 다섯 곳에 똑같이 적혀 있습니다.
- 화면에 넣는 글은 `esc()` 를 거칩니다. 서버에서 온 글과 사람이 적은 글은 모두 그렇게 합니다.
- 누르는 곳은 높이 44px 이상, 글자색과 바탕색의 대비는 4.5:1 이상으로 둡니다.
- 주석은 한국어로, 무엇을 하는지보다 왜 그렇게 하는지를 적습니다.
- 휴대폰에 저장하는 값은 `localStorage` 의 `chanyang.` 으로 시작하는 이름을 씁니다(`store.get`, `store.set`).

## 자주 하는 일

- **화면 글이나 예배 시간 고치기**: `app.js`(`SETTINGS` 또는 그 화면) → `npm test` → `VERSION` 올리기.
- **밝은 화면·따뜻한 화면의 색이나 모양 고치기**: `dev/themes/*.css` → `npm run themes` → `npm test` → `npm run audit -- --shots` → `VERSION` 올리기.
- **서버가 필요한 기능 더하기**: 새 단계의 SQL 파일(`supabase/`) → `sql-*` 검사 → `server.js` 에 부르는 함수 → `app.js` 화면 → `dev/tests/harness.js` 의 가짜 서버와 `app-*` 검사 → 복사 페이지에 그 단계의 칸 → 저장소 주인이 SQL 실행. 서버 설정 전에도 앱이 멈추지 않게 만듭니다(서버에 그 기능이 없으면 `not_ready`).
- **새 화면 만들기**: `app.js` 에 화면과 제목(`TITLES`) → `dev/preview/preview-stub.js` 에 가짜 응답 → `dev/preview/audit.mjs` 의 `SCREENS` 에 한 줄.
- **예배 영상 더하기**: `data/videos.txt` (형식은 `README.md`). `VERSION` 은 올리지 않습니다.
