// 3단계(화면 디자인) 서버 설정 점검: 실제 Postgres(PGlite) 위에서 setup.sql (+ members.sql) + theme.sql 을 돌려 봅니다.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const SETUP = fs.readFileSync(new URL('../../supabase/setup.sql', import.meta.url), 'utf8');
const MEMBERS = fs.readFileSync(new URL('../../supabase/members.sql', import.meta.url), 'utf8');
const THEME = fs.readFileSync(new URL('../../supabase/theme.sql', import.meta.url), 'utf8');
const A = '11111111-1111-1111-1111-111111111111';   // 관리자(이메일 계정)
const E = '22222222-2222-2222-2222-222222222222';   // 관리자가 아닌 이메일 계정
const G = 'aaaaaaaa-0000-0000-0000-000000000001';   // 휴대폰 임시 계정

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
const call = async (db, role, uid, fn) => { const r = await as(db, role, uid, `select ${fn} as v`); return r.error ? { error: r.error } : r.rows[0].v; };
const last = (res) => res[res.length - 1].rows[0];

async function scenario(autoExpose, withMembers) {
  console.log(`\n=== ${autoExpose ? '예전 방식(자동 권한 부여)' : '새 방식(권한을 직접 줘야 함)'} 프로젝트 · ${withMembers ? '성도 승인(2단계)을 쓰는 서버' : '1단계만 실행한 서버'} ===`);
  const db = new PGlite();
  await db.exec(baseEnv(autoExpose));
  await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${A}', 'admin@church.kr', now());`);

  let pre = null;
  try { await db.exec(THEME); } catch (e) { pre = e.message; }
  ok('1단계 없이 실행하면 안내와 함께 멈춤', /1단계 설정/.test(pre || ''), pre);

  await db.exec(SETUP);
  if (withMembers) await db.exec(MEMBERS);
  await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${E}', 'member@x.com', now());
    insert into auth.users (id, is_anonymous) values ('${G}', true);`);

  let v = await call(db, 'anon', null, 'public.app_theme()');
  ok('3단계 실행 전: 디자인을 묻는 함수가 아직 없음 (앱은 처음 값으로 보임)', !!(v && v.error) && /does not exist/.test(v.error), JSON.stringify(v));

  let res = await db.exec(THEME);
  ok('실행 결과: 처음 값은 밝은 화면, 관리자 계정 표시', last(res)['화면 디자인'] === '밝은 화면' && last(res)['관리자 계정'] === 'admin@church.kr', JSON.stringify(last(res)));

  // ── 읽기: 누구나 ──
  ok('로그인 안 한 사람도 지금 디자인을 읽을 수 있음 (승인 전 화면에도 필요)', (await call(db, 'anon', null, 'public.app_theme()')) === 'bright');
  ok('휴대폰 임시 계정도 읽을 수 있음', (await call(db, 'authenticated', G, 'public.app_theme()')) === 'bright');
  ok('관리자도 읽을 수 있음', (await call(db, 'authenticated', A, 'public.app_theme()')) === 'bright');

  // ── 바꾸기: 관리자만 ──
  v = await call(db, 'anon', null, `public.admin_set_theme('warm')`);
  ok('로그인 안 한 사람은 바꿀 수 없음', !!(v && v.error) && /permission denied|forbidden/.test(v.error), JSON.stringify(v));
  v = await call(db, 'authenticated', G, `public.admin_set_theme('warm')`);
  ok('승인된 성도의 휴대폰이라도 바꿀 수 없음', !!(v && v.error) && /forbidden/.test(v.error), JSON.stringify(v));
  v = await call(db, 'authenticated', E, `public.admin_set_theme('warm')`);
  ok('관리자가 아닌 이메일 계정은 바꿀 수 없음', !!(v && v.error) && /forbidden/.test(v.error), JSON.stringify(v));
  ok('막힌 시도 뒤에도 디자인은 그대로', (await call(db, 'anon', null, 'public.app_theme()')) === 'bright');

  v = await call(db, 'authenticated', A, `public.admin_set_theme('warm')`);
  ok('관리자는 바꿀 수 있음', v === 'warm', JSON.stringify(v));
  ok('바꾼 뒤에는 누구에게나 새 디자인으로 읽힘', (await call(db, 'anon', null, 'public.app_theme()')) === 'warm' && (await call(db, 'authenticated', G, 'public.app_theme()')) === 'warm');
  let row = (await db.query(`select theme, updated_by, updated_at > now() - interval '1 minute' as fresh from public.app_look where id = 1`)).rows[0];
  ok('누가 언제 바꿨는지 남음', row.theme === 'warm' && row.updated_by === A && row.fresh === true, JSON.stringify(row));
  for (const t of ['classic', 'bright', 'warm']) {
    v = await call(db, 'authenticated', A, `public.admin_set_theme('${t}')`);
    ok(`세 가지 값 모두 고를 수 있음: ${t}`, v === t && (await call(db, 'anon', null, 'public.app_theme()')) === t, JSON.stringify(v));
  }
  for (const bad of [`'dark'`, `''`, `null`, `'Bright'`, `'warm; drop table public.posts'`]) {
    v = await call(db, 'authenticated', A, `public.admin_set_theme(${bad})`);
    ok(`없는 값은 받지 않음: ${bad}`, !!(v && v.error) && /unknown theme/.test(v.error), JSON.stringify(v));
  }
  ok('잘못된 값을 넣으려 한 뒤에도 디자인은 그대로', (await call(db, 'anon', null, 'public.app_theme()')) === 'warm');

  // ── 표를 직접 건드릴 수 없음 ──
  for (const [role, uid] of [['anon', null], ['authenticated', G], ['authenticated', E], ['authenticated', A]]) {
    const r1 = await as(db, role, uid, `select theme from public.app_look`);
    const r2 = await as(db, role, uid, `update public.app_look set theme = 'classic'`);
    const r3 = await as(db, role, uid, `insert into public.app_look (id, theme) values (2, 'classic')`);
    const blocked = (r) => !!r.error || (r.rows && r.rows.length === 0 && !r.n);
    ok(`표를 직접 읽거나 고칠 수 없음: ${role}${uid === A ? ' (관리자)' : uid ? '' : ' (로그인 안 함)'}`, blocked(r1) && blocked(r2) && !!r3.error, JSON.stringify([r1, r2, r3]).slice(0, 300));
  }
  ok('직접 고치려 한 뒤에도 디자인은 그대로', (await call(db, 'anon', null, 'public.app_theme()')) === 'warm');
  v = await call(db, 'authenticated', A, `app_private.set_theme('classic')`);
  ok('SQL Editor 전용 함수는 앱에서 부를 수 없음 (관리자여도)', !!(v && v.error) && /permission denied/.test(v.error), JSON.stringify(v));

  // ── 다시 실행 · SQL Editor 에서 바꾸기 ──
  res = await db.exec(THEME);
  ok('한 번 더 실행해도 오류 없고, 고른 디자인이 그대로임', last(res)['화면 디자인'] === '따뜻한 화면' && (await call(db, 'anon', null, 'public.app_theme()')) === 'warm', JSON.stringify(last(res)));
  let r = await db.query(`select app_private.set_theme('classic') as v`);
  ok('SQL Editor 에서 직접 바꿀 수 있음', /클래식 화면으로 바꿨습니다/.test(r.rows[0].v) && (await call(db, 'anon', null, 'public.app_theme()')) === 'classic', r.rows[0].v);
  let bad = null; try { await db.query(`select app_private.set_theme('navy')`); } catch (e) { bad = e.message; }
  ok('SQL Editor 에서도 없는 값은 받지 않고 고를 수 있는 값을 알려 줌', /bright.*warm.*classic/.test(bad || ''), bad);

  // ── 다른 설정과 서로 영향 없음 ──
  if (withMembers) {
    const g = await call(db, 'anon', null, 'public.gate_status()');
    ok('성도 승인 상태는 그대로 (켜져 있음)', g && g.members_only === true && g.member === false, JSON.stringify(g));
    res = await db.exec(MEMBERS);
    ok('2단계를 다시 실행해도 디자인은 그대로', (await call(db, 'anon', null, 'public.app_theme()')) === 'classic');
    const n = await as(db, 'anon', null, `select count(*)::int as n from public.posts`);
    ok('글 읽기 권한도 그대로 (승인 전에는 보이지 않음)', n.rows && n.rows[0].n === 0, JSON.stringify(n));
  } else {
    const g = await call(db, 'anon', null, 'public.gate_status()');
    ok('성도 승인을 쓰지 않는 서버에서도 동작 (승인 함수는 여전히 없음)', !!(g && g.error) && (await call(db, 'anon', null, 'public.app_theme()')) === 'classic', JSON.stringify(g));
    res = await db.exec(SETUP);
    ok('1단계를 다시 실행해도 디자인은 그대로', (await call(db, 'anon', null, 'public.app_theme()')) === 'classic');
  }
  // 관리자 계정이 지워져도 설정은 남음
  await db.query(`select public.admin_set_theme('warm')`).catch(() => {});
  await as(db, 'authenticated', A, `select public.admin_set_theme('warm')`);
  await db.exec(`delete from auth.users where id = '${A}'`);
  row = (await db.query(`select theme, updated_by from public.app_look where id = 1`)).rows[0];
  ok('바꾼 관리자 계정이 지워져도 디자인 설정은 남음', row.theme === 'warm' && row.updated_by === null, JSON.stringify(row));
  await db.close();
}

for (const autoExpose of [true, false]) for (const withMembers of [false, true]) await scenario(autoExpose, withMembers);
console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
