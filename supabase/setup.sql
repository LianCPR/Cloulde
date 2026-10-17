-- ═══════════════════════════════════════════════════════════════════════
--  Cloudé — TỆP SINH TỰ ĐỘNG, KHÔNG SỬA TAY
--  Bản gộp của toàn bộ migration, dùng để dựng lược đồ chỉ bằng SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════
--
--  Cách dùng (Dashboard, không cần cài CLI):
--    1. Tạo project Supabase mới.
--    2. Mở SQL Editor → New query.
--    3. Dán TOÀN BỘ tệp này rồi bấm Run.
--
--  Cách dùng (CLI, khuyến nghị cho công việc lặp lại):
--    npm run supabase:link -- --project-ref <project-ref>
--    npm run supabase:push
--
--  Đặc điểm:
--    • Bao trong MỘT transaction: sai ở đâu thì huỷ hết, không để lại trạng
--      thái dở dang.
--    • MỌI câu lệnh đều idempotent (if not exists / or replace / drop policy
--      if exists), nên chạy lại nhiều lần vẫn an toàn.
--    • KHÔNG nạp dữ liệu mẫu — supabase/seed.sql là tệp mẫu đã chú thích sẵn,
--      chỉ dành cho môi trường phát triển.
--
--  Sinh lại tệp này:  npm run supabase:setup-sql
--  Kiểm tra lệch:     npm run supabase:setup-sql -- --check
--
--  Nguồn (theo đúng thứ tự đã gộp):
--   0001_init.sql      sha256:52c82d32d4ac95294ff40b2b3ab772b54e7bbcfe25e0b1d5fa56196c33e4d99e
--   0002_storage.sql   sha256:cc1c4062870c6626e561af2d1d96e605629426bcb3fc9be255a2afa905f30218
--   0003_share.sql     sha256:f961012beeb51a16c68b0e15383507817fabba98aa2a0f8795c9684f606b11a7
--   0004_profiles.sql  sha256:ac00b8422efa764842734001bd4db7d780d572adc2a4fcbdd29ce1e17d9a3de2
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ═══════════════════════════════════════════════════════════════════════
--  ▶ 0001_init.sql
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  Cloudé — 0001: lược đồ lõi (albums, photos, album_shares) + RLS
--
--  Nguyên tắc thiết kế cho kho ảnh lớn (hàng chục nghìn → hàng trăm nghìn ảnh):
--   • PostgreSQL CHỈ lưu metadata. Không có cột nào chứa nhị phân ảnh.
--   • Ảnh gốc nằm trong object storage, tham chiếu bằng `storage_path`.
--   • Mọi truy vấn nóng đều có index phù hợp với phân trang theo con trỏ (keyset).
--   • `photo_count` / `total_bytes` được duy trì bằng trigger O(1) để lưới album
--     không phải chạy COUNT(*) cho từng album (tránh N+1 và full scan).
--   • RLS bật trên mọi bảng: người dùng chỉ chạm được dữ liệu của chính mình.
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;   -- gen_random_uuid, crypt/gen_salt (bcrypt), digest
create extension if not exists pg_trgm;    -- tìm kiếm album theo tên có index GIN

-- ── albums ─────────────────────────────────────────────────────────────
create table if not exists public.albums (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users (id) on delete cascade,
  title          text not null check (char_length(btrim(title)) between 1 and 120),
  description    text check (description is null or char_length(description) <= 2000),
  cover_photo_id uuid,
  photo_count    integer not null default 0 check (photo_count >= 0),
  total_bytes    bigint  not null default 0 check (total_bytes >= 0),
  -- Khoá tìm kiếm đã chuẩn hoá (bỏ dấu, chữ thường) để tìm không phân biệt dấu.
  search_key     text not null default '',
  title_key      text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── photos ─────────────────────────────────────────────────────────────
create table if not exists public.photos (
  id                uuid primary key default gen_random_uuid(),
  album_id          uuid not null references public.albums (id) on delete cascade,
  owner_id          uuid not null references auth.users (id) on delete cascade,
  -- Tên tệp gốc, hiển thị và dùng khi tải xuống. Hỗ trợ Unicode/tiếng Việt.
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  -- Đường dẫn object ảnh gốc. Không bao giờ chứa '..' hay bắt đầu bằng '/'.
  storage_path      text not null unique
    check (storage_path <> '' and storage_path !~ '\.\.' and storage_path !~ '^/'),
  thumbnail_path    text unique,
  mime_type         text not null check (char_length(mime_type) between 3 and 120),
  file_size         bigint not null check (file_size > 0),
  width             integer check (width is null or width > 0),
  height            integer check (height is null or height > 0),
  checksum          text check (checksum is null or checksum ~ '^[0-9a-f]{64}$'),
  previewable       boolean not null default true,
  filename_key      text not null default '',
  created_at        timestamptz not null default now()
);

-- Ảnh bìa tham chiếu tới photos; xoá ảnh bìa thì album về trạng thái không bìa
-- (trigger bên dưới sẽ tự gán ảnh mới nhất làm bìa).
alter table public.albums
  drop constraint if exists albums_cover_photo_fk;
alter table public.albums
  add constraint albums_cover_photo_fk
  foreign key (cover_photo_id) references public.photos (id) on delete set null;

-- ── album_shares ───────────────────────────────────────────────────────
-- Token chia sẻ KHÔNG bao giờ được lưu ở dạng thô: chỉ lưu SHA-256.
-- Mật khẩu lưu dưới dạng bcrypt (pgcrypto). Việc xác minh diễn ra ở server.
create table if not exists public.album_shares (
  id              uuid primary key default gen_random_uuid(),
  album_id        uuid not null references public.albums (id) on delete cascade,
  owner_id        uuid not null references auth.users (id) on delete cascade,
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  password_hash   text,
  allow_download  boolean not null default true,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  access_count    integer not null default 0 check (access_count >= 0),
  last_accessed_at timestamptz,
  created_at      timestamptz not null default now()
);

-- ── Index cho các truy vấn nóng ────────────────────────────────────────

-- Lưới album: sắp xếp mới nhất/cũ nhất và phân trang bằng con trỏ (created_at, id).
create index if not exists albums_owner_created_idx
  on public.albums (owner_id, created_at desc, id desc);
create index if not exists albums_owner_created_asc_idx
  on public.albums (owner_id, created_at asc, id asc);
-- Sắp xếp theo tên.
create index if not exists albums_owner_title_idx
  on public.albums (owner_id, title_key, id);
-- Tìm kiếm album theo tên/mô tả (index GIN trigram cho ILIKE '%...%').
create index if not exists albums_search_trgm_idx
  on public.albums using gin (search_key gin_trgm_ops);
-- Album gần đây (thanh bên, trang cài đặt).
create index if not exists albums_owner_updated_idx
  on public.albums (owner_id, updated_at desc);

-- Lưới ảnh: mới nhất trước / cũ nhất trước / theo tên tệp, đều kèm id để
-- phân trang ổn định khi nhiều ảnh có cùng mốc thời gian.
create index if not exists photos_album_created_desc_idx
  on public.photos (album_id, created_at desc, id desc);
create index if not exists photos_album_created_asc_idx
  on public.photos (album_id, created_at asc, id asc);
create index if not exists photos_album_filename_idx
  on public.photos (album_id, filename_key, id);
-- Phát hiện ảnh trùng nội dung trong một album.
create index if not exists photos_album_checksum_idx
  on public.photos (album_id, checksum) where checksum is not null;
-- Tính dung lượng và liệt kê ảnh theo chủ sở hữu.
create index if not exists photos_owner_idx
  on public.photos (owner_id);
-- Liệt kê toàn bộ ảnh của album theo thứ tự ổn định (dùng khi tải cả album).
create index if not exists photos_album_idx
  on public.photos (album_id);

create index if not exists album_shares_album_idx
  on public.album_shares (album_id);
create index if not exists album_shares_owner_idx
  on public.album_shares (owner_id);

-- ── Trigger: cập nhật `updated_at` ─────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists albums_touch_updated_at on public.albums;
create trigger albums_touch_updated_at
  before update on public.albums
  for each row execute function public.touch_updated_at();

-- ── Trigger: duy trì số ảnh, tổng dung lượng, ảnh bìa (O(1), không COUNT(*)) ──
create or replace function public.on_photo_inserted()
returns trigger
language plpgsql
as $$
begin
  update public.albums
     set photo_count = photo_count + 1,
         total_bytes = total_bytes + new.file_size,
         -- Album chưa có bìa thì ảnh đầu tiên trở thành bìa. Trigger chạy theo
         -- từng dòng nên kết quả luôn xác định, không phụ thuộc thứ tự tải lên
         -- song song. Nếu ảnh đầu tiên không xem trước được (RAW/TIFF), người
         -- dùng vẫn có thể chọn ảnh bìa khác trong hộp thoại chỉnh sửa album.
         cover_photo_id = coalesce(cover_photo_id, new.id),
         updated_at = now()
   where id = new.album_id;
  return null;
end;
$$;

create or replace function public.on_photo_deleted()
returns trigger
language plpgsql
as $$
begin
  update public.albums a
     set photo_count = greatest(0, a.photo_count - 1),
         total_bytes = greatest(0, a.total_bytes - old.file_size),
         -- Nếu xoá đúng ảnh bìa, chọn ảnh mới nhất CÒN XEM TRƯỚC ĐƯỢC làm bìa
         -- (RAW/TIFF không hiển thị được trong trình duyệt), nếu không có thì
         -- lấy ảnh mới nhất bất kỳ.
         cover_photo_id = case
           when a.cover_photo_id = old.id then (
             select p.id from public.photos p
              where p.album_id = old.album_id
              order by p.previewable desc, p.created_at desc, p.id desc
              limit 1
           )
           else a.cover_photo_id
         end,
         updated_at = now()
   where a.id = old.album_id;
  return null;
end;
$$;

drop trigger if exists photos_after_insert on public.photos;
create trigger photos_after_insert
  after insert on public.photos
  for each row execute function public.on_photo_inserted();

drop trigger if exists photos_after_delete on public.photos;
create trigger photos_after_delete
  after delete on public.photos
  for each row execute function public.on_photo_deleted();

-- ── Hàm sửa chữa số liệu (dùng khi cần đối soát thủ công) ─────────────
create or replace function public.recompute_album_totals(p_album_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.albums a
     set photo_count = s.cnt,
         total_bytes = s.bytes,
         cover_photo_id = coalesce(
           a.cover_photo_id,
           (select p.id from public.photos p
             where p.album_id = p_album_id
             order by p.previewable desc, p.created_at desc, p.id desc limit 1)
         )
    from (
      select count(*)::int as cnt, coalesce(sum(file_size), 0)::bigint as bytes
        from public.photos where album_id = p_album_id
    ) s
   where a.id = p_album_id and a.owner_id = auth.uid();
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Row Level Security
-- ═══════════════════════════════════════════════════════════════════════

alter table public.albums       enable row level security;
alter table public.photos       enable row level security;
alter table public.album_shares enable row level security;

-- albums: chỉ chủ sở hữu.
drop policy if exists albums_select_own on public.albums;
create policy albums_select_own on public.albums
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists albums_insert_own on public.albums;
create policy albums_insert_own on public.albums
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists albums_update_own on public.albums;
create policy albums_update_own on public.albums
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists albums_delete_own on public.albums;
create policy albums_delete_own on public.albums
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- photos: chỉ chủ sở hữu; và album đích cũng phải thuộc về họ.
drop policy if exists photos_select_own on public.photos;
create policy photos_select_own on public.photos
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists photos_insert_own on public.photos;
create policy photos_insert_own on public.photos
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.albums a
       where a.id = album_id and a.owner_id = (select auth.uid())
    )
  );

drop policy if exists photos_update_own on public.photos;
create policy photos_update_own on public.photos
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists photos_delete_own on public.photos;
create policy photos_delete_own on public.photos
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- album_shares: chỉ chủ sở hữu đọc/ghi.
-- Khách truy cập liên kết KHÔNG đọc trực tiếp bảng này: mọi thao tác của khách
-- đi qua Edge Function có service role, nơi token và mật khẩu được xác minh.
drop policy if exists album_shares_select_own on public.album_shares;
create policy album_shares_select_own on public.album_shares
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists album_shares_insert_own on public.album_shares;
create policy album_shares_insert_own on public.album_shares
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.albums a
       where a.id = album_id and a.owner_id = (select auth.uid())
    )
  );

drop policy if exists album_shares_update_own on public.album_shares;
create policy album_shares_update_own on public.album_shares
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists album_shares_delete_own on public.album_shares;
create policy album_shares_delete_own on public.album_shares
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════
--  ▶ 0002_storage.sql
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  Cloudé — 0002: kho lưu trữ object (bucket + chính sách + thống kê)
--
--  Tách rõ ba không gian lưu trữ:
--    1. photo-originals   — ẢNH GỐC, bất biến, KHÔNG bao giờ bị ghi lại/nén lại.
--    2. photo-thumbnails  — ảnh thu nhỏ cho lưới thư viện; xoá được và tạo lại.
--    3. photo-archives    — gói ZIP tạm cho tải hàng loạt (tự hết hạn).
--
--  Tất cả đều là bucket RIÊNG TƯ. Không có bucket công khai nào cho ảnh người
--  dùng, và không có chính sách cho vai trò `anon`: khách xem liên kết chia sẻ
--  chỉ nhận signed URL ngắn hạn do Edge Function cấp sau khi đã xác minh token.
--
--  Quy ước đường dẫn (tiền tố thư mục đầu = auth.uid()):
--    <owner_id>/<album_id>/<timestamp>-<slug>-<random>.<ext>        (ảnh gốc)
--    <owner_id>/<album_id>/<timestamp>-<slug>-<random>.thumb.webp   (ảnh thu nhỏ)
--  Nhờ tiền tố này, chính sách Storage chỉ cần so khớp thư mục đầu tiên.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Tạo bucket ─────────────────────────────────────────────────────────
-- file_size_limit: 50MB = mức mặc định của gói Supabase Free.
--   Gói Pro/Team có thể nâng lên tới 500GB bằng cách sửa lại giá trị này
--   (Dashboard → Storage → Settings, hoặc chạy UPDATE bên dưới).
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('photo-originals',  'photo-originals',  false, 52428800),
  ('photo-thumbnails', 'photo-thumbnails', false, 5242880),
  ('photo-archives',   'photo-archives',   false, 5368709120)
on conflict (id) do nothing;

-- ── Chính sách cho ảnh GỐC ─────────────────────────────────────────────
-- Chủ sở hữu được đọc, ghi, sửa và xoá object trong thư mục mang uid của mình.
-- Không có quyền ghi đè (upsert) cho người khác, không có quyền đọc của anon.

drop policy if exists "originals: owner can read" on storage.objects;
create policy "originals: owner can read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photo-originals'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "originals: owner can upload" on storage.objects;
create policy "originals: owner can upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photo-originals'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "originals: owner can update" on storage.objects;
create policy "originals: owner can update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'photo-originals'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'photo-originals'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "originals: owner can delete" on storage.objects;
create policy "originals: owner can delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'photo-originals'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- ── Chính sách cho ẢNH THU NHỎ ─────────────────────────────────────────
drop policy if exists "thumbnails: owner can read" on storage.objects;
create policy "thumbnails: owner can read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photo-thumbnails'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "thumbnails: owner can upload" on storage.objects;
create policy "thumbnails: owner can upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photo-thumbnails'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "thumbnails: owner can update" on storage.objects;
create policy "thumbnails: owner can update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'photo-thumbnails'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'photo-thumbnails'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "thumbnails: owner can delete" on storage.objects;
create policy "thumbnails: owner can delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'photo-thumbnails'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- ── Bucket lưu gói ZIP tạm ─────────────────────────────────────────────
-- Chỉ Edge Function (service role) đọc/ghi bucket này. Không có chính sách
-- cho `authenticated` hay `anon`, nghĩa là không ai truy cập trực tiếp được.
-- Gợi ý vận hành: bật lifecycle rule để tự xoá tệp cũ trong photo-archives.

-- ── Thống kê dung lượng cho trang Cài đặt ──────────────────────────────
-- SECURITY INVOKER: RLS vẫn áp dụng, nên hàm chỉ thấy dữ liệu của chính mình.
create or replace function public.storage_usage()
returns table (used_bytes bigint, photo_count bigint, album_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce((select sum(p.file_size) from public.photos p where p.owner_id = (select auth.uid())), 0)::bigint,
    coalesce((select count(*)         from public.photos p where p.owner_id = (select auth.uid())), 0)::bigint,
    coalesce((select count(*)         from public.albums a where a.owner_id = (select auth.uid())), 0)::bigint;
$$;

revoke all on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  ▶ 0003_share.sql
-- ═══════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════
--  ▶ 0004_profiles.sql
-- ═══════════════════════════════════════════════════════════════════════

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

commit;
