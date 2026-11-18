-- =====================================================================
-- 찬양하는교회 앱 · 서버 설정 (2단계: 성도 승인)
--
-- 이 설정을 실행하면 그 순간부터 "승인된 휴대폰과 관리자"만 글과 주보 사진을 볼 수 있습니다.
--
-- 실행하기 전에
--   · 1단계 설정(setup.sql)을 이미 실행한 상태여야 합니다.
--   · Supabase 대시보드 → Authentication → Sign In / Providers 에서
--     "Allow new users to sign up" 과 "Allow anonymous sign-ins" 를 켭니다.
--   · 관리자 로그인이 되는지 먼저 확인해 두세요. 실행한 뒤에는 관리자로 들어가 승인번호를 보냅니다.
--
-- 사용법: SQL Editor 에 이 내용 전체를 붙여 넣고 Run. 여러 번 실행해도 안전합니다.
--
-- 되돌리기 (승인 없이 누구나 볼 수 있게):  select app_private.set_members_only(false);
-- 다시 켜기:                               select app_private.set_members_only(true);
-- =====================================================================

-- 0. 1단계 설정이 되어 있는지 확인 ------------------------------------
do $$
begin
  if to_regclass('public.posts') is null or to_regclass('public.app_admins') is null
     or to_regprocedure('public.is_admin()') is null then
    raise exception '1단계 설정(setup.sql)을 먼저 실행해 주세요.';
  end if;
end;
$$;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- 1. 설정값: 성도 승인을 쓸지 여부 ------------------------------------
create table if not exists public.app_settings (
  id           integer primary key default 1 check (id = 1),
  members_only boolean not null default true,
  updated_at   timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
-- 처음 실행할 때만 "켜짐"으로 넣습니다. 나중에 끈 상태에서 다시 실행해도 바뀌지 않습니다.
insert into public.app_settings (id, members_only) values (1, true) on conflict (id) do nothing;

-- 2. 성도 명단 --------------------------------------------------------
--    한 줄이 "한 사람의 휴대폰 한 대"입니다. 전화번호는 저장하지 않습니다.
--    code_hash : 아직 쓰지 않은 승인번호 (번호 자체가 아니라 알아볼 수 없게 바꾼 값)
--    user_id   : 승인번호를 입력한 휴대폰 (서버가 그 휴대폰에 붙여 준 이름표)
create table if not exists public.members (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(btrim(name)) between 1 and 40),
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  code_hash       text,
  code_expires_at timestamptz,
  user_id         uuid references auth.users (id) on delete set null,
  approved_at     timestamptz
);
create unique index if not exists members_user_id_key on public.members (user_id) where user_id is not null;
create unique index if not exists members_code_hash_key on public.members (code_hash) where code_hash is not null;
alter table public.members enable row level security;
-- 정책을 만들지 않으므로 앱에서는 이 표를 직접 읽거나 고칠 수 없고, 아래 함수로만 다룹니다.
revoke all on public.members from anon, authenticated;

-- 3. 틀린 승인번호 입력 기록 (잠금 계산용, 일주일 뒤 정리) ----------------
create table if not exists public.redeem_attempts (
  id      bigint generated always as identity primary key,
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists redeem_attempts_user_at_idx on public.redeem_attempts (user_id, at desc);
create index if not exists redeem_attempts_at_idx on public.redeem_attempts (at desc);
alter table public.redeem_attempts enable row level security;
revoke all on public.redeem_attempts from anon, authenticated;

-- 4. 상태를 알려 주는 함수 ---------------------------------------------
create or replace function public.members_only()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.members_only from public.app_settings s where s.id = 1), false);
$$;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m where m.user_id = (select auth.uid())
  );
$$;

-- "지금 이 사람이 글과 사진을 볼 수 있는가?"
create or replace function public.can_read()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (not public.members_only()) or public.is_admin() or public.is_member();
$$;

-- 앱이 처음 켜질 때 묻는 것: 승인제가 켜져 있는지, 이 휴대폰이 승인됐는지
create or replace function public.gate_status()
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'members_only', public.members_only(),
    'admin',        public.is_admin(),
    'member',       public.is_member(),
    'name',         (select m.name from public.members m where m.user_id = (select auth.uid()))
  );
$$;

-- 5. 승인번호 만들기에 쓰는 내부 함수 (앱에서는 부를 수 없음) --------------
create or replace function app_private.code_hash(code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(code, 'UTF8')), 'hex');
$$;

-- 겹치지 않는 숫자 8자리를 무작위로 만듭니다.
create or replace function app_private.new_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c text;
begin
  loop
    c := lpad(
      ((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))::bit(48)::bigint) % 100000000)::text,
      8, '0');
    exit when not exists (
      select 1 from public.members m where m.code_hash = app_private.code_hash(c)
    );
  end loop;
  return c;
end;
$$;

-- 더 이상 쓰지 않는 휴대폰 이름표(임시 계정)를 지웁니다. 관리자 계정은 건드리지 않습니다.
create or replace function app_private.drop_guest(guest uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from auth.users u
   where u.id = guest
     and u.is_anonymous is true
     and not exists (select 1 from public.app_admins a where a.user_id = u.id)
     and not exists (select 1 from public.members m where m.user_id = u.id);
exception when others then
  null;  -- 지우지 못해도 승인 취소 자체는 이미 끝난 것으로 봅니다.
end;
$$;

-- 6. 성도가 쓰는 함수: 승인번호 입력 ------------------------------------
--    돌려주는 값: { ok: true, name } 또는 { ok: false, reason }
--    reason: wrong(틀림) · expired(기한 지남) · locked(5번 틀려 1시간 잠김) · busy(잠시 닫힘) · format · no_session
create or replace function public.redeem_code(code text)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  digits  text := regexp_replace(coalesce(code, ''), '[^0-9]', '', 'g');
  fails   integer;
  oldest  timestamptz;
  rec     public.members%rowtype;
  mine    public.members%rowtype;
  hit     boolean;
  old_uid uuid;
begin
  -- 이름표가 없거나, 서버에서 이미 지워진 이름표이면 앱이 새로 받아 다시 시도합니다.
  if uid is null or not exists (select 1 from auth.users u where u.id = uid) then
    return json_build_object('ok', false, 'reason', 'no_session');
  end if;

  -- 이미 승인된 휴대폰이면 그대로 둡니다. (승인번호를 쓰지 않습니다)
  select * into mine from public.members m where m.user_id = uid;
  if found then
    return json_build_object('ok', true, 'name', mine.name, 'already', true);
  end if;

  if char_length(digits) <> 8 then
    return json_build_object('ok', false, 'reason', 'format');
  end if;

  -- 이 휴대폰에서 최근 1시간 동안 5번 틀렸으면 잠급니다.
  select count(*), min(t.at) into fails, oldest
    from public.redeem_attempts t
   where t.user_id = uid and t.at > now() - interval '1 hour';
  if fails >= 5 then
    return json_build_object('ok', false, 'reason', 'locked',
      'minutes', greatest(1, ceil(extract(epoch from (oldest + interval '1 hour' - now())) / 60.0)::integer));
  end if;

  -- 여러 곳에서 틀린 번호가 몰려 들어오면 잠시 닫습니다. (무작위로 맞혀 보는 시도 방지)
  if (select count(*) from public.redeem_attempts t where t.at > now() - interval '10 minutes') >= 60 then
    return json_build_object('ok', false, 'reason', 'busy');
  end if;

  select * into rec from public.members m
   where m.code_hash = app_private.code_hash(digits)
     for update;
  hit := found;

  if not hit or rec.code_expires_at is null or rec.code_expires_at <= now() then
    insert into public.redeem_attempts (user_id) values (uid);
    return json_build_object('ok', false,
      'reason', case when hit then 'expired' else 'wrong' end,
      'left', greatest(0, 4 - fails));
  end if;

  old_uid := rec.user_id;
  update public.members m
     set user_id = uid, approved_at = now(), code_hash = null, code_expires_at = null
   where m.id = rec.id;
  delete from public.redeem_attempts t where t.user_id = uid;

  -- 같은 사람이 새 휴대폰으로 바꾼 경우: 예전 휴대폰의 이름표를 치웁니다.
  if old_uid is not null and old_uid <> uid then
    perform app_private.drop_guest(old_uid);
  end if;

  return json_build_object('ok', true, 'name', rec.name);
end;
$$;

-- 7. 관리자가 쓰는 함수 -------------------------------------------------
-- 명단 보기. state: approved(승인) · waiting(승인번호 입력 대기) · expired(기한 지남)
create or replace function public.admin_members()
returns table (
  id uuid, name text, state text, created_at timestamptz,
  approved_at timestamptz, code_expires_at timestamptz, code_waiting boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select m.id, m.name,
           case when m.user_id is not null then 'approved'
                when m.code_hash is not null and m.code_expires_at > now() then 'waiting'
                else 'expired' end,
           m.created_at, m.approved_at, m.code_expires_at,
           (m.code_hash is not null and m.code_expires_at > now())
      from public.members m
     order by m.created_at desc, m.name;
end;
$$;

-- 승인번호 만들기. member_id 가 없으면 새 사람을 명단에 넣고,
-- 있으면 그 사람에게 새 승인번호를 줍니다(예전 번호는 못 쓰게 됨, 이미 승인된 휴대폰은 새 번호를 입력할 때까지 그대로).
-- 승인번호는 이때 한 번만 돌려주고 서버에는 남기지 않습니다. 7일 동안 쓸 수 있습니다.
create or replace function public.admin_issue_code(member_name text default null, member_id uuid default null)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  nm    text := btrim(coalesce(member_name, ''));
  c     text;
  rec   public.members%rowtype;
  until timestamptz := now() + interval '7 days';
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  c := app_private.new_code();
  if member_id is null then
    if char_length(nm) < 1 or char_length(nm) > 40 then
      raise exception 'bad_name' using errcode = '22023';
    end if;
    insert into public.members (name, created_by, code_hash, code_expires_at)
    values (nm, auth.uid(), app_private.code_hash(c), until)
    returning * into rec;
  else
    update public.members m
       set code_hash = app_private.code_hash(c), code_expires_at = until
     where m.id = member_id
    returning * into rec;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;
  return json_build_object('id', rec.id, 'name', rec.name, 'code', c, 'expires_at', rec.code_expires_at);
end;
$$;

-- 명단에서 지우기 = 승인 취소. 그 휴대폰은 바로 볼 수 없게 됩니다.
create or replace function public.admin_remove_member(member_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.members m where m.id = member_id returning m.user_id into uid;
  if not found then
    return false;
  end if;
  if uid is not null then
    perform app_private.drop_guest(uid);
  end if;
  return true;
end;
$$;

-- 정리: 승인번호를 넣다 만 임시 계정(이틀 넘은 것)과 오래된 입력 기록을 지웁니다.
create or replace function public.admin_cleanup()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n integer := 0;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.redeem_attempts t where t.at < now() - interval '7 days';
  begin
    delete from auth.users u
     where u.is_anonymous is true
       and u.created_at < now() - interval '2 days'
       and not exists (select 1 from public.members m where m.user_id = u.id)
       and not exists (select 1 from public.app_admins a where a.user_id = u.id);
    get diagnostics n = row_count;
  exception when others then
    n := -1;
  end;
  return n;
end;
$$;

-- 8. 켜고 끄기 (SQL Editor 전용) ----------------------------------------
create or replace function app_private.set_members_only(turn_on boolean)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.app_settings (id, members_only, updated_at) values (1, turn_on, now())
  on conflict (id) do update set members_only = excluded.members_only, updated_at = now();
  return case when turn_on
    then '성도 승인을 켰습니다. 승인된 휴대폰과 관리자만 볼 수 있습니다.'
    else '성도 승인을 껐습니다. 승인 없이 누구나 볼 수 있습니다.' end;
end;
$$;

-- 9. 누가 어떤 함수를 부를 수 있는지 -------------------------------------
revoke all on function public.members_only() from public;
revoke all on function public.is_member() from public;
revoke all on function public.can_read() from public;
revoke all on function public.gate_status() from public;
revoke all on function public.redeem_code(text) from public, anon;
revoke all on function public.admin_members() from public, anon;
revoke all on function public.admin_issue_code(text, uuid) from public, anon;
revoke all on function public.admin_remove_member(uuid) from public, anon;
revoke all on function public.admin_cleanup() from public, anon;
revoke all on function app_private.code_hash(text) from public, anon, authenticated;
revoke all on function app_private.new_code() from public, anon, authenticated;
revoke all on function app_private.drop_guest(uuid) from public, anon, authenticated;
revoke all on function app_private.set_members_only(boolean) from public, anon, authenticated;

grant execute on function public.members_only() to anon, authenticated, service_role;
grant execute on function public.is_member() to anon, authenticated, service_role;
grant execute on function public.can_read() to anon, authenticated, service_role;
grant execute on function public.gate_status() to anon, authenticated, service_role;
-- 아래는 휴대폰이 이름표를 받은 뒤(= authenticated)에만 부를 수 있습니다.
grant execute on function public.redeem_code(text) to authenticated, service_role;
grant execute on function public.admin_members() to authenticated, service_role;
grant execute on function public.admin_issue_code(text, uuid) to authenticated, service_role;
grant execute on function public.admin_remove_member(uuid) to authenticated, service_role;
grant execute on function public.admin_cleanup() to authenticated, service_role;

-- 10. 글 읽기 규칙 바꾸기: 누구나 → 승인된 휴대폰과 관리자 ----------------
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname = 'posts_read_gate') then
    create policy posts_read_gate on public.posts
      for select to anon, authenticated using ((select public.can_read()));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname = 'posts_read_all') then
    drop policy posts_read_all on public.posts;
  end if;
end;
$$;

-- 11. 주보 사진: 공개 주소를 닫고, 볼 수 있는 사람에게만 내어 줍니다 ------
update storage.buckets set public = false where id = 'post-images' and public is distinct from false;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'post_images_read_gate') then
    create policy post_images_read_gate on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'post-images' and (select public.can_read()));
  end if;
end;
$$;

-- 12. 앱이 새 함수를 바로 쓸 수 있도록 서버에 알림 --------------------------
notify pgrst, 'reload schema';

-- 13. 결과 확인 ---------------------------------------------------------
select
  case when public.members_only() then '켜짐 (승인된 휴대폰과 관리자만 볼 수 있음)'
       else '꺼짐 (누구나 볼 수 있음)' end as "성도 승인",
  (select count(*) from public.members) as "명단",
  (select count(*) from public.members m where m.user_id is not null) as "승인된 휴대폰",
  coalesce((select case when b.public then '공개' else '비공개' end from storage.buckets b where b.id = 'post-images'), '없음') as "주보 사진 보관함",
  coalesce(
    (select string_agg(u.email, ', ' order by u.email)
       from public.app_admins a join auth.users u on u.id = a.user_id),
    '없음 → 관리자 계정부터 만들어 주세요') as "관리자 계정";
