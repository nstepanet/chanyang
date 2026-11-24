// 말씀 찾기의 맞추기(matchSermons) 점검: 성도가 적을 법한 문장 40개가 맞는 설교를 찾는지, 상황 문장이 없어도 돌아가는지
const fs = require('node:fs');
const path = require('node:path');
const { makeBackend, boot, ok, result } = require('./harness');

// 각 줄: [성도가 적은 글, 세 개 안에 하나는 나와야 하는 설교 ID 들]. 날짜는 data/sermons.json 참고.
const CASES = [
  ['아들이 직장을 못 구해서 마음이 무거워요', ['8NtSHTWvUpo', 'EaeHsjNlBUc', 'ZPPXd2ESgbE', '6WMQ_VNc5GY', 'XhARBcA4Xvc', 'im2gkYgaKyw']],
  ['수술 날짜를 받아 놓고 두렵습니다', ['xh0xmAvKy8Q', 'im2gkYgaKyw', 'DLZej_tP2lQ', 'vrDdGcA9TI4', 'flUtNxlEFVA', 'noUNXF2j-uY', 'k4RIKozFEAU']],
  ['기도해도 응답이 없어서 지쳤어요', ['L6bwzktjAtk', 'T1Y7VXCqCdU', '7xjR8BJXecA', 'bqNe9cSqK0o', 'C8Vu3MEH71o', 'vl2CpaJkl5E', 'ZEOVWqoYKls']],
  ['자식이 나쁜 친구들과 어울려서 걱정입니다', ['zhf5--7I1xg', '4GdvlYIKoFU', '0lHdH_skYjA']],
  ['설 명절에 가족이 모이면 자꾸 다투게 돼요', ['D5-T0vdK5z8', 'X1SEUJPqviM', '6ql5YwCSPRM']],
  ['추석에 온 가족이 모여 감사하며 보내고 싶어요', ['6ql5YwCSPRM', 'X1SEUJPqviM', 'D5-T0vdK5z8']],
  ['내가 정말 구원받았는지 확신이 없어요', ['FNgvl951RK8', 'fCunpUexmgM', 'Hygs83AQR-Y', 'yuwKswBK0o8', '3FxizHq5onE', 'Tmm2QVAF14Q', 'EiR3Lb2hbyQ', '0Fmj7XmkZac', 'h8J56h1qkqg', 'FESqTNaNmR0']],
  ['전도하고 싶은데 용기가 안 나요', ['eOcGQ7elems', 'pTbmV-EtuhA', 'iUjaHtFVYJ0', '48nKUsI54M0']],
  ['사업이 망해서 다 잃었습니다', ['ZPPXd2ESgbE', '6WMQ_VNc5GY', 'Tp3KN41uqTw', 'XhARBcA4Xvc', '8NtSHTWvUpo']],
  ['가게 손님이 줄어서 빚만 늘어요', ['ZPPXd2ESgbE', '6WMQ_VNc5GY', 'Tp3KN41uqTw', 'XhARBcA4Xvc', 'EaeHsjNlBUc', '8NtSHTWvUpo', 'im2gkYgaKyw']],
  ['마음에 한이 많고 쓴뿌리가 남아 있어요', ['paMbnD44rIo']],
  ['귀신이나 사탄이 무서워요', ['onrPS47hIAo', 'vrDdGcA9TI4', 'Tmm2QVAF14Q']],
  ['한 해를 돌아보니 감사한 일이 참 많습니다', ['VYz7uZnya8s', 'dTgFObDLEVs', '7lrQqFJSm68', 'dy6TqBaCQgk']],
  ['성령을 체험하고 싶어요', ['7vHgx9GpalU', 'eL3eO3xwxw0', 'FESqTNaNmR0']],
  ['죽음이 가까워진 것 같아 무섭습니다', ['JQitFya7naE', 'k4RIKozFEAU', 'noUNXF2j-uY', 'EiR3Lb2hbyQ']],
  ['사랑하는 사람을 먼저 보내고 부활의 소망을 붙들고 싶어요', ['k4RIKozFEAU']],
  ['교회에서 직분을 맡게 되어 부담이 됩니다', ['USDeVgFiiyA', 'lToXFBHr43E', 'tk1FjU5SVYg']],
  ['대표 기도를 어떻게 해야 할지 모르겠어요', ['lToXFBHr43E']],
  ['자녀에게 믿음을 어떻게 전해야 할까요', ['Hh6hX1eMoz8', 'AhAMV_XFbek', 'nhSWiUFQyBY', '0v6B9nRWu4g']],
  ['밤에 잠이 안 오고 불안해요', ['EaeHsjNlBUc', '8NtSHTWvUpo', 'ZEOVWqoYKls', 'nhSWiUFQyBY', 'Zb6NG_wI8Vk', '6WMQ_VNc5GY', 'onrPS47hIAo', 'ZPPXd2ESgbE', 'im2gkYgaKyw', 'vrDdGcA9TI4', 'TvlEpeXyN6A']],
  ['고집이 세서 사람들과 자꾸 부딪혀요', ['tk1FjU5SVYg', 'cXmA_xTrAFg', 'zhf5--7I1xg', 'D5-T0vdK5z8', 'Dg2oPdU_nyY', 'WGFYEWixD2Y']],
  ['혼자 사는 게 외롭고 쓸쓸합니다', ['8NtSHTWvUpo', 'paMbnD44rIo', 'TvlEpeXyN6A', 'AhAMV_XFbek', 'frmkZ6DsAvw', 'eOb7G_M9Iv8', 'X1SEUJPqviM']],
  ['제사 문제로 집안이 시끄러워요', ['CFyVFvYoYpY', 'pcLLEeChYqk', 'D5-T0vdK5z8', '6ql5YwCSPRM']],
  ['불교 믿는 부모님께 예수님을 전하고 싶어요', ['CFyVFvYoYpY', 'pcLLEeChYqk']],
  ['믿음이 작아서 늘 흔들립니다', ['DLZej_tP2lQ', 'flUtNxlEFVA', 'cXmA_xTrAFg', 'vl2CpaJkl5E']],
  ['하나님께 벌받을까 두렵습니다', ['D4Eafe1rkls', 'mrkajMIOjok', 'iRXddW9aIJQ', 'YwKKRWvjoR4']],
  ['안수기도를 받으려는데 어떤 마음이어야 하나요', ['xh0xmAvKy8Q', '65sXk6LUSL4']],
  ['야베스처럼 복을 받고 싶어요', ['XhARBcA4Xvc', 'd5KGCuWZhIg']],
  ['예수님의 고난과 십자가를 묵상하고 싶어요', ['atd3pTJuXj8']],
  ['지옥이 정말 있나요', ['Tmm2QVAF14Q', 'C8Vu3MEH71o', 'JQitFya7naE']],
  ['성탄을 어떤 마음으로 맞아야 하나요', ['eOb7G_M9Iv8']],
  ['하나님이 멀게 느껴지고 관계가 끊어진 것 같아요', ['frmkZ6DsAvw', 'FNgvl951RK8', 'Hygs83AQR-Y', '3FxizHq5onE', 'yuwKswBK0o8', 'FESqTNaNmR0', 'flUtNxlEFVA', 'eL3eO3xwxw0']],
  ['취업', ['8NtSHTWvUpo', 'EaeHsjNlBUc', 'ZPPXd2ESgbE', '6WMQ_VNc5GY', 'XhARBcA4Xvc', 'im2gkYgaKyw', 'Tp3KN41uqTw']],
  ['암 수술', ['xh0xmAvKy8Q', 'im2gkYgaKyw', 'DLZej_tP2lQ', 'vrDdGcA9TI4', 'flUtNxlEFVA', 'noUNXF2j-uY', 'cXmA_xTrAFg', 'k4RIKozFEAU', 'vl2CpaJkl5E', '65sXk6LUSL4']],
  ['어머니 건강 회복을 위해 기도합니다', ['xh0xmAvKy8Q', 'im2gkYgaKyw', 'DLZej_tP2lQ', 'vrDdGcA9TI4', 'flUtNxlEFVA', 'noUNXF2j-uY', 'k4RIKozFEAU', 'vl2CpaJkl5E', 'cXmA_xTrAFg', '65sXk6LUSL4']],
  ['직장 상사와 갈등이 심해요', ['zhf5--7I1xg', 'WGFYEWixD2Y', 'Dg2oPdU_nyY', 'D5-T0vdK5z8', 'bqNe9cSqK0o', 'L6bwzktjAtk', '3FxizHq5onE']],
  ['술과 담배를 끊고 싶어요', ['4GdvlYIKoFU', 'onrPS47hIAo', 'C8Vu3MEH71o']],
  ['감사할 일이 없는 것 같은데 어떻게 감사하죠', ['dTgFObDLEVs', 'VYz7uZnya8s', '7lrQqFJSm68', 'ZPPXd2ESgbE']],
  ['새벽 기도를 시작하고 싶습니다', ['ZEOVWqoYKls', '4GdvlYIKoFU', '0v6B9nRWu4g', 'lToXFBHr43E', 'im2gkYgaKyw']],
  ['이단 사람이 찾아와서 성경 공부를 하자고 해요', ['EiR3Lb2hbyQ', 'fCunpUexmgM', '0Fmj7XmkZac', 'h8J56h1qkqg', 'CFyVFvYoYpY']]
];

// 옛 방식(찾는 말·주제 낱말만)으로도 몇 개를 맞히는지 함께 세어 비교합니다. 검사 결과에는 넣지 않고 보여만 줍니다.
function oldMatch(data, text) {
  const has = (k) => text.indexOf(k) >= 0 || text.replace(/\s+/g, '').indexOf(k.replace(/\s+/g, '')) >= 0;
  const found = {};
  for (const t of data.topics) { const w = (t.words || []).find(has); if (w) found[t.id] = w; }
  return data.sermons.map((s, i) => {
    let score = 0;
    for (const k of s.keywords || []) if (has(k)) score += 3;
    for (const t of s.topics || []) if (found[t]) score += 2;
    return { id: s.id, score, i };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 3).map((x) => x.id);
}

(async () => {
  console.log('\n[1] 상황 문장 자료');
  const root = path.resolve(__dirname, '..', '..');
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'sermons.json'), 'utf8'));
  const byId = new Map(data.sermons.map((s) => [s.id, s]));
  ok('설교마다 상황 문장이 25개 이상', data.sermons.every((s) => Array.isArray(s.situations) && s.situations.length >= 25), data.sermons.filter((s) => !s.situations || s.situations.length < 25).map((s) => s.date).join(','));
  ok('상황 문장은 4~40자', data.sermons.every((s) => s.situations.every((t) => t.length >= 4 && t.length <= 40)));
  ok('상황 문장에 성도 이름이 없음(집사·권사·장로 호칭으로 어림)', !data.sermons.some((s) => s.situations.some((t) => /[가-힣]{2,3}(집사|권사|장로|전도사)/.test(t))));
  ok('시험 문장이 기대하는 설교 ID 가 모두 자료에 있음', CASES.every((c) => c[1].every((id) => byId.has(id))));

  console.log('\n[2] 글 다듬기(stem)');
  const be = makeBackend();
  const a = boot(be); await a.w.__chanyang.ready;
  const C = a.w.__chanyang;
  ok('조사와 말끝을 뗌', C.stem('아들이 걱정이에요') === '아들걱정', C.stem('아들이 걱정이에요'));
  ok('두 번까지 뗌, 두 글자는 남김', C.stem('수술을 앞두고 두렵습니다') === '수술앞두두렵', C.stem('수술을 앞두고 두렵습니다'));
  ok('기호를 빼고 붙여 씀', C.stem('취업!! 걱정...') === '취업걱정', C.stem('취업!! 걱정...'));

  console.log('\n[3] 시험 문장 ' + CASES.length + '개');
  let hit = 0, oldHit = 0;
  for (const [text, want] of CASES) {
    const got = C.match(text, '').map((m) => m.sermon.id);
    const good = got.some((id) => want.includes(id));
    if (good) hit++;
    if (oldMatch(data, text).some((id) => want.includes(id))) oldHit++;
    ok('"' + text + '"', good, got.map((id) => (byId.get(id) || {}).date).join(', '));
  }
  console.log('   맞힌 수: 새 방식 ' + hit + '/' + CASES.length + ', 옛 방식(찾는 말만) ' + oldHit + '/' + CASES.length);
  ok('시험 문장의 9할 이상을 맞힘', hit >= Math.ceil(CASES.length * 0.9), hit + '/' + CASES.length);

  console.log('\n[4] 추천 이유와 화면');
  const m = C.match('아들이 직장을 못 구해서 마음이 무거워요', '');
  ok('비슷한 상황 문장을 찍어 둠', m.length && m[0].sit && m[0].sim >= 0.3, m[0] && m[0].sit);
  a.click('#tabs [data-screen=sermons]');
  a.type('#need', '아들이 직장을 못 구해서 마음이 무거워요'); a.click('[data-act=findSermons]');
  ok('추천 이유에 상황 문장이 보임', /하는 분께 맞는 말씀/.test(a.text()));
  a.type('#need', '오늘 날씨가 좋네요'); a.click('[data-act=findSermons]');
  ok('엉뚱한 글에는 추천이 없음', /맞는 설교를 찾지 못했습니다/.test(a.text()) || !a.$('.why'));
  a.click('[data-act=clearFind]');
  a.click('[data-act=mood][data-v=illness]');
  ok('마음 단추만 눌러도 추천이 나옴', a.$$('#view .why').length >= 1);

  console.log('\n[5] 상황 문장이 없는 자료로도 돌아감');
  const S = a.S;
  S.sermonData.list.forEach((s) => { delete s.situations; delete s._sit; delete s._all; }); S.sermonData.sitIdx = null;
  const m2 = C.match('요즘 아들 취업 때문에 걱정이 많아요', '');
  ok('찾는 말만으로 추천', m2.length >= 1 && !m2[0].sit, m2.length);
  const m3 = C.match('', 'worry');
  ok('빈 글과 마음 단추만으로도 추천', m3.length >= 1);

  process.exit(result());
})();
