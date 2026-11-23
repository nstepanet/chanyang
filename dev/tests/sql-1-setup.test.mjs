// 1단계(서버 처음 설정) 점검: 실제 Postgres(PGlite) 위에서 setup.sql 을 돌려 봅니다.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const SETUP = fs.readFileSync(new URL('../../supabase/setup.sql', import.meta.url), 'utf8');
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222', C = '33333333-3333-3333-3333-333333333333';

// A stand-in for the parts of a Supabase project that setup.sql touches
const baseEnv = (autoExpose) => `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, email_confirmed_at timestamptz);
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
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? '  ok  ' : ' FAIL ') + name + (extra ? '  → ' + extra : '')); };

async function as(db, role, uid, sql) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${role};`);
  try { const r = await db.query(sql); return { rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { error: e.message }; }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}

async function scenario(autoExpose) {
  console.log(`\n=== ${autoExpose ? '예전 방식(자동 권한 부여)' : '새 방식(권한을 직접 줘야 함)'} 프로젝트 ===`);
  const db = new PGlite();
  await db.exec(baseEnv(autoExpose));
  await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${A}', 'admin@church.kr', now()), ('${C}', 'pending@x.com', null);`);
  await db.exec(SETUP);
  const first = await db.query(`select user_id from public.app_admins`);
  ok('처음 실행: 확인된 계정만 관리자로 등록', first.rows.length === 1 && first.rows[0].user_id === A);
  await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${B}', 'member@x.com', now());`);
  const rerun = await db.exec(SETUP);                       // 두 번째 실행 (오류 없이, 내용 변화 없이)
  const summary = rerun[rerun.length - 1].rows[0];
  ok('다시 실행해도 관리자·글이 늘지 않음', summary['관리자 계정'] === 'admin@church.kr' && Number(summary['글 개수']) === 3, JSON.stringify(summary));

  let r = await as(db, 'anon', null, `select count(*)::int as n from public.posts`);
  ok('로그인 안 한 사람: 글 읽기 가능', r.rows && r.rows[0].n === 3, r.error);
  r = await as(db, 'anon', null, `insert into public.posts (kind, title) values ('news', '장난 글')`);
  ok('로그인 안 한 사람: 글 쓰기 불가', !!r.error, r.error);
  r = await as(db, 'anon', null, `delete from public.posts`);
  ok('로그인 안 한 사람: 글 삭제 불가', !!r.error || r.n === 0, r.error || 'affected ' + r.n);
  r = await as(db, 'authenticated', B, `insert into public.posts (kind, title) values ('news', '일반 계정 글')`);
  ok('관리자가 아닌 계정: 글 쓰기 불가', !!r.error, r.error);
  r = await as(db, 'authenticated', B, `update public.posts set title = '바꿈'`);
  ok('관리자가 아닌 계정: 글 수정 불가', r.n === 0, r.error || 'affected ' + r.n);
  r = await as(db, 'authenticated', B, `delete from public.posts`);
  ok('관리자가 아닌 계정: 글 삭제 불가', r.n === 0, r.error || 'affected ' + r.n);
  r = await as(db, 'authenticated', A, `insert into public.posts (kind, title, body, images) values ('bulletin', '11월 22일 주보', '예배 순서', '["x/1.jpg"]') returning id, created_by`);
  ok('관리자: 글 쓰기 가능 + 작성자 기록', r.rows && r.rows[0].created_by === A, r.error);
  const newId = r.rows && r.rows[0].id;
  r = await as(db, 'authenticated', A, `update public.posts set title = '11월 22일 주보(수정)' where id = '${newId}'`);
  ok('관리자: 글 수정 가능', r.n === 1, r.error);
  r = await as(db, 'authenticated', A, `delete from public.posts where id = '${newId}'`);
  ok('관리자: 글 삭제 가능', r.n === 1, r.error);
  r = await as(db, 'authenticated', A, `insert into public.posts (kind, title) values ('other', '종류 틀림')`);
  ok('잘못된 종류는 거부', !!r.error, r.error);

  r = await as(db, 'anon', null, `select public.is_admin() as v`);
  ok('is_admin: 로그인 안 한 사람 = 아님', r.rows && r.rows[0].v === false, r.error);
  r = await as(db, 'authenticated', B, `select public.is_admin() as v`);
  ok('is_admin: 일반 계정 = 아님', r.rows && r.rows[0].v === false, r.error);
  r = await as(db, 'authenticated', A, `select public.is_admin() as v`);
  ok('is_admin: 관리자 = 맞음', r.rows && r.rows[0].v === true, r.error);

  for (const [role, uid] of [['anon', null], ['authenticated', B]]) {
    r = await as(db, role, uid, `select app_private.add_admin('member@x.com')`);
    ok(`${role}: 스스로 관리자 되기 불가`, !!r.error, r.error);
    r = await as(db, role, uid, `select * from public.app_admins`);
    ok(`${role}: 관리자 목록 읽기 불가`, !!r.error, r.error);
    r = await as(db, role, uid, `insert into public.app_admins (user_id) values ('${B}')`);
    ok(`${role}: 관리자 목록에 직접 넣기 불가`, !!r.error, r.error);
  }

  r = await as(db, 'authenticated', A, `insert into storage.objects (bucket_id, name) values ('post-images', 'abc/1.jpg')`);
  ok('관리자: 사진 올리기 가능', !r.error, r.error);
  r = await as(db, 'authenticated', A, `insert into storage.objects (bucket_id, name) values ('post-images', 'abc/virus.exe')`);
  ok('관리자라도 사진이 아닌 파일은 거부', !!r.error, r.error);
  r = await as(db, 'authenticated', B, `insert into storage.objects (bucket_id, name) values ('post-images', 'abc/2.jpg')`);
  ok('일반 계정: 사진 올리기 불가', !!r.error, r.error);
  r = await as(db, 'anon', null, `insert into storage.objects (bucket_id, name) values ('post-images', 'abc/3.jpg')`);
  ok('로그인 안 한 사람: 사진 올리기 불가', !!r.error, r.error);
  r = await as(db, 'authenticated', B, `delete from storage.objects where bucket_id = 'post-images'`);
  ok('일반 계정: 사진 삭제 불가', r.n === 0, r.error || 'affected ' + r.n);
  r = await as(db, 'authenticated', A, `delete from storage.objects where bucket_id = 'post-images'`);
  ok('관리자: 사진 삭제 가능', r.n === 1, r.error || 'affected ' + r.n);

  let q = await db.query(`select app_private.add_admin('Member@X.com') as m`);
  let cnt = await db.query(`select count(*)::int n from public.app_admins`);
  ok('SQL Editor: 관리자 추가', cnt.rows[0].n === 2, q.rows[0].m);
  q = await db.query(`select app_private.add_admin('nobody@x.com') as m`);
  ok('SQL Editor: 없는 계정은 안내 문구', /찾지 못했습니다/.test(q.rows[0].m), q.rows[0].m);
  q = await db.query(`select app_private.remove_admin('member@x.com') as m`);
  cnt = await db.query(`select count(*)::int n from public.app_admins`);
  ok('SQL Editor: 관리자 제외', cnt.rows[0].n === 1, q.rows[0].m);
  const b = await db.query(`select public from storage.buckets where id = 'post-images'`);
  ok('사진 저장 공간이 공개로 만들어짐', b.rows.length === 1 && b.rows[0].public === true);
  await db.close();
}

async function emptyStart() {
  console.log('\n=== 계정을 만들기 전에 설정부터 실행한 경우 ===');
  const db = new PGlite();
  await db.exec(baseEnv(false));
  let res = await db.exec(SETUP);
  ok('관리자 없음 안내가 나옴', /없음/.test(res[res.length - 1].rows[0]['관리자 계정']), res[res.length - 1].rows[0]['관리자 계정']);
  await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${A}', 'admin@church.kr', now());`);
  res = await db.exec(SETUP);
  ok('계정을 만든 뒤 다시 실행하면 등록됨', res[res.length - 1].rows[0]['관리자 계정'] === 'admin@church.kr', res[res.length - 1].rows[0]['관리자 계정']);
  await db.close();
}

await scenario(false);
await scenario(true);
await emptyStart();
console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
