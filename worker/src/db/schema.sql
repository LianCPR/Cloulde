-- ═══════════════════════════════════════════════════════════════════════════
--  Cloudé Archive — lược đồ D1 (CHỈ METADATA)
--
--  Không có một byte ảnh nào trong cơ sở dữ liệu này. Ảnh gốc nằm trong R2,
--  tham chiếu bằng `storage_key`. D1 phù hợp vì metadata một ảnh chỉ vài trăm
--  byte, trong khi nhị phân hàng trăm MB thì không.
--
--  KHÔNG có cột hạn mức, KHÔNG có cột "gói", KHÔNG có cột quota. Sức chứa do
--  nhà cung cấp quyết định, không do ứng dụng.
--
--  Giới hạn D1 cần nhớ (tài liệu Cloudflare): tối đa 10 GB mỗi database và
--  KHÔNG nâng được; tối đa 2 MB mỗi hàng. Với ~500 byte metadata mỗi ảnh,
--  10 GB tương đương khoảng 20 triệu ảnh. Đó là trần THẬT của phần metadata.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists albums (
  id             text primary key,
  owner_id       text not null,
  title          text not null,
  description    text,
  cover_photo_id text,
  photo_count    integer not null default 0,
  total_bytes    integer not null default 0,
  created_at     text not null,
  updated_at     text not null
);

create index if not exists albums_owner_updated_idx on albums (owner_id, updated_at desc, id desc);
create index if not exists albums_owner_title_idx   on albums (owner_id, title, id);

-- ── photos: bản ghi bất biến của một tệp gốc đã lưu ────────────────────────
create table if not exists photos (
  id                    text primary key,
  album_id              text not null references albums (id) on delete cascade,
  owner_id              text not null,
  original_filename     text not null,
  storage_key           text not null,
  thumbnail_key         text,
  mime_type             text not null,
  file_size             integer not null,
  -- Dung lượng ảnh thu nhỏ, để thống kê dung lượng phản ánh ĐÚNG cả phần phái sinh.
  thumbnail_bytes       integer not null default 0,
  width                 integer,
  height                integer,
  -- SHA-256 do client khai báo. Chỉ là "lời khai", chưa phải sự thật.
  claimed_checksum      text,
  -- Chỉ được đặt sau khi SERVER tự băm lại object và khớp.
  verified_checksum     text,
  verified_at           text,
  checksum_mismatch     integer not null default 0,
  etag                  text,
  upload_id             text,
  previewable           integer not null default 0,
  created_at            text not null
);

-- Không cho hai ảnh CÙNG NỘI DUNG nằm trong cùng một album (chống trùng thật).
create unique index if not exists photos_album_checksum_idx
  on photos (album_id, claimed_checksum)
  where claimed_checksum is not null;

create index if not exists photos_album_created_idx  on photos (album_id, created_at desc, id desc);
create index if not exists photos_album_filename_idx on photos (album_id, original_filename, id);
create index if not exists photos_owner_created_idx  on photos (owner_id, created_at desc);
create index if not exists photos_unverified_idx     on photos (owner_id, verified_at);

-- ── upload_sessions: trạng thái để resume sau khi mất kết nối ──────────────
create table if not exists upload_sessions (
  id                text primary key,
  owner_id          text not null,
  album_id          text not null,
  storage_key       text not null,
  original_filename text not null,
  mime_type         text not null,
  total_bytes       integer not null,
  part_size         integer not null,
  part_count        integer not null,
  r2_upload_id      text not null,
  claimed_checksum  text,
  width             integer,
  height            integer,
  previewable       integer not null default 0,
  -- 'active' | 'completed' | 'aborted' | 'failed'
  status            text not null,
  attempts          integer not null default 0,
  last_error        text,
  created_at        text not null,
  updated_at        text not null,
  expires_at        text not null
);

create index if not exists upload_sessions_owner_status_idx
  on upload_sessions (owner_id, status, updated_at desc);
create index if not exists upload_sessions_album_idx on upload_sessions (album_id, status);
create index if not exists upload_sessions_expiry_idx on upload_sessions (status, expires_at);

-- Mỗi phần đã ghi thành công. Đây là thứ cho phép resume thật sự: client hỏi
-- server "đã có phần nào rồi" thay vì phải nhớ trong trình duyệt.
create table if not exists upload_parts (
  session_id  text not null references upload_sessions (id) on delete cascade,
  part_number integer not null,
  byte_size   integer not null,
  etag        text not null,
  uploaded_at text not null,
  primary key (session_id, part_number)
);

-- ── Chia sẻ: token chỉ lưu dạng băm ────────────────────────────────────────
create table if not exists album_shares (
  id               text primary key,
  album_id         text not null references albums (id) on delete cascade,
  owner_id         text not null,
  token_hash       text not null unique,
  password_hash    text,
  password_salt    text,
  password_iter    integer,
  allow_download   integer not null default 1,
  expires_at       text,
  revoked_at       text,
  access_count     integer not null default 0,
  last_accessed_at text,
  created_at       text not null
);

create index if not exists album_shares_album_idx on album_shares (album_id, created_at desc);

create table if not exists share_attempts (
  id           integer primary key autoincrement,
  token_hash   text not null,
  successful   integer not null,
  attempted_at text not null
);
create index if not exists share_attempts_idx on share_attempts (token_hash, attempted_at desc);

-- ── Hàng đợi công việc nền ─────────────────────────────────────────────────
create table if not exists jobs (
  id         integer primary key autoincrement,
  kind       text not null,
  photo_id   text,
  album_id   text,
  status     text not null,
  attempts   integer not null default 0,
  last_error text,
  created_at text not null,
  updated_at text not null
);
create index if not exists jobs_pending_idx on jobs (status, created_at);

-- ── Thống kê thao tác theo tháng (để ước tính chi phí trung thực) ──────────
-- Đếm thao tác THẬT đã thực hiện, không phải con số ước lượng.
create table if not exists stats_monthly (
  month         text not null,
  owner_id      text not null,
  class_a       integer not null default 0,
  class_b       integer not null default 0,
  bytes_written integer not null default 0,
  bytes_read    integer not null default 0,
  primary key (month, owner_id)
);
