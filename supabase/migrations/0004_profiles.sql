-- ═══════════════════════════════════════════════════════════════════════
--  Cloudé — 0004: hồ sơ người dùng (profiles)
--
--  Tách khỏi `auth.users` để có thể hiển thị tên chủ album cho khách xem liên
--  kết chia sẻ mà KHÔNG lộ email. Không có cột mật khẩu nào ở đây: xác thực do
--  Supabase Auth quản lý.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 60),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Tự tạo hồ sơ khi có người đăng ký, lấy tên hiển thị từ metadata của form.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Tạo hồ sơ cho những người dùng đã tồn tại trước khi chạy migration này.
insert into public.profiles (id, display_name)
select u.id, nullif(btrim(coalesce(u.raw_user_meta_data ->> 'display_name', '')), '')
  from auth.users u
on conflict (id) do nothing;
