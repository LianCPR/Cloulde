-- ═══════════════════════════════════════════════════════════════════════
--  Cloudé — 0003: hàm bảo mật cho chia sẻ + hạn chế dò mật khẩu
--
--  Các hàm dưới đây là SECURITY DEFINER và CHỈ được cấp quyền cho `service_role`,
--  tức chỉ Edge Function `share` gọi được. Frontend (anon/authenticated) không
--  gọi trực tiếp, nên không thể dùng chúng để dò token hay mật khẩu.
--
--  Lý do dùng SECURITY DEFINER: bảng `album_shares` có RLS chỉ cho chủ sở hữu.
--  Khách xem liên kết không có phiên đăng nhập, nên việc xác minh phải diễn ra
--  ở tầng tin cậy (service role) sau khi Edge Function đã xác thực yêu cầu.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Bảng ghi nhận lượt thử mở liên kết (chống dò mật khẩu) ─────────────
create table if not exists public.share_access_attempts (
  id           bigserial primary key,
  token_hash   text not null,
  successful   boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists share_access_attempts_lookup_idx
  on public.share_access_attempts (token_hash, attempted_at desc);

-- RLS bật và KHÔNG có chính sách nào: chỉ service role (bỏ qua RLS) chạm được.
alter table public.share_access_attempts enable row level security;

-- ── Băm token (SHA-256 hex) ────────────────────────────────────────────
-- Token chia sẻ là chuỗi 256-bit ngẫu nhiên, nên SHA-256 là đủ; không cần
-- hàm băm chậm như bcrypt cho token (bcrypt chỉ dành cho mật khẩu do người
-- dùng tự đặt, vốn có entropy thấp).
create or replace function public.share_token_hash(p_token text)
returns text
language sql
immutable
security definer
set search_path = public, extensions
as $$
  select encode(digest(p_token, 'sha256'), 'hex');
$$;

-- ── Băm mật khẩu chia sẻ bằng bcrypt ───────────────────────────────────
create or replace function public.hash_share_password(p_password text)
returns text
language sql
security definer
set search_path = public, extensions
as $$
  select crypt(p_password, gen_salt('bf', 10));
$$;

-- ── Kiểm tra mật khẩu với hash đã lưu ──────────────────────────────────
create or replace function public.share_password_matches(
  p_share_id uuid,
  p_password text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  stored text;
begin
  select password_hash into stored
    from public.album_shares
   where id = p_share_id;

  if stored is null then
    return false;
  end if;

  -- crypt() so sánh với salt nhúng trong hash; NULL input → false.
  return stored = crypt(p_password, stored);
end;
$$;

-- ── Hạn chế số lần thử mật khẩu ────────────────────────────────────────
create or replace function public.share_attempt_allowed(
  p_token_hash text,
  p_limit integer default 10,
  p_window interval default interval '5 minutes'
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select count(*) < p_limit
    from public.share_access_attempts
   where token_hash = p_token_hash
     and successful = false
     and attempted_at > now() - p_window;
$$;

create or replace function public.record_share_attempt(
  p_token_hash text,
  p_successful boolean default false
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.share_access_attempts (token_hash, successful)
  values (p_token_hash, p_successful);
$$;

-- ── Dọn dẹp định kỳ (gọi thủ công hoặc bằng pg_cron) ───────────────────
create or replace function public.purge_share_attempts(p_older_than interval default interval '7 days')
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.share_access_attempts where attempted_at < now() - p_older_than;
$$;

-- ── Cấp quyền: CHỈ service role ────────────────────────────────────────
revoke all on function public.share_token_hash(text) from public, anon, authenticated;
revoke all on function public.hash_share_password(text) from public, anon, authenticated;
revoke all on function public.share_password_matches(uuid, text) from public, anon, authenticated;
revoke all on function public.share_attempt_allowed(text, integer, interval) from public, anon, authenticated;
revoke all on function public.record_share_attempt(text, boolean) from public, anon, authenticated;
revoke all on function public.purge_share_attempts(interval) from public, anon, authenticated;

grant execute on function public.share_token_hash(text) to service_role;
grant execute on function public.hash_share_password(text) to service_role;
grant execute on function public.share_password_matches(uuid, text) to service_role;
grant execute on function public.share_attempt_allowed(text, integer, interval) to service_role;
grant execute on function public.record_share_attempt(text, boolean) to service_role;
grant execute on function public.purge_share_attempts(interval) to service_role;

-- Khách xem liên kết cần đọc metadata album để hiển thị tên album trên trang
-- chia sẻ — việc này do Edge Function trả về, KHÔNG mở RLS cho anon.
comment on table public.album_shares is
  'Liên kết chia sẻ album. Chỉ lưu SHA-256 của token và bcrypt của mật khẩu.';
