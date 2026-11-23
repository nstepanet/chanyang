// 2단계(성도 승인) 서버 설정 점검: 실제 Postgres(PGlite) 위에서 setup.sql + members.sql 을 돌려 봅니다.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const SETUP = fs.readFileSync(new URL('../../supabase/setup.sql', import.meta.url), 'utf8');
const MEMBERS = fs.readFileSync(new URL('../../supabase/members.sql', import.meta.url), 'utf8');
const A = '11111111-1111-1111-1111-111111111111';   // 관리자(이메일 계정)
const E = '22222222-2222-2222-2222-222222222222';   // 관리자가 아닌 이메일 계정
const G = (n) => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, '0')}`;   // 휴대폰 임시 계정

const baseEnv = (autoExpose) => `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, email_confirmed_at timestamptz,
  is_anonymous boolean not null default false, created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
${autoExpose ? `
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;` : `
alter default privileges revoke execute on functions from public;`}
`;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? '  ok  ' : ' FAIL ') + name + (extra && (!cond || process.env.V) ? '  → ' + extra : '')); };

async function as(db, role, uid, sql) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${role};`);
  try { const r = await db.query(sql); return { rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { error: e.message }; }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const guest = (db, n) => db.exec(`insert into auth.users (id, is_anonymous) values ('${G(n)}', true) on conflict do nothing;`);
const call = async (db, role, uid, fn) => { const r = await as(db, role, uid, `select ${fn} as v`); return r.error ? { error: r.error } : r.rows[0].v; };
const posts = async (db, role, uid) => { const r = await as(db, role, uid, `select count(*)::int as n from public.posts`); return r.error ? r.error : r.rows[0].n; };
const last = (res) => res[res.length - 1].rows[0];

async function scenario(autoExpose) {
  console.log(`\n=== ${autoExpose ? '예전 방식(자동 권한 부여)' : '새 방식(권한을 직접 줘야 함)'} 프로젝트 ===`);
  const db = new PGlite();
  await db.exec(baseEnv(autoExpose));
  await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${A}', 'admin@church.kr', now());`);

  let pre = null;
  try { await db.exec(MEMBERS); } catch (e) { pre = e.message; }
  ok('1단계 없이 실행하면 안내와 함께 멈춤', /1단계 설정/.test(pre || ''), pre);

  await db.exec(SETUP);
  await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${E}', 'member@x.com', now());`);
  await as(db, 'authenticated', A, `insert into storage.objects (bucket_id, name) values ('post-images', 'p1/1.jpg')`);
  ok('2단계 실행 전: 누구나 글을 읽을 수 있음', (await posts(db, 'anon', null)) === 3);

  let res = await db.exec(MEMBERS);
  ok('실행 결과: 성도 승인 켜짐, 사진 보관함 비공개', /^켜짐/.test(last(res)['성도 승인']) && last(res)['주보 사진 보관함'] === '비공개' && last(res)['관리자 계정'] === 'admin@church.kr', JSON.stringify(last(res)));
  res = await db.exec(MEMBERS);
  ok('한 번 더 실행해도 오류 없음', /^켜짐/.test(last(res)['성도 승인']));

  // ── 읽기 권한 ──
  ok('로그인 안 한 사람: 글이 보이지 않음', (await posts(db, 'anon', null)) === 0);
  await guest(db, 1);
  ok('승인 전 휴대폰: 글이 보이지 않음', (await posts(db, 'authenticated', G(1))) === 0);
  ok('관리자가 아닌 이메일 계정: 글이 보이지 않음', (await posts(db, 'authenticated', E)) === 0);
  ok('관리자: 글이 보임', (await posts(db, 'authenticated', A)) === 3);
  let r = await as(db, 'anon', null, `select count(*)::int n from storage.objects where bucket_id = 'post-images'`);
  ok('로그인 안 한 사람: 사진이 보이지 않음', r.rows && r.rows[0].n === 0, r.error);
  r = await as(db, 'authenticated', G(1), `select count(*)::int n from storage.objects where bucket_id = 'post-images'`);
  ok('승인 전 휴대폰: 사진이 보이지 않음', r.rows && r.rows[0].n === 0, r.error);
  let g = await call(db, 'anon', null, 'public.gate_status()');
  ok('상태 묻기(로그인 전): 승인제 켜짐, 승인 안 됨', g.members_only === true && g.member === false && g.admin === false && g.name === null, JSON.stringify(g));
  g = await call(db, 'authenticated', A, 'public.gate_status()');
  ok('상태 묻기(관리자): 관리자로 표시', g.admin === true && g.member === false, JSON.stringify(g));

  // ── 관리자 전용 기능 ──
  for (const [who, role, uid] of [['로그인 안 한 사람', 'anon', null], ['승인 전 휴대폰', 'authenticated', G(1)], ['일반 이메일 계정', 'authenticated', E]]) {
    r = await call(db, role, uid, `public.admin_issue_code('침입자')`);
    ok(`${who}: 승인번호 만들기 불가`, !!r.error, JSON.stringify(r));
    r = await as(db, role, uid, `select * from public.admin_members()`);
    ok(`${who}: 명단 보기 불가`, !!r.error, r.error);
    r = await call(db, role, uid, `public.admin_cleanup()`);
    ok(`${who}: 정리 기능 불가`, !!r.error, JSON.stringify(r));
    r = await as(db, role, uid, `select * from public.members`);
    ok(`${who}: 명단 표를 직접 읽기 불가`, !!r.error, r.error);
    r = await as(db, role, uid, `insert into public.members (name, user_id, approved_at) values ('스스로 승인', ${uid ? `'${uid}'` : 'null'}, now())`);
    ok(`${who}: 명단에 스스로 넣기 불가`, !!r.error, r.error);
    r = await as(db, role, uid, `update public.app_settings set members_only = false`);
    ok(`${who}: 승인제 끄기 불가`, !!r.error, r.error);
    r = await call(db, role, uid, `app_private.set_members_only(false)`);
    ok(`${who}: 끄는 함수 부르기 불가`, !!r.error, JSON.stringify(r));
    r = await call(db, role, uid, `app_private.new_code()`);
    ok(`${who}: 승인번호 생성 함수 부르기 불가`, !!r.error, JSON.stringify(r));
    r = await as(db, role, uid, `select * from public.redeem_attempts`);
    ok(`${who}: 입력 기록 읽기 불가`, !!r.error, r.error);
  }
  ok('위 시도 뒤에도 승인제는 켜져 있고 명단은 비어 있음', (await db.query(`select public.members_only() v, (select count(*)::int from public.members) n`)).rows[0].v === true && (await db.query(`select count(*)::int n from public.members`)).rows[0].n === 0);

  // ── 승인번호 만들기 ──
  const issued = await call(db, 'authenticated', A, `public.admin_issue_code('  홍길동  ')`);
  ok('관리자: 승인번호 만들기 (숫자 8자리, 이름 앞뒤 공백 정리)', /^\d{8}$/.test(issued.code || '') && issued.name === '홍길동' && !!issued.id, JSON.stringify(issued));
  const days = (Date.parse(issued.expires_at) - Date.now()) / 86400000;
  ok('기한은 7일', days > 6.99 && days < 7.01, String(days));
  let row = (await db.query(`select * from public.members`)).rows[0];
  ok('서버에는 승인번호 자체가 남지 않음 (알아볼 수 없는 값만 저장)', row.code_hash !== issued.code && /^[0-9a-f]{64}$/.test(row.code_hash) && !JSON.stringify(row).includes(issued.code) && row.created_by === A, JSON.stringify(row));
  r = await as(db, 'authenticated', A, `select * from public.admin_members()`);
  ok('명단: 대기 상태로 보임', r.rows && r.rows.length === 1 && r.rows[0].state === 'waiting' && r.rows[0].code_waiting === true && r.rows[0].name === '홍길동', JSON.stringify(r));
  ok('명단에 승인번호 관련 값은 나오지 않음', r.rows && !('code_hash' in r.rows[0]) && !('user_id' in r.rows[0]));
  r = await call(db, 'authenticated', A, `public.admin_issue_code('')`);
  ok('이름이 비면 거부', !!r.error, JSON.stringify(r));
  r = await call(db, 'authenticated', A, `public.admin_issue_code('${'가'.repeat(41)}')`);
  ok('이름이 너무 길면 거부', !!r.error, JSON.stringify(r));
  r = await call(db, 'authenticated', A, `public.admin_issue_code(null, '00000000-0000-0000-0000-000000000000')`);
  ok('없는 사람에게 다시 보내기는 거부', !!r.error, JSON.stringify(r));

  // ── 승인번호 입력: 틀림 · 잠금 ──
  r = await call(db, 'anon', null, `public.redeem_code('${issued.code}')`);
  ok('이름표 없는 상태(로그인 전)로는 입력 불가', !!r.error || (r.ok === false && r.reason === 'no_session'), JSON.stringify(r));
  r = await call(db, 'authenticated', G(1), `public.redeem_code('123')`);
  ok('자릿수가 틀리면 형식 안내 (틀린 횟수에 넣지 않음)', r.ok === false && r.reason === 'format' && (await db.query(`select count(*)::int n from public.redeem_attempts`)).rows[0].n === 0, JSON.stringify(r));
  const wrong = issued.code === '00000000' ? '00000001' : '00000000';
  const lefts = [];
  for (let i = 0; i < 5; i++) { r = await call(db, 'authenticated', G(1), `public.redeem_code('${wrong}')`); lefts.push(r.reason + ':' + r.left); }
  ok('틀릴 때마다 남은 횟수가 줄어듦', lefts.join(' ') === 'wrong:4 wrong:3 wrong:2 wrong:1 wrong:0', lefts.join(' '));
  r = await call(db, 'authenticated', G(1), `public.redeem_code('${wrong}')`);
  ok('5번 틀리면 잠김 (남은 시간 안내)', r.ok === false && r.reason === 'locked' && r.minutes >= 59 && r.minutes <= 60, JSON.stringify(r));
  r = await call(db, 'authenticated', G(1), `public.redeem_code('${issued.code}')`);
  ok('잠긴 동안에는 맞는 번호도 받지 않음 (번호는 그대로 남음)', r.ok === false && r.reason === 'locked' && (await db.query(`select code_hash is not null v from public.members`)).rows[0].v === true, JSON.stringify(r));
  await db.exec(`update public.redeem_attempts set at = now() - interval '61 minutes' where user_id = '${G(1)}'`);
  r = await call(db, 'authenticated', G(1), `public.redeem_code('${wrong}')`);
  ok('1시간이 지나면 다시 입력할 수 있음', r.reason === 'wrong' && r.left === 4, JSON.stringify(r));

  // ── 승인번호 입력: 성공 ──
  await guest(db, 2);
  r = await call(db, 'authenticated', G(2), `public.redeem_code('${issued.code.slice(0, 4)} ${issued.code.slice(4)}')`);
  ok('맞는 번호(띄어 쓴 것도) → 승인', r.ok === true && r.name === '홍길동', JSON.stringify(r));
  ok('승인된 휴대폰: 글이 보임', (await posts(db, 'authenticated', G(2))) === 3);
  r = await as(db, 'authenticated', G(2), `select count(*)::int n from storage.objects where bucket_id = 'post-images'`);
  ok('승인된 휴대폰: 사진이 보임', r.rows && r.rows[0].n === 1, r.error);
  g = await call(db, 'authenticated', G(2), 'public.gate_status()');
  ok('상태 묻기(승인된 휴대폰): 승인됨 + 이름', g.member === true && g.name === '홍길동' && g.admin === false, JSON.stringify(g));
  row = (await db.query(`select * from public.members`)).rows[0];
  ok('쓴 승인번호는 지워짐', row.code_hash === null && row.code_expires_at === null && row.user_id === G(2) && !!row.approved_at, JSON.stringify(row));
  await guest(db, 3);
  r = await call(db, 'authenticated', G(3), `public.redeem_code('${issued.code}')`);
  ok('같은 번호를 다른 휴대폰에서 또 쓰면 거부 (한 번만 사용)', r.ok === false && r.reason === 'wrong', JSON.stringify(r));
  ok('그 휴대폰은 여전히 볼 수 없음', (await posts(db, 'authenticated', G(3))) === 0);
  r = await call(db, 'authenticated', G(2), `public.redeem_code('${wrong}')`);
  ok('이미 승인된 휴대폰은 다시 입력해도 그대로 승인 상태', r.ok === true && r.already === true && r.name === '홍길동', JSON.stringify(r));
  r = await as(db, 'authenticated', A, `select * from public.admin_members()`);
  ok('명단: 승인 상태로 바뀜', r.rows[0].state === 'approved' && !!r.rows[0].approved_at && r.rows[0].code_waiting === false, JSON.stringify(r.rows));

  // ── 승인된 휴대폰이 할 수 없는 일 ──
  r = await as(db, 'authenticated', G(2), `insert into public.posts (kind, title) values ('news', '성도가 쓴 글')`);
  ok('승인된 휴대폰: 글 쓰기 불가', !!r.error, r.error);
  r = await as(db, 'authenticated', G(2), `delete from public.posts`);
  ok('승인된 휴대폰: 글 삭제 불가', r.n === 0, r.error || 'affected ' + r.n);
  r = await as(db, 'authenticated', G(2), `update public.posts set title = '바꿈'`);
  ok('승인된 휴대폰: 글 수정 불가', r.n === 0, r.error || 'affected ' + r.n);
  r = await as(db, 'authenticated', G(2), `insert into storage.objects (bucket_id, name) values ('post-images', 'x/1.jpg')`);
  ok('승인된 휴대폰: 사진 올리기 불가', !!r.error, r.error);
  r = await as(db, 'authenticated', G(2), `delete from storage.objects`);
  ok('승인된 휴대폰: 사진 삭제 불가', r.n === 0, r.error || 'affected ' + r.n);
  r = await call(db, 'authenticated', G(2), `public.admin_issue_code('친구')`);
  ok('승인된 휴대폰: 다른 사람 승인번호 만들기 불가', !!r.error, JSON.stringify(r));
  r = await as(db, 'authenticated', A, `insert into public.posts (kind, title) values ('news', '관리자 새 글') returning id`);
  ok('관리자: 글 쓰기는 그대로 가능', r.rows && r.rows.length === 1, r.error);
  ok('승인된 휴대폰: 새 글도 보임', (await posts(db, 'authenticated', G(2))) === 4);

  // ── 휴대폰 교체: 같은 사람에게 다시 보내기 ──
  const again = await call(db, 'authenticated', A, `public.admin_issue_code(null, '${issued.id}')`);
  ok('다시 보내기: 새 번호가 나옴', /^\d{8}$/.test(again.code || '') && again.id === issued.id && again.name === '홍길동', JSON.stringify(again));
  ok('새 번호를 입력하기 전까지 예전 휴대폰은 그대로 승인 상태', (await posts(db, 'authenticated', G(2))) === 4);
  r = await as(db, 'authenticated', A, `select * from public.admin_members()`);
  ok('명단: 승인 + 새 번호 대기', r.rows[0].state === 'approved' && r.rows[0].code_waiting === true, JSON.stringify(r.rows));
  await guest(db, 4);
  r = await call(db, 'authenticated', G(4), `public.redeem_code('${again.code}')`);
  ok('새 휴대폰에서 새 번호 입력 → 승인', r.ok === true && r.name === '홍길동', JSON.stringify(r));
  ok('예전 휴대폰은 볼 수 없게 됨', (await posts(db, 'authenticated', G(2))) === 0 && (await call(db, 'authenticated', G(2), 'public.gate_status()')).member === false);
  ok('예전 휴대폰의 임시 계정은 지워짐', (await db.query(`select count(*)::int n from auth.users where id = '${G(2)}'`)).rows[0].n === 0);
  ok('명단은 여전히 한 줄', (await db.query(`select count(*)::int n from public.members`)).rows[0].n === 1);

  // ── 기한 지난 번호 ──
  const kim = await call(db, 'authenticated', A, `public.admin_issue_code('김철수')`);
  await db.exec(`update public.members set code_expires_at = now() - interval '1 minute' where id = '${kim.id}'`);
  await guest(db, 5);
  r = await call(db, 'authenticated', G(5), `public.redeem_code('${kim.code}')`);
  ok('기한 지난 번호는 거부 (기한 안내)', r.ok === false && r.reason === 'expired', JSON.stringify(r));
  r = await as(db, 'authenticated', A, `select name, state from public.admin_members() order by name`);
  ok('명단: 기한 지남으로 보임', r.rows.find((x) => x.name === '김철수').state === 'expired', JSON.stringify(r.rows));
  const kim2 = await call(db, 'authenticated', A, `public.admin_issue_code(null, '${kim.id}')`);
  r = await call(db, 'authenticated', G(5), `public.redeem_code('${kim2.code}')`);
  ok('다시 보낸 번호로는 승인됨', r.ok === true && r.name === '김철수', JSON.stringify(r));

  // ── 이미 승인된 휴대폰이 남의 번호를 넣어도 그 번호는 소모되지 않음 ──
  const lee = await call(db, 'authenticated', A, `public.admin_issue_code('이영희')`);
  r = await call(db, 'authenticated', G(5), `public.redeem_code('${lee.code}')`);
  ok('승인된 휴대폰이 다른 사람 번호를 넣으면 자기 승인 그대로', r.ok === true && r.already === true && r.name === '김철수', JSON.stringify(r));
  await guest(db, 6);
  r = await call(db, 'authenticated', G(6), `public.redeem_code('${lee.code}')`);
  ok('그 번호는 주인이 그대로 쓸 수 있음', r.ok === true && r.name === '이영희', JSON.stringify(r));

  // ── 승인 취소 ──
  r = await call(db, 'authenticated', E, `public.admin_remove_member('${issued.id}')`);
  ok('일반 계정: 승인 취소 불가', !!r.error && (await posts(db, 'authenticated', G(4))) === 4, JSON.stringify(r));
  r = await call(db, 'authenticated', A, `public.admin_remove_member('${issued.id}')`);
  ok('관리자: 승인 취소', r === true, JSON.stringify(r));
  ok('취소된 휴대폰은 바로 볼 수 없음', (await posts(db, 'authenticated', G(4))) === 0);
  ok('취소된 휴대폰의 임시 계정도 지워짐', (await db.query(`select count(*)::int n from auth.users where id = '${G(4)}'`)).rows[0].n === 0);
  r = await call(db, 'authenticated', A, `public.admin_remove_member('${issued.id}')`);
  ok('이미 없는 사람을 또 지우면 false', r === false, JSON.stringify(r));
  ok('다른 사람의 승인은 그대로', (await posts(db, 'authenticated', G(5))) === 4 && (await posts(db, 'authenticated', G(6))) === 4);

  // ── 승인 취소로 이름표가 지워진 휴대폰이 곧바로 새 번호를 입력하는 경우 ──
  const back = await call(db, 'authenticated', A, `public.admin_issue_code('홍길동(다시)')`);
  r = await call(db, 'authenticated', G(4), `public.redeem_code('${back.code}')`);
  ok('지워진 이름표로 입력하면 "이름표를 새로 받으라"는 답 (오류 아님, 번호는 그대로)', r.ok === false && r.reason === 'no_session' && (await db.query(`select code_hash is not null v from public.members where id = '${back.id}'`)).rows[0].v === true, JSON.stringify(r));
  await guest(db, 8);
  r = await call(db, 'authenticated', G(8), `public.redeem_code('${back.code}')`);
  ok('새 이름표로는 승인됨', r.ok === true && r.name === '홍길동(다시)', JSON.stringify(r));

  // ── 이메일 계정(관리자 아님)이 번호를 입력한 경우 ──
  const park = await call(db, 'authenticated', A, `public.admin_issue_code('박집사')`);
  r = await call(db, 'authenticated', E, `public.redeem_code('${park.code}')`);
  ok('이메일 계정도 번호가 맞으면 승인', r.ok === true && (await posts(db, 'authenticated', E)) === 4, JSON.stringify(r));
  await call(db, 'authenticated', A, `public.admin_remove_member('${park.id}')`);
  ok('취소해도 이메일 계정 자체는 지우지 않음', (await db.query(`select count(*)::int n from auth.users where id = '${E}'`)).rows[0].n === 1 && (await posts(db, 'authenticated', E)) === 0);

  // ── 무작위 대입 방지: 전체 잠시 닫기 ──
  const choi = await call(db, 'authenticated', A, `public.admin_issue_code('최권사')`);
  await db.exec(`insert into public.redeem_attempts (user_id, at) select gen_random_uuid(), now() - interval '1 minute' from generate_series(1, 60)`);
  await guest(db, 7);
  r = await call(db, 'authenticated', G(7), `public.redeem_code('${choi.code}')`);
  ok('틀린 입력이 몰리면 잠시 닫힘 (맞는 번호도 대기)', r.ok === false && r.reason === 'busy', JSON.stringify(r));
  await db.exec(`update public.redeem_attempts set at = now() - interval '11 minutes' where at > now() - interval '10 minutes'`);
  r = await call(db, 'authenticated', G(7), `public.redeem_code('${choi.code}')`);
  ok('10분 뒤에는 다시 열림', r.ok === true && r.name === '최권사', JSON.stringify(r));

  // ── 정리 기능 ──
  await db.exec(`
    insert into auth.users (id, is_anonymous, created_at) values ('${G(90)}', true, now() - interval '3 days'), ('${G(91)}', true, now() - interval '1 hour');
    update auth.users set created_at = now() - interval '30 days' where id in ('${G(5)}', '${A}', '${E}');
    insert into public.redeem_attempts (user_id, at) values ('${G(90)}', now() - interval '8 days'), ('${G(91)}', now() - interval '1 hour');`);
  r = await call(db, 'authenticated', A, `public.admin_cleanup()`);
  const left = (await db.query(`select id from auth.users`)).rows.map((x) => x.id);
  ok('정리: 번호를 넣다 만 오래된 임시 계정만 지움', !left.includes(G(90)) && left.includes(G(91)) && left.includes(G(5)) && left.includes(A) && left.includes(E), JSON.stringify(r) + ' ' + left.length);
  ok('정리: 승인된 휴대폰은 오래돼도 그대로', (await posts(db, 'authenticated', G(5))) === 4);
  ok('정리: 일주일 넘은 입력 기록 삭제', (await db.query(`select count(*)::int n from public.redeem_attempts where at < now() - interval '7 days'`)).rows[0].n === 0 && (await db.query(`select count(*)::int n from public.redeem_attempts where user_id = '${G(91)}'`)).rows[0].n === 1);

  // ── 번호가 겹치지 않는지 ──
  const codes = [];
  for (let i = 0; i < 150; i++) codes.push((await call(db, 'authenticated', A, `public.admin_issue_code('시험 ${i}')`)).code);
  ok('번호 150개: 모두 8자리이고 서로 다름', codes.every((c) => /^\d{8}$/.test(c)) && new Set(codes).size === 150, codes.slice(0, 3).join(','));
  ok('번호가 한쪽으로 쏠리지 않음 (첫 자리 6종 이상)', new Set(codes.map((c) => c[0])).size >= 6, [...new Set(codes.map((c) => c[0]))].join(''));

  // ── 끄기 · 켜기 ──
  let msg = (await db.query(`select app_private.set_members_only(false) m`)).rows[0].m;
  ok('SQL Editor: 승인제 끄기', /껐습니다/.test(msg), msg);
  ok('끄면 누구나 글을 볼 수 있음', (await posts(db, 'anon', null)) === 4 && (await posts(db, 'authenticated', G(3))) === 4);
  r = await as(db, 'anon', null, `select count(*)::int n from storage.objects where bucket_id = 'post-images'`);
  ok('끄면 누구나 사진을 받을 수 있음 (보관함은 비공개인 채로 규칙이 허용)', r.rows && r.rows[0].n === 1 && (await db.query(`select public from storage.buckets`)).rows[0].public === false, r.error);
  g = await call(db, 'anon', null, 'public.gate_status()');
  ok('상태 묻기: 승인제 꺼짐으로 표시', g.members_only === false, JSON.stringify(g));
  r = await as(db, 'anon', null, `insert into public.posts (kind, title) values ('news', '장난 글')`);
  ok('꺼져 있어도 글 쓰기는 관리자만', !!r.error, r.error);
  res = await db.exec(MEMBERS);
  ok('꺼 둔 상태에서 설정을 다시 실행해도 꺼진 채로 유지', /^꺼짐/.test(last(res)['성도 승인']), JSON.stringify(last(res)));
  msg = (await db.query(`select app_private.set_members_only(true) m`)).rows[0].m;
  ok('다시 켜면 승인된 휴대폰과 관리자만', /켰습니다/.test(msg) && (await posts(db, 'anon', null)) === 0 && (await posts(db, 'authenticated', G(5))) === 4);

  // ── 1단계 설정을 다시 실행해도 열리지 않는지 ──
  res = await db.exec(SETUP);
  ok('1단계를 다시 실행해도 "누구나 읽기"로 돌아가지 않음', (await posts(db, 'anon', null)) === 0 && (await posts(db, 'authenticated', G(3))) === 0, JSON.stringify(last(res)));
  const pol = (await db.query(`select policyname from pg_policies where schemaname = 'public' and tablename = 'posts' order by 1`)).rows.map((x) => x.policyname).join(',');
  ok('글 읽기 규칙은 승인 규칙 하나뿐', pol === 'posts_delete_admin,posts_insert_admin,posts_read_gate,posts_update_admin', pol);
  ok('사진 보관함도 비공개 그대로', (await db.query(`select public from storage.buckets where id = 'post-images'`)).rows[0].public === false);
  await db.close();
}

async function freshOrder() {
  console.log('\n=== 새 서버에 1단계 → 2단계를 바로 이어서 실행 ===');
  const db = new PGlite();
  await db.exec(baseEnv(false));
  await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${A}', 'admin@church.kr', now());`);
  await db.exec(SETUP);
  const res = await db.exec(MEMBERS);
  ok('글 3개는 남아 있고 관리자만 볼 수 있음', (await posts(db, 'authenticated', A)) === 3 && (await posts(db, 'anon', null)) === 0, JSON.stringify(last(res)));
  await db.close();
}

await scenario(false);
await scenario(true);
await freshOrder();
console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
