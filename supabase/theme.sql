-- =====================================================================
-- 찬양하는교회 앱 · 서버 설정 (3단계: 화면 디자인)
--
-- 관리자가 앱의 "화면 디자인"에서 고른 디자인을 서버에 저장하고,
-- 모든 휴대폰이 그 디자인으로 보이게 합니다.
--
--   bright   밝은 화면   (처음 값)
--   warm     따뜻한 화면
--   classic  클래식 화면
--
-- 실행하기 전에
--   · 1단계 설정(setup.sql)을 이미 실행한 상태여야 합니다.
--     (2단계 성도 승인을 실행했는지와는 상관없습니다.)
--
-- 사용법: SQL Editor 에 이 내용 전체를 붙여 넣고 Run.
--         여러 번 실행해도 안전하고, 이미 고른 디자인은 바뀌지 않습니다.
--
-- 앱을 거치지 않고 바꾸기:  select app_private.set_theme('classic');
-- =====================================================================

-- 0. 1단계 설정이 되어 있는지 확인 ------------------------------------
do $$
begin
  if to_regclass('public.app_admins') is null or to_regprocedure('public.is_admin()') is null then
    raise exception '1단계 설정(setup.sql)을 먼저 실행해 주세요.';
  end if;
end;
$$;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- 1. 설정값: 지금 쓰는 화면 디자인 --------------------------------------
create table if not exists public.app_look (
  id         integer primary key default 1 check (id = 1),
  theme      text not null default 'bright' check (theme in ('bright', 'warm', 'classic')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.app_look enable row level security;
revoke all on public.app_look from anon, authenticated;
-- 처음 실행할 때만 "밝은 화면"으로 넣습니다. 나중에 다시 실행해도 고른 디자인은 그대로입니다.
insert into public.app_look (id, theme) values (1, 'bright') on conflict (id) do nothing;

-- 2. 지금 디자인 읽기 ----------------------------------------------------
--    승인받기 전의 첫 화면도 같은 디자인으로 보여야 하므로 누구나 읽을 수 있습니다.
create or replace function public.app_theme()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select l.theme from public.app_look l where l.id = 1;
$$;

-- 3. 관리자가 앱에서 바꾸기 ---------------------------------------------
create or replace function public.admin_set_theme(new_theme text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if new_theme is null or new_theme not in ('bright', 'warm', 'classic') then
    raise exception 'unknown theme' using errcode = '22023';
  end if;
  insert into public.app_look (id, theme, updated_at, updated_by) values (1, new_theme, now(), auth.uid())
  on conflict (id) do update set theme = excluded.theme, updated_at = now(), updated_by = excluded.updated_by;
  return new_theme;
end;
$$;

-- 4. SQL Editor 에서 직접 바꾸기 (SQL Editor 전용) ------------------------
create or replace function app_private.set_theme(new_theme text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new_theme is null or new_theme not in ('bright', 'warm', 'classic') then
    raise exception '고를 수 있는 값은 bright(밝은 화면), warm(따뜻한 화면), classic(클래식 화면) 입니다.';
  end if;
  insert into public.app_look (id, theme, updated_at, updated_by) values (1, new_theme, now(), null)
  on conflict (id) do update set theme = excluded.theme, updated_at = now(), updated_by = null;
  return case new_theme when 'bright' then '밝은 화면' when 'warm' then '따뜻한 화면' else '클래식 화면' end
    || '으로 바꿨습니다. 휴대폰에서는 앱을 다시 열면 바뀝니다.';
end;
$$;

-- 5. 누가 어떤 함수를 부를 수 있는지 -------------------------------------
revoke all on function public.app_theme() from public;
revoke all on function public.admin_set_theme(text) from public, anon;
revoke all on function app_private.set_theme(text) from public, anon, authenticated;

grant execute on function public.app_theme() to anon, authenticated, service_role;
grant execute on function public.admin_set_theme(text) to authenticated, service_role;

-- 6. 앱이 새 함수를 바로 쓸 수 있도록 서버에 알림 --------------------------
notify pgrst, 'reload schema';

-- 7. 결과 확인 ---------------------------------------------------------
select
  case public.app_theme() when 'bright' then '밝은 화면' when 'warm' then '따뜻한 화면' else '클래식 화면' end as "화면 디자인",
  coalesce(
    (select string_agg(u.email, ', ' order by u.email)
       from public.app_admins a join auth.users u on u.id = a.user_id),
    '없음 → 관리자 계정부터 만들어 주세요') as "관리자 계정";
