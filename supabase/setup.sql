-- =====================================================================
-- 찬양하는교회 앱 · 서버 설정 (1단계: 글 올리기 공유 + 관리자 + 주보 사진)
--
-- 사용법: Supabase 대시보드 → SQL Editor → 이 내용 전체를 붙여 넣고 Run
--   · 먼저 Authentication → Users 에서 관리자 계정을 만든 뒤 실행하세요.
--     처음 실행할 때 등록되어 있는(이메일 확인이 끝난) 계정이 관리자가 됩니다.
--   · 여러 번 실행해도 안전합니다. 이미 있는 것은 건너뜁니다.
--   · 맨 아래 결과 표에서 "관리자 계정"을 확인하세요.
-- =====================================================================

-- 0. 내부용 공간: 앱(인터넷)에서는 접근할 수 없고 SQL Editor 에서만 쓰는 곳
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- 1. 관리자 목록 ------------------------------------------------------
create table if not exists public.app_admins (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
-- 정책을 만들지 않으므로 앱에서는 이 표를 읽거나 고칠 수 없습니다.
revoke all on public.app_admins from anon, authenticated;

-- 2. "지금 로그인한 사람이 관리자인가?" ------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_admins a where a.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- 3. 관리자 추가·삭제 (SQL Editor 전용) -------------------------------
--    추가: select app_private.add_admin('이메일@example.com');
--    삭제: select app_private.remove_admin('이메일@example.com');
create or replace function app_private.add_admin(admin_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  select u.id into uid from auth.users u where lower(u.email) = lower(trim(admin_email)) limit 1;
  if uid is null then
    return '계정을 찾지 못했습니다: ' || admin_email || ' (Authentication → Users 에서 먼저 계정을 만드세요)';
  end if;
  insert into public.app_admins (user_id) values (uid) on conflict (user_id) do nothing;
  return '관리자로 등록했습니다: ' || admin_email;
end;
$$;

create or replace function app_private.remove_admin(admin_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.app_admins a
   using auth.users u
   where u.id = a.user_id and lower(u.email) = lower(trim(admin_email));
  get diagnostics n = row_count;
  if n = 0 then
    return '관리자 목록에 없는 이메일입니다: ' || admin_email;
  end if;
  return '관리자에서 제외했습니다: ' || admin_email;
end;
$$;
revoke all on function app_private.add_admin(text) from public, anon, authenticated;
revoke all on function app_private.remove_admin(text) from public, anon, authenticated;

-- 4. 글 (소식 · 주보 · 일정) ------------------------------------------
create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('news', 'bulletin', 'event')),
  title      text not null check (char_length(title) between 1 and 120),
  body       text not null default '' check (char_length(body) <= 8000),
  meta       text check (meta is null or char_length(meta) <= 80),      -- 일정의 날짜·시간 등
  images     jsonb not null default '[]'::jsonb
             check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 12),  -- 사진 파일 경로 목록
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null
);
create index if not exists posts_created_at_idx on public.posts (created_at desc);
alter table public.posts enable row level security;

-- 누가 이 표에 접근할 수 있는지 (권한) + 어떤 줄을 다룰 수 있는지 (정책)
grant select on public.posts to anon, authenticated;
grant insert, update, delete on public.posts to authenticated;
grant select, insert, update, delete on public.posts to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname = 'posts_read_all') then
    create policy posts_read_all on public.posts
      for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname = 'posts_insert_admin') then
    create policy posts_insert_admin on public.posts
      for insert to authenticated with check ((select public.is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname = 'posts_update_admin') then
    create policy posts_update_admin on public.posts
      for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname = 'posts_delete_admin') then
    create policy posts_delete_admin on public.posts
      for delete to authenticated using ((select public.is_admin()));
  end if;
end;
$$;

-- 5. 주보 사진 저장 공간 ----------------------------------------------
--    누구나 볼 수 있고(공개), 올리고 지우는 것은 관리자만 할 수 있습니다.
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'post_images_admin_select') then
    create policy post_images_admin_select on storage.objects
      for select to authenticated
      using (bucket_id = 'post-images' and (select public.is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'post_images_admin_insert') then
    create policy post_images_admin_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'post-images' and (select public.is_admin()) and lower(name) ~ '\.(jpg|jpeg|png|webp)$');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'post_images_admin_delete') then
    create policy post_images_admin_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'post-images' and (select public.is_admin()));
  end if;
end;
$$;

-- 6. 처음 한 번: 이미 만들어 둔 계정을 관리자로 등록 --------------------
--    관리자 목록이 비어 있을 때만 동작합니다.
insert into public.app_admins (user_id)
select u.id
  from auth.users u
 where u.email_confirmed_at is not null
   and not exists (select 1 from public.app_admins);

-- 7. 처음 한 번: 지금 앱에 들어 있는 글을 서버로 옮겨 두기 -----------------
--    글이 하나도 없을 때만 넣습니다. 필요 없으면 앱에서 관리자가 지울 수 있습니다.
insert into public.posts (kind, title, body, meta, created_at)
select v.kind, v.title, v.body, v.meta, v.created_at
  from (values
    ('news',  '찬양하는교회 앱이 준비되었습니다',
              E'예배 영상, 주보, 교회 소식, 예배 안내를 앱에서 보실 수 있습니다.\n홈 화면에 추가해 두시면 아이콘을 눌러 바로 열 수 있습니다.',
              null::text,               timestamptz '2026-11-17 09:00:00+09'),
    ('event', '성탄감사예배', '시간은 추후 안내드립니다.', '2026년 12월 25일 (금)', timestamptz '2026-11-17 09:01:00+09'),
    ('event', '송구영신예배', '시간은 추후 안내드립니다.', '2026년 12월 31일 (목)', timestamptz '2026-11-17 09:02:00+09')
  ) as v (kind, title, body, meta, created_at)
 where not exists (select 1 from public.posts);

-- 8. 결과 확인 --------------------------------------------------------
select
  (select count(*) from public.posts) as "글 개수",
  coalesce(
    (select string_agg(u.email, ', ' order by u.email)
       from public.app_admins a join auth.users u on u.id = a.user_id),
    '없음 → Authentication → Users 에서 계정을 만든 뒤 이 설정을 한 번 더 실행하세요'
  ) as "관리자 계정";
