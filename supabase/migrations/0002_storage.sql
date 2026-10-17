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
