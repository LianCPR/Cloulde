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
