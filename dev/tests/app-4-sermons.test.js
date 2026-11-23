// 설교 요약 자료(data/sermons.json)와 설교 화면의 요약 카드·"설교 부분부터 보기" 점검
const fs = require('node:fs');
const path = require('node:path');
const { makeBackend, boot, ok, result } = require('./harness');

(async () => {
  console.log('\n[1] 설교 정리 자료 파일');
  const root = path.resolve(__dirname, '..', '..');
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'sermons.json'), 'utf8'));
  const videos = fs.readFileSync(path.join(root, 'data', 'videos.txt'), 'utf8');
  const topicIds = new Set(data.topics.map((t) => t.id));
  ok('주제마다 id·이름·찾는 낱말이 있음', data.topics.every((t) => t.id && t.name && Array.isArray(t.words) && t.words.length));
  ok('주제 id 가 겹치지 않음', topicIds.size === data.topics.length);
  ok('설교가 1편 이상', data.sermons.length >= 1, data.sermons.length);
  const sec = (t) => String(t).split(':').reduce((n, x) => n * 60 + Number(x), 0);
  for (const s of data.sermons) {
    const problems = [];
    if (!videos.includes(s.id)) problems.push('영상 목록에 없는 ID');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) problems.push('날짜 형식');
    if (!(sec(s.start) > 0 && sec(s.end) > sec(s.start))) problems.push('시작·끝 시간');
    if (!s.title || !Array.isArray(s.summary) || s.summary.length < 1 || !Array.isArray(s.outline) || !s.outline.every((o) => o.h && o.t)) problems.push('제목·요약·흐름');
    const badTopics = (s.topics || []).filter((t) => !topicIds.has(t));
    if (badTopics.length) problems.push('없는 주제 ' + badTopics.join(','));
    if (!Array.isArray(s.keywords) || s.keywords.length < 5) problems.push('찾는 말이 너무 적음');
    ok(s.date + ' ' + s.id + ' 자료가 갖춰짐', problems.length === 0, problems.join(' / '));
  }

  console.log('\n[2] 설교 화면 · 요약이 있는 영상');
  const be = makeBackend();
  const a = boot(be); await a.w.__chanyang.ready;
  const S = a.S;
  ok('정리 자료를 받아 둠', !!S.sermonData && Object.keys(S.sermonData.byId).length === data.sermons.length);
  const withSummary = data.sermons[0];
  a.click('#tabs [data-screen=sermons]');
  ok('목록에 "설교 요약 있음" 표시', /설교 요약 있음/.test(a.text()));
  a.click(`#view [data-act=sermon][data-id="${withSummary.id}"]`);
  ok('설교 화면이 열림', S.screen === 'sermon' && S.sermonId === withSummary.id && S.playFrom === 0 && S.outlineOpen === false);
  ok('처음에는 영상이 처음부터', !/start=/.test(a.$('.player iframe').src));
  const btn = a.$('[data-act=playFrom]');
  ok('"설교 부분부터 보기" 단추와 시각', !!btn && /설교 부분부터 보기/.test(btn.textContent) && /\d+분/.test(btn.textContent), btn && btn.textContent);
  ok('요약 카드: 제목·세 줄 요약·본문', /설교 요약/.test(a.text()) && a.$$('.sm-list li').length === withSummary.summary.length && a.text().includes(withSummary.reading));
  ok('주제 꼬리표가 이름으로 보임', a.$$('.sm .tag').length === withSummary.topics.length && a.text().includes(data.topics.find((t) => t.id === withSummary.topics[0]).name));
  ok('자막을 바탕으로 정리했다는 안내', /자막을 바탕으로 정리한 내용/.test(a.text()));
  ok('전체 흐름은 접혀 있음', !a.$('.sm-outline') && /설교 전체 흐름 보기/.test(a.text()));
  a.click('[data-act=toggleOutline]');
  ok('전체 흐름을 펼침', S.outlineOpen && a.$$('.sm-outline .sm-h').length === withSummary.outline.length && /설교 전체 흐름 접기/.test(a.text()));
  a.click('[data-act=toggleOutline]');
  ok('다시 접힘', !S.outlineOpen && !a.$('.sm-outline'));
  a.click('[data-act=playFrom]');
  const start = sec(withSummary.start);
  ok('누르면 그 시각부터 재생되게 영상을 다시 끼움', S.playFrom === start && new RegExp('start=' + start + '&autoplay=1').test(a.$('.player iframe').src), a.$('.player iframe').src);
  ok('유튜브 링크에도 시각이 붙음', new RegExp('t=' + start + 's').test(a.$('a.btn.line').href));
  ok('재생 안내가 보임', /설교 부분부터 재생합니다/.test(a.text()) && a.$('[data-act=playFrom]').getAttribute('aria-pressed') === 'true');
  ok('설교 노트는 그대로', !!a.$('#note'));
  a.type('#note', '요약 아래 노트'); a.click('[data-act=saveNote]');
  ok('노트 저장 뒤에도 재생 위치 유지', S.notes[withSummary.id] === '요약 아래 노트' && /start=/.test(a.$('.player iframe').src));

  console.log('\n[3] 요약이 없는 영상');
  const noSummary = S.videos.find((v) => !S.sermonData.byId[v.id]);
  a.click('#tabs [data-screen=sermons]');
  a.w.__chanyang.go('sermon', { sermonId: noSummary.id, playFrom: 0, outlineOpen: false });
  ok('요약 카드와 단추가 없음', !a.$('.sm') && !a.$('[data-act=playFrom]') && !!a.$('.player iframe') && !!a.$('#note'));
  ok('영상이 처음부터', !/start=/.test(a.$('.player iframe').src));
  a.click('#tabs [data-screen=home]'); a.click('.hero');
  ok('홈에서 최근 설교를 열면 처음부터, 흐름은 접힘', S.screen === 'sermon' && S.playFrom === 0 && !S.outlineOpen);

  console.log('\n[4] 자료 파일을 못 받을 때');
  const be2 = makeBackend();
  const realFetch = be2.fetch;
  be2.fetch = async (input, init) => { const u = typeof input === 'string' ? input : input.url; if (u.includes('sermons.json')) return new Response('', { status: 404 }); return realFetch(input, init); };
  const b = boot(be2); await b.w.__chanyang.ready;
  ok('요약 없이 그대로 돌아감', b.S.sermonData === null && b.S.videos.length > 0);
  b.click('#tabs [data-screen=sermons]'); b.click('#view [data-act=sermon]');
  ok('설교 화면은 영상과 노트만', !!b.$('.player iframe') && !b.$('.sm') && !/설교 요약 있음/.test(b.text()));
  const be3 = makeBackend();
  const realFetch3 = be3.fetch;
  be3.fetch = async (input, init) => { const u = typeof input === 'string' ? input : input.url; if (u.includes('sermons.json')) return new Response('{ 깨진', { status: 200 }); return realFetch3(input, init); };
  const c = boot(be3); await c.w.__chanyang.ready;
  ok('파일이 깨져 있어도 멈추지 않음', c.S.sermonData === null && c.S.loaded);

  for (const x of [a, b, c]) ok('오류 없음', x.w.__errors.length === 0, x.w.__errors.join(' | '));
  process.exit(result() ? 1 : 0);
})().catch((e) => { console.error('점검 중단:', e); process.exit(2); });
