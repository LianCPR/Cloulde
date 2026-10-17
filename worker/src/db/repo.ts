/**
 * Truy vấn D1 — toàn bộ tầng dữ liệu.
 *
 * Chỉ metadata. Không có nhị phân ảnh ở bất kỳ đâu trong tệp này.
 *
 * Phân trang theo KEYSET: mỗi trang đọc thẳng vào index thay vì quét rồi bỏ qua
 * N hàng như OFFSET. Đây là điều kiện để lưới ảnh còn nhanh ở ảnh thứ 10.000.
 */

import type { Cursor } from "../lib/http";

export interface AlbumRow {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  cover_photo_id: string | null;
  photo_count: number;
  total_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface PhotoRow {
  id: string;
  album_id: string;
  owner_id: string;
  original_filename: string;
  storage_key: string;
  thumbnail_key: string | null;
  mime_type: string;
  file_size: number;
  thumbnail_bytes: number;
  width: number | null;
  height: number | null;
  claimed_checksum: string | null;
  verified_checksum: string | null;
  verified_at: string | null;
  checksum_mismatch: number;
  etag: string | null;
  upload_id: string | null;
  previewable: number;
  created_at: string;
}

export interface UploadSessionRow {
  id: string;
  owner_id: string;
  album_id: string;
  storage_key: string;
  original_filename: string;
  mime_type: string;
  total_bytes: number;
  part_size: number;
  part_count: number;
  r2_upload_id: string;
  claimed_checksum: string | null;
  width: number | null;
  height: number | null;
  previewable: number;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface UploadPartRow {
  session_id: string;
  part_number: number;
  byte_size: number;
  etag: string;
  uploaded_at: string;
}

export interface ShareRow {
  id: string;
  album_id: string;
  owner_id: string;
  token_hash: string;
  password_hash: string | null;
  password_salt: string | null;
  password_iter: number | null;
  allow_download: number;
  expires_at: string | null;
  revoked_at: string | null;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/* ── Albums ───────────────────────────────────────────────────────────── */

export async function listAlbums(
  db: D1Database,
  ownerId: string,
  options: { search?: string; sort: "newest" | "oldest" | "title"; cursor: Cursor | null; limit: number },
): Promise<AlbumRow[]> {
  const clauses = ["owner_id = ?"];
  const params: unknown[] = [ownerId];
  if (options.search) {
    clauses.push("lower(title) like ?");
    params.push(`%${options.search.toLowerCase()}%`);
  }

  const ascending = options.sort === "oldest";
  const orderColumn = options.sort === "title" ? "title" : "updated_at";
  if (options.cursor) {
    const operator = ascending || options.sort === "title" ? ">" : "<";
    clauses.push(`(${orderColumn} ${operator} ? or (${orderColumn} = ? and id ${operator} ?))`);
    params.push(options.cursor.key, options.cursor.key, options.cursor.id);
  }

  const sql = `select * from albums where ${clauses.join(" and ")} order by ${orderColumn} ${
    ascending || options.sort === "title" ? "asc" : "desc"
  }, id ${ascending || options.sort === "title" ? "asc" : "desc"} limit ?`;
  params.push(options.limit + 1);

  const result = await db.prepare(sql).bind(...params).all<AlbumRow>();
  return result.results ?? [];
}

export async function getAlbum(db: D1Database, albumId: string, ownerId: string): Promise<AlbumRow | null> {
  return db
    .prepare("select * from albums where id = ? and owner_id = ?")
    .bind(albumId, ownerId)
    .first<AlbumRow>();
}

export async function insertAlbum(
  db: D1Database,
  album: AlbumRow,
): Promise<void> {
  await db
    .prepare(
      `insert into albums (id, owner_id, title, description, cover_photo_id, photo_count, total_bytes, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      album.id,
      album.owner_id,
      album.title,
      album.description,
      album.cover_photo_id,
      album.photo_count,
      album.total_bytes,
      album.created_at,
      album.updated_at,
    )
    .run();
}

export async function updateAlbum(
  db: D1Database,
  albumId: string,
  ownerId: string,
  patch: { title?: string; description?: string | null; coverPhotoId?: string | null },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    params.push(patch.title);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    params.push(patch.description);
  }
  if (patch.coverPhotoId !== undefined) {
    sets.push("cover_photo_id = ?");
    params.push(patch.coverPhotoId);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  params.push(nowIso(), albumId, ownerId);
  await db
    .prepare(`update albums set ${sets.join(", ")} where id = ? and owner_id = ?`)
    .bind(...params)
    .run();
}

export async function deleteAlbum(db: D1Database, albumId: string, ownerId: string): Promise<void> {
  await db.batch([
    db.prepare("delete from photos where album_id = ? and owner_id = ?").bind(albumId, ownerId),
    db.prepare("delete from albums where id = ? and owner_id = ?").bind(albumId, ownerId),
  ]);
}

/**
 * Tính lại bộ đếm của album từ chính dữ liệu.
 *
 * Dùng bộ đếm thay vì COUNT(*) mỗi lần mở thư viện: COUNT(*) trên bảng hàng
 * chục nghìn hàng cho từng album sẽ là N+1 truy vấn đắt đỏ.
 */
export async function recomputeAlbumCounters(db: D1Database, albumId: string): Promise<void> {
  await db
    .prepare(
      `update albums set
         photo_count = (select count(*) from photos where album_id = ?),
         total_bytes = (select coalesce(sum(file_size), 0) from photos where album_id = ?),
         updated_at = ?
       where id = ?`,
    )
    .bind(albumId, albumId, nowIso(), albumId)
    .run();
}

/* ── Photos ───────────────────────────────────────────────────────────── */

export async function listPhotos(
  db: D1Database,
  albumId: string,
  options: { sort: "uploaded-desc" | "uploaded-asc" | "filename-asc"; cursor: Cursor | null; limit: number },
): Promise<PhotoRow[]> {
  const ascending = options.sort !== "uploaded-desc";
  const orderColumn = options.sort === "filename-asc" ? "original_filename" : "created_at";
  const direction = ascending ? "asc" : "desc";
  const operator = ascending ? ">" : "<";

  const clauses = ["album_id = ?"];
  const params: unknown[] = [albumId];
  if (options.cursor) {
    clauses.push(`(${orderColumn} ${operator} ? or (${orderColumn} = ? and id ${operator} ?))`);
    params.push(options.cursor.key, options.cursor.key, options.cursor.id);
  }

  params.push(options.limit + 1);
  const result = await db
    .prepare(
      `select * from photos where ${clauses.join(" and ")}
       order by ${orderColumn} ${direction}, id ${direction} limit ?`,
    )
    .bind(...params)
    .all<PhotoRow>();
  return result.results ?? [];
}

export async function getPhoto(
  db: D1Database,
  photoId: string,
  ownerId?: string,
): Promise<PhotoRow | null> {
  if (ownerId) {
    return db
      .prepare("select * from photos where id = ? and owner_id = ?")
      .bind(photoId, ownerId)
      .first<PhotoRow>();
  }
  return db.prepare("select * from photos where id = ?").bind(photoId).first<PhotoRow>();
}

/** Kiểm tra ảnh trùng nội dung TRƯỚC khi tải lên, để không truyền lại 500 MB. */
export async function findByChecksum(
  db: D1Database,
  albumId: string,
  checksum: string,
): Promise<PhotoRow | null> {
  return db
    .prepare("select * from photos where album_id = ? and claimed_checksum = ? limit 1")
    .bind(albumId, checksum)
    .first<PhotoRow>();
}

export async function insertPhoto(db: D1Database, photo: PhotoRow): Promise<void> {
  await db
    .prepare(
      `insert into photos (
         id, album_id, owner_id, original_filename, storage_key, thumbnail_key, mime_type,
         file_size, thumbnail_bytes, width, height, claimed_checksum, verified_checksum, verified_at,
         checksum_mismatch, etag, upload_id, previewable, created_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      photo.id,
      photo.album_id,
      photo.owner_id,
      photo.original_filename,
      photo.storage_key,
      photo.thumbnail_key,
      photo.mime_type,
      photo.file_size,
      photo.thumbnail_bytes,
      photo.width,
      photo.height,
      photo.claimed_checksum,
      photo.verified_checksum,
      photo.verified_at,
      photo.checksum_mismatch,
      photo.etag,
      photo.upload_id,
      photo.previewable,
      photo.created_at,
    )
    .run();
}

export async function markVerified(
  db: D1Database,
  photoId: string,
  result: { verified: string | null; mismatch: boolean },
): Promise<void> {
  await db
    .prepare("update photos set verified_checksum = ?, verified_at = ?, checksum_mismatch = ? where id = ?")
    .bind(result.verified, nowIso(), result.mismatch ? 1 : 0, photoId)
    .run();
}

export async function setThumbnail(
  db: D1Database,
  photoId: string,
  thumbnailKey: string | null,
  thumbnailBytes: number,
): Promise<void> {
  await db
    .prepare("update photos set thumbnail_key = ?, thumbnail_bytes = ? where id = ?")
    .bind(thumbnailKey, thumbnailBytes, photoId)
    .run();
}

export async function deletePhotos(
  db: D1Database,
  photoIds: string[],
  ownerId: string,
): Promise<PhotoRow[]> {
  if (photoIds.length === 0) return [];
  const placeholders = photoIds.map(() => "?").join(",");
  const rows = await db
    .prepare(`select * from photos where id in (${placeholders}) and owner_id = ?`)
    .bind(...photoIds, ownerId)
    .all<PhotoRow>();
  const found = rows.results ?? [];
  if (found.length > 0) {
    const ids = found.map((row) => row.id);
    const idPlaceholders = ids.map(() => "?").join(",");
    await db
      .prepare(`delete from photos where id in (${idPlaceholders}) and owner_id = ?`)
      .bind(...ids, ownerId)
      .run();
  }
  return found;
}

/* ── Upload sessions ──────────────────────────────────────────────────── */

export async function insertSession(db: D1Database, session: UploadSessionRow): Promise<void> {
  await db
    .prepare(
      `insert into upload_sessions (
         id, owner_id, album_id, storage_key, original_filename, mime_type, total_bytes,
         part_size, part_count, r2_upload_id, claimed_checksum, width, height, previewable,
         status, attempts, last_error, created_at, updated_at, expires_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      session.id,
      session.owner_id,
      session.album_id,
      session.storage_key,
      session.original_filename,
      session.mime_type,
      session.total_bytes,
      session.part_size,
      session.part_count,
      session.r2_upload_id,
      session.claimed_checksum,
      session.width,
      session.height,
      session.previewable,
      session.status,
      session.attempts,
      session.last_error,
      session.created_at,
      session.updated_at,
      session.expires_at,
    )
    .run();
}

export async function getSession(
  db: D1Database,
  sessionId: string,
  ownerId: string,
): Promise<UploadSessionRow | null> {
  return db
    .prepare("select * from upload_sessions where id = ? and owner_id = ?")
    .bind(sessionId, ownerId)
    .first<UploadSessionRow>();
}

export async function listActiveSessions(db: D1Database, ownerId: string): Promise<UploadSessionRow[]> {
  const result = await db
    .prepare("select * from upload_sessions where owner_id = ? and status = 'active' order by updated_at desc")
    .bind(ownerId)
    .all<UploadSessionRow>();
  return result.results ?? [];
}

export async function updateSessionStatus(
  db: D1Database,
  sessionId: string,
  status: string,
  lastError: string | null = null,
): Promise<void> {
  await db
    .prepare(
      "update upload_sessions set status = ?, last_error = coalesce(?, last_error), updated_at = ?, attempts = attempts + 1 where id = ?",
    )
    .bind(status, lastError, nowIso(), sessionId)
    .run();
}

export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
  await db.batch([
    db.prepare("delete from upload_parts where session_id = ?").bind(sessionId),
    db.prepare("delete from upload_sessions where id = ?").bind(sessionId),
  ]);
}

/**
 * Ghi nhận một phần đã lên thành công.
 * `on conflict do update` khiến thao tác này LŨY ĐẲNG — thử lại một phần không
 * tạo bản ghi trùng, nên retry an toàn.
 */
export async function savePart(db: D1Database, part: UploadPartRow): Promise<void> {
  await db
    .prepare(
      `insert into upload_parts (session_id, part_number, byte_size, etag, uploaded_at)
       values (?, ?, ?, ?, ?)
       on conflict (session_id, part_number) do update set
         byte_size = excluded.byte_size, etag = excluded.etag, uploaded_at = excluded.uploaded_at`,
    )
    .bind(part.session_id, part.part_number, part.byte_size, part.etag, part.uploaded_at)
    .run();
}

export async function listParts(db: D1Database, sessionId: string): Promise<UploadPartRow[]> {
  const result = await db
    .prepare("select * from upload_parts where session_id = ? order by part_number")
    .bind(sessionId)
    .all<UploadPartRow>();
  return result.results ?? [];
}

export async function countParts(db: D1Database, sessionId: string): Promise<number> {
  const row = await db
    .prepare("select count(*) as n from upload_parts where session_id = ?")
    .bind(sessionId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function expireStaleSessions(db: D1Database, before: string): Promise<UploadSessionRow[]> {
  const result = await db
    .prepare("select * from upload_sessions where status = 'active' and expires_at < ? limit 100")
    .bind(before)
    .all<UploadSessionRow>();
  const rows = result.results ?? [];
  for (const row of rows) {
    await updateSessionStatus(db, row.id, "failed", "Phiên tải lên đã hết hạn và bị dọn dẹp.");
  }
  return rows;
}

/* ── Chia sẻ ──────────────────────────────────────────────────────────── */

export async function insertShare(db: D1Database, share: ShareRow): Promise<void> {
  await db
    .prepare(
      `insert into album_shares (
         id, album_id, owner_id, token_hash, password_hash, password_salt, password_iter,
         allow_download, expires_at, revoked_at, access_count, last_accessed_at, created_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      share.id,
      share.album_id,
      share.owner_id,
      share.token_hash,
      share.password_hash,
      share.password_salt,
      share.password_iter,
      share.allow_download,
      share.expires_at,
      share.revoked_at,
      share.access_count,
      share.last_accessed_at,
      share.created_at,
    )
    .run();
}

export async function listShares(db: D1Database, albumId: string, ownerId: string): Promise<ShareRow[]> {
  const result = await db
    .prepare("select * from album_shares where album_id = ? and owner_id = ? order by created_at desc")
    .bind(albumId, ownerId)
    .all<ShareRow>();
  return result.results ?? [];
}

export async function getShare(
  db: D1Database,
  shareId: string,
  ownerId: string,
): Promise<ShareRow | null> {
  return db
    .prepare("select * from album_shares where id = ? and owner_id = ?")
    .bind(shareId, ownerId)
    .first<ShareRow>();
}

export async function getShareByTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<ShareRow | null> {
  return db
    .prepare("select * from album_shares where token_hash = ?")
    .bind(tokenHash)
    .first<ShareRow>();
}

export async function updateShare(
  db: D1Database,
  shareId: string,
  ownerId: string,
  patch: {
    allowDownload?: boolean;
    password?: { hash: string | null; salt: string | null; iter: number | null };
    expiresAt?: string | null;
    revokedAt?: string | null;
  },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.allowDownload !== undefined) {
    sets.push("allow_download = ?");
    params.push(patch.allowDownload ? 1 : 0);
  }
  if (patch.password !== undefined) {
    sets.push("password_hash = ?", "password_salt = ?", "password_iter = ?");
    params.push(patch.password.hash, patch.password.salt, patch.password.iter);
  }
  if (patch.expiresAt !== undefined) {
    sets.push("expires_at = ?");
    params.push(patch.expiresAt);
  }
  if (patch.revokedAt !== undefined) {
    sets.push("revoked_at = ?");
    params.push(patch.revokedAt);
  }
  if (sets.length === 0) return;
  params.push(shareId, ownerId);
  await db
    .prepare(`update album_shares set ${sets.join(", ")} where id = ? and owner_id = ?`)
    .bind(...params)
    .run();
}

export async function touchShareAccess(db: D1Database, shareId: string): Promise<void> {
  await db
    .prepare(
      "update album_shares set access_count = access_count + 1, last_accessed_at = ? where id = ?",
    )
    .bind(nowIso(), shareId)
    .run();
}

export async function recordAttempt(
  db: D1Database,
  tokenHash: string,
  successful: boolean,
): Promise<void> {
  await db
    .prepare("insert into share_attempts (token_hash, successful, attempted_at) values (?, ?, ?)")
    .bind(tokenHash, successful ? 1 : 0, nowIso())
    .run();
}

export async function recentFailedAttempts(db: D1Database, tokenHash: string): Promise<number> {
  const row = await db
    .prepare(
      "select count(*) as n from share_attempts where token_hash = ? and successful = 0 and attempted_at > ?",
    )
    .bind(tokenHash, new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/* ── Thống kê & công việc nền ─────────────────────────────────────────── */

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export async function bumpStats(
  db: D1Database,
  ownerId: string,
  delta: { classA?: number; classB?: number; bytesWritten?: number; bytesRead?: number },
): Promise<void> {
  await db
    .prepare(
      `insert into stats_monthly (month, owner_id, class_a, class_b, bytes_written, bytes_read)
       values (?, ?, ?, ?, ?, ?)
       on conflict (month, owner_id) do update set
         class_a = class_a + excluded.class_a,
         class_b = class_b + excluded.class_b,
         bytes_written = bytes_written + excluded.bytes_written,
         bytes_read = bytes_read + excluded.bytes_read`,
    )
    .bind(
      currentMonth(),
      ownerId,
      delta.classA ?? 0,
      delta.classB ?? 0,
      delta.bytesWritten ?? 0,
      delta.bytesRead ?? 0,
    )
    .run();
}

export async function getStats(
  db: D1Database,
  ownerId: string,
): Promise<{ classA: number; classB: number; bytesWritten: number; bytesRead: number }> {
  const row = await db
    .prepare("select class_a, class_b, bytes_written, bytes_read from stats_monthly where month = ? and owner_id = ?")
    .bind(currentMonth(), ownerId)
    .first<{ class_a: number; class_b: number; bytes_written: number; bytes_read: number }>();
  return {
    classA: row?.class_a ?? 0,
    classB: row?.class_b ?? 0,
    bytesWritten: row?.bytes_written ?? 0,
    bytesRead: row?.bytes_read ?? 0,
  };
}

export async function getUsageTotals(
  db: D1Database,
  ownerId: string,
): Promise<{ originalBytes: number; thumbnailBytes: number; photoCount: number; albumCount: number }> {
  const photos = await db
    .prepare(
      "select coalesce(sum(file_size), 0) as bytes, coalesce(sum(thumbnail_bytes), 0) as thumb_bytes, count(*) as n from photos where owner_id = ?",
    )
    .bind(ownerId)
    .first<{ bytes: number; thumb_bytes: number; n: number }>();
  const albums = await db
    .prepare("select count(*) as n from albums where owner_id = ?")
    .bind(ownerId)
    .first<{ n: number }>();
  return {
    originalBytes: photos?.bytes ?? 0,
    thumbnailBytes: photos?.thumb_bytes ?? 0,
    photoCount: photos?.n ?? 0,
    albumCount: albums?.n ?? 0,
  };
}

export async function enqueueJob(
  db: D1Database,
  kind: string,
  refs: { photoId?: string; albumId?: string },
): Promise<void> {
  await db
    .prepare(
      "insert into jobs (kind, photo_id, album_id, status, attempts, created_at, updated_at) values (?, ?, ?, 'pending', 0, ?, ?)",
    )
    .bind(kind, refs.photoId ?? null, refs.albumId ?? null, nowIso(), nowIso())
    .run();
}

export async function pendingJobs(db: D1Database, limit = 10): Promise<
  { id: number; kind: string; photo_id: string | null; album_id: string | null }[]
> {
  const result = await db
    .prepare("select id, kind, photo_id, album_id from jobs where status = 'pending' order by created_at limit ?")
    .bind(limit)
    .all<{ id: number; kind: string; photo_id: string | null; album_id: string | null }>();
  return result.results ?? [];
}

/**
 * Việc đang chờ cho ĐÚNG những ảnh này (đã lọc theo chủ sở hữu).
 * Dùng cho nút "xác minh ngay" của một ảnh cụ thể: kết quả không phụ thuộc vào
 * việc hàng đợi có bao nhiêu việc cũ đang xếp trước hay không.
 */
export async function jobsForPhotos(
  db: D1Database,
  ownerId: string,
  photoIds: string[],
): Promise<{ id: number; kind: string; photo_id: string | null; album_id: string | null }[]> {
  if (photoIds.length === 0) return [];
  const placeholders = photoIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `select j.id, j.kind, j.photo_id, j.album_id
         from jobs j
         join photos p on p.id = j.photo_id
        where j.status = 'pending'
          and j.kind = 'verify_checksum'
          and p.owner_id = ?
          and j.photo_id in (${placeholders})
        order by j.created_at`,
    )
    .bind(ownerId, ...photoIds)
    .all<{ id: number; kind: string; photo_id: string | null; album_id: string | null }>();
  return result.results ?? [];
}

/** Số việc còn đang chờ — hiển thị trên dashboard để thấy hàng đợi đang rút. */
export async function countPendingJobs(db: D1Database): Promise<number> {
  const row = await db
    .prepare("select count(*) as total from jobs where status = 'pending'")
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function finishJob(
  db: D1Database,
  jobId: number,
  outcome: { ok: boolean; error?: string },
): Promise<void> {
  if (outcome.ok) {
    await db.prepare("delete from jobs where id = ?").bind(jobId).run();
    return;
  }
  await db
    .prepare(
      "update jobs set status = case when attempts >= 3 then 'failed' else 'pending' end, attempts = attempts + 1, last_error = ?, updated_at = ? where id = ?",
    )
    .bind(outcome.error ?? null, nowIso(), jobId)
    .run();
}
