/**
 * Album, ảnh, tải xuống, dung lượng và sức khoẻ hệ thống.
 *
 * Hai nguyên tắc xuyên suốt:
 *   • Ảnh gốc chỉ được ĐỌC và truyền đi nguyên byte. Không nén lại, không đổi
 *     kích thước, không sửa EXIF, không "tối ưu" để tiết kiệm tiền.
 *   • Không có hạn mức nào do ứng dụng đặt. `/usage` chỉ BÁO CÁO số liệu thật
 *     và CẢNH BÁO khi tới gần ngưỡng của gói nhà cung cấp.
 */

import type { Ctx } from "../context";
import { estimateCost, R2_MAX_PARTS, WORKER_MAX_REQUEST_BYTES } from "../config";
import {
  deleteAlbum,
  deletePhotos,
  getAlbum,
  getPhoto,
  getStats,
  getUsageTotals,
  insertAlbum,
  listAlbums,
  listPhotos,
  nowIso,
  recomputeAlbumCounters,
  updateAlbum,
} from "../db/repo";
import {
  HttpError,
  decodeCursor,
  encodeCursor,
  json,
  pageLimit,
  pickSort,
  readJson,
  requireString,
} from "../lib/http";
import { contentDisposition, newId } from "../lib/ids";
import { signTicket } from "../lib/tickets";
import { bumpStats, currentMonth } from "../db/repo";

/* ── Album ────────────────────────────────────────────────────────────── */

export async function listAlbumsRoute(ctx: Ctx): Promise<Response> {
  const limit = pageLimit(ctx.url.searchParams.get("limit"));
  const sort = pickSort(ctx.url.searchParams.get("sort"), ["newest", "oldest", "title"] as const, "newest");
  const rows = await listAlbums(ctx.env.DB, ctx.ownerId, {
    search: ctx.url.searchParams.get("search")?.trim() || undefined,
    sort,
    cursor: decodeCursor(ctx.url.searchParams.get("cursor")),
    limit,
  });
  const items = rows.slice(0, limit).map(albumDto);
  const last = items[items.length - 1];
  return json({
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor(sort === "title" ? last.title : last.updatedAt, last.id)
        : null,
  });
}

function albumDto(row: Awaited<ReturnType<typeof listAlbums>>[number]) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    description: row.description,
    coverPhotoId: row.cover_photo_id,
    photoCount: row.photo_count,
    totalBytes: row.total_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createAlbumRoute(ctx: Ctx): Promise<Response> {
  const body = await readJson<{ title?: string; description?: string | null }>(ctx.request);
  const title = requireString(body.title, "title", 120);
  const timestamp = nowIso();
  const album = {
    id: newId(),
    owner_id: ctx.ownerId,
    title,
    description: body.description ?? null,
    cover_photo_id: null,
    photo_count: 0,
    total_bytes: 0,
    created_at: timestamp,
    updated_at: timestamp,
  };
  await insertAlbum(ctx.env.DB, album);
  return json({ album: albumDto(album) }, { status: 201 });
}

export async function getAlbumRoute(ctx: Ctx, albumId: string): Promise<Response> {
  const album = await getAlbum(ctx.env.DB, albumId, ctx.ownerId);
  if (!album) throw new HttpError(404, "Không tìm thấy album.");
  return json({ album: albumDto(album) });
}

export async function updateAlbumRoute(ctx: Ctx, albumId: string): Promise<Response> {
  const album = await getAlbum(ctx.env.DB, albumId, ctx.ownerId);
  if (!album) throw new HttpError(404, "Không tìm thấy album.");
  const body = await readJson<{ title?: string; description?: string | null; coverPhotoId?: string | null }>(
    ctx.request,
  );
  await updateAlbum(ctx.env.DB, albumId, ctx.ownerId, {
    title: body.title === undefined ? undefined : requireString(body.title, "title", 120),
    description: body.description,
    coverPhotoId: body.coverPhotoId,
  });
  const updated = await getAlbum(ctx.env.DB, albumId, ctx.ownerId);
  return json({ album: updated ? albumDto(updated) : null });
}

export async function deleteAlbumRoute(ctx: Ctx, albumId: string): Promise<Response> {
  const album = await getAlbum(ctx.env.DB, albumId, ctx.ownerId);
  if (!album) throw new HttpError(404, "Không tìm thấy album.");
  const photos = await listPhotos(ctx.env.DB, albumId, { sort: "uploaded-desc", cursor: null, limit: 200 });
  await deleteAlbum(ctx.env.DB, albumId, ctx.ownerId);
  const keys = photos.map((photo) => photo.storage_key);
  if (keys.length > 0) await ctx.storage.originals.remove(keys);
  return json({ deletedPhotos: photos.length });
}

/* ── Ảnh ──────────────────────────────────────────────────────────────── */

function photoDto(row: Awaited<ReturnType<typeof listPhotos>>[number]) {
  return {
    id: row.id,
    albumId: row.album_id,
    ownerId: row.owner_id,
    originalFilename: row.original_filename,
    storageKey: row.storage_key,
    thumbnailKey: row.thumbnail_key,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    width: row.width,
    height: row.height,
    claimedChecksum: row.claimed_checksum,
    verifiedChecksum: row.verified_checksum,
    verifiedAt: row.verified_at,
    checksumMismatch: Boolean(row.checksum_mismatch),
    previewable: Boolean(row.previewable),
    createdAt: row.created_at,
  };
}

export async function listPhotosRoute(ctx: Ctx, albumId: string): Promise<Response> {
  const album = await getAlbum(ctx.env.DB, albumId, ctx.ownerId);
  if (!album) throw new HttpError(404, "Không tìm thấy album.");
  const limit = pageLimit(ctx.url.searchParams.get("limit"), 400, 400);
  const sort = pickSort(
    ctx.url.searchParams.get("sort"),
    ["uploaded-desc", "uploaded-asc", "filename-asc"] as const,
    "uploaded-desc",
  );
  const rows = await listPhotos(ctx.env.DB, albumId, {
    sort,
    cursor: decodeCursor(ctx.url.searchParams.get("cursor")),
    limit,
  });
  const items = rows.slice(0, limit).map(photoDto);
  const last = items[items.length - 1];
  return json({
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor(
            sort === "filename-asc" ? last.originalFilename : last.createdAt,
            last.id,
          )
        : null,
    total: album.photo_count,
  });
}

export async function getPhotoRoute(ctx: Ctx, photoId: string): Promise<Response> {
  const photo = await getPhoto(ctx.env.DB, photoId, ctx.ownerId);
  if (!photo) throw new HttpError(404, "Không tìm thấy ảnh.");
  return json({ photo: photoDto(photo) });
}

export async function deletePhotoRoute(ctx: Ctx, photoId: string): Promise<Response> {
  const removed = await deletePhotos(ctx.env.DB, [photoId], ctx.ownerId);
  if (removed.length === 0) throw new HttpError(404, "Không tìm thấy ảnh.");
  // Xoá cả object trên kho lưu trữ, không chỉ hàng metadata.
  await ctx.storage.originals.remove(removed.map((photo) => photo.storage_key));
  const thumbs = removed
    .map((photo) => photo.thumbnail_key)
    .filter((key): key is string => Boolean(key));
  if (thumbs.length > 0) await ctx.storage.thumbs.remove(thumbs);
  await recomputeAlbumCounters(ctx.env.DB, removed[0].album_id);
  return json({ deleted: removed.length });
}

/* ── Truyền ảnh gốc ───────────────────────────────────────────────────── */

function parseRange(header: string | null, size: number): { offset: number; length: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  let start = startRaw ? Number(startRaw) : 0;
  let end = endRaw ? Number(endRaw) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (!startRaw && endRaw) {
    // `bytes=-N`: N byte cuối cùng.
    start = Math.max(0, size - end);
    end = size - 1;
  }
  if (start > end || start >= size) return null;
  end = Math.min(end, size - 1);
  return { offset: start, length: end - start + 1 };
}

/**
 * Truyền ảnh GỐC nguyên byte.
 *
 * Hỗ trợ `Range` để trình duyệt và công cụ tải có thể nối tiếp một tệp 500 MB
 * khi mạng đứt — thiết kế này không chỉ cho upload mà cả download.
 */
export async function streamOriginal(
  ctx: Ctx,
  storageKey: string,
  filename: string,
  asAttachment = true,
): Promise<Response> {
  const head = await ctx.storage.originals.head(storageKey);
  if (!head) throw new HttpError(404, "Không tìm thấy tệp trong kho lưu trữ.");

  const range = parseRange(ctx.request.headers.get("range"), head.size);
  const object = await ctx.storage.originals.get(storageKey, range ?? undefined);
  if (!object) throw new HttpError(404, "Không đọc được tệp trong kho lưu trữ.");

  await bumpStats(ctx.env.DB, ctx.ownerId, { classB: 1, bytesRead: range?.length ?? head.size });

  const headers = new Headers({
    "content-type": head.contentType ?? "application/octet-stream",
    "content-disposition": contentDisposition(filename, !asAttachment),
    etag: head.etag,
    "accept-ranges": "bytes",
    // Ảnh gốc là bất biến (khoá chứa hậu tố ngẫu nhiên) nên cache được an toàn.
    // `private` để không proxy trung gian nào lưu lại.
    "cache-control": "private, max-age=3600",
  });

  if (range) {
    headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
    headers.set("content-length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(head.size));
  return new Response(object.body, { status: 200, headers });
}

export async function downloadOriginalRoute(ctx: Ctx, photoId: string): Promise<Response> {
  const photo = await getPhoto(ctx.env.DB, photoId, ctx.ownerId);
  if (!photo) throw new HttpError(404, "Không tìm thấy ảnh.");
  return streamOriginal(ctx, photo.storage_key, photo.original_filename);
}

export async function streamThumbnail(ctx: Ctx, photoId: string): Promise<Response> {
  const photo = await getPhoto(ctx.env.DB, photoId, ctx.ownerId);
  if (!photo) throw new HttpError(404, "Không tìm thấy ảnh.");
  if (!photo.thumbnail_key) throw new HttpError(404, "Ảnh này chưa có ảnh thu nhỏ.");
  const object = await ctx.storage.thumbs.get(photo.thumbnail_key);
  if (!object) throw new HttpError(404, "Không đọc được ảnh thu nhỏ.");
  await bumpStats(ctx.env.DB, ctx.ownerId, { classB: 1, bytesRead: object.size });
  return new Response(object.body, {
    headers: {
      "content-type": "image/webp",
      "cache-control": "private, max-age=86400",
      etag: object.etag,
    },
  });
}

/**
 * Tạo liên kết tải xuống NGẮN HẠN cho một ảnh.
 *
 * URL trả về chỉ chứa định danh + hạn dùng + chữ ký HMAC. Nó không chứa và
 * không thể suy ra khoá API nào, và chỉ mở đúng một ảnh trong khoảng thời gian
 * cho phép.
 */
export async function createDownloadLink(ctx: Ctx, photoId: string): Promise<Response> {
  const photo = await getPhoto(ctx.env.DB, photoId, ctx.ownerId);
  if (!photo) throw new HttpError(404, "Không tìm thấy ảnh.");
  const variant = await requestedVariant(ctx);
  const signed = await signPhotoLink(ctx, photoId, variant);
  return json({ ...signed, variant, ttlSeconds: ctx.config.linkTtlSeconds });
}

/**
 * Ký liên kết cho NHIỀU ảnh trong một yêu cầu.
 *
 * Lưới ảnh tải lười cần URL cho từng ảnh thu nhỏ; gọi từng ảnh một sẽ là N
 * request. Gộp lại thành một request giúp mở album hàng chục nghìn ảnh mà không
 * tạo ra hàng nghìn lời gọi.
 */
export async function createDownloadLinks(ctx: Ctx): Promise<Response> {
  const body = await readJson<{ photoIds?: unknown; variant?: unknown }>(ctx.request).catch(
    (): { photoIds?: unknown; variant?: unknown } => ({}),
  );
  const raw = Array.isArray(body.photoIds) ? body.photoIds : [];
  const ids = raw
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .slice(0, 200);
  if (ids.length === 0) throw new HttpError(400, "Cần danh sách photoIds (tối đa 200 mục một lần).");
  const variant: LinkVariant = body.variant === "original" ? "original" : "thumb";

  const links: { id: string; url: string; expiresAt: string }[] = [];
  for (const id of ids) {
    const photo = await getPhoto(ctx.env.DB, id, ctx.ownerId);
    if (!photo) continue;
    if (variant === "thumb" && !photo.thumbnail_key) continue;
    const signed = await signPhotoLink(ctx, id, variant);
    links.push({ id, ...signed });
  }
  return json({ links, variant, ttlSeconds: ctx.config.linkTtlSeconds });
}

type LinkVariant = "thumb" | "original";

async function requestedVariant(ctx: Ctx): Promise<LinkVariant> {
  const body = await readJson<{ variant?: unknown }>(ctx.request).catch(() => ({}) as { variant?: unknown });
  return body.variant === "thumb" ? "thumb" : "original";
}

async function signPhotoLink(
  ctx: Ctx,
  photoId: string,
  variant: LinkVariant,
): Promise<{ url: string; expiresAt: string }> {
  const secret = ctx.env.LINK_SECRET ?? ctx.env.ARCHIVE_TOKEN;
  if (!secret) throw new HttpError(500, "Thiếu LINK_SECRET nên không ký được liên kết.");
  const exp = Math.floor(Date.now() / 1000) + ctx.config.linkTtlSeconds;
  const scope = `owner:${ctx.ownerId}`;
  const subject = variant === "thumb" ? `${photoId}:thumb` : photoId;
  const signature = await signTicket(secret, { scope, subject, exp });
  return {
    url: `/dl/${encodeURIComponent(subject)}?scope=${encodeURIComponent(scope)}&exp=${exp}&sig=${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/* ── Dung lượng, chi phí và sức khoẻ ──────────────────────────────────── */

export async function usageRoute(ctx: Ctx): Promise<Response> {
  const totals = await getUsageTotals(ctx.env.DB, ctx.ownerId);
  const stats = await getStats(ctx.env.DB, ctx.ownerId);
  const usedBytes = totals.originalBytes + totals.thumbnailBytes;
  const cost = estimateCost(ctx.config, usedBytes, stats.classA, stats.classB);

  const warnings: { level: "info" | "warning"; message: string }[] = [
    {
      level: "info",
      message:
        "Ứng dụng không đặt hạn mức dung lượng hay số ảnh. Sức chứa thực tế phụ thuộc vào gói Cloudflare, trạng thái tài khoản và phương thức thanh toán của bạn.",
    },
  ];
  if (ctx.config.warnStorageBytes && usedBytes > ctx.config.warnStorageBytes) {
    warnings.push({
      level: "warning",
      message: `Dung lượng đã vượt ${(ctx.config.warnStorageBytes / 1024 ** 3).toFixed(1)} GB — ngưỡng miễn phí của R2 Standard. Phần vượt tính ${ctx.config.pricePerGbMonth} USD/GB/tháng. Không có ảnh nào bị chặn hay xoá.`,
    });
  }
  if (ctx.config.warnClassA && stats.classA > ctx.config.warnClassA) {
    warnings.push({
      level: "warning",
      message: `Số thao tác Class A trong tháng (${stats.classA}) đã vượt mức miễn phí ${ctx.config.warnClassA}.`,
    });
  }
  if (ctx.config.warnClassB && stats.classB > ctx.config.warnClassB) {
    warnings.push({
      level: "warning",
      message: `Số thao tác Class B trong tháng (${stats.classB}) đã vượt mức miễn phí ${ctx.config.warnClassB}.`,
    });
  }

  const unverified = await ctx.env.DB.prepare(
    "select count(*) as n from photos where owner_id = ? and verified_at is null",
  )
    .bind(ctx.ownerId)
    .first<{ n: number }>();
  const mismatches = await ctx.env.DB.prepare(
    "select count(*) as n from photos where owner_id = ? and checksum_mismatch = 1",
  )
    .bind(ctx.ownerId)
    .first<{ n: number }>();

  return json({
    usedBytes,
    originalBytes: totals.originalBytes,
    thumbnailBytes: totals.thumbnailBytes,
    photoCount: totals.photoCount,
    albumCount: totals.albumCount,
    month: currentMonth(),
    operations: { classA: stats.classA, classB: stats.classB, bytesWritten: stats.bytesWritten, bytesRead: stats.bytesRead },
    cost: {
      currency: "USD",
      storageUsd: cost.storageUsd,
      classAUsd: cost.classAUsd,
      classBUsd: cost.classBUsd,
      totalUsd: cost.totalUsd,
      marginalPerGbMonthUsd: cost.marginalPerGbMonthUsd,
      note: "Ước tính từ đơn giá đã cấu hình và số liệu thật trong tháng. Không phải hoá đơn.",
    },
    verification: { awaitingVerification: unverified?.n ?? 0, mismatches: mismatches?.n ?? 0 },
    thresholds: {
      warnStorageBytes: ctx.config.warnStorageBytes,
      warnClassA: ctx.config.warnClassA,
      warnClassB: ctx.config.warnClassB,
      enforced: false,
    },
    warnings,
  });
}

/**
 * Kiểm tra sức khoẻ THẬT: ghi thử một object nhỏ, đọc lại, rồi xoá.
 * Một endpoint chỉ trả `ok: true` mà không thử gì cả thì vô nghĩa.
 */
export async function healthRoute(ctx: Ctx): Promise<Response> {
  const probeKey = `health/${ctx.ownerId}/${Date.now()}.txt`;
  const payload = new TextEncoder().encode(`probe ${probeKey}`);
  let originalsOk = false;
  let thumbsOk = false;
  const details: string[] = [];

  try {
    await ctx.storage.originals.put(probeKey, payload, "text/plain");
    const readBack = await ctx.storage.originals.get(probeKey);
    originalsOk = Boolean(readBack) && readBack!.size === payload.byteLength;
    await ctx.storage.originals.remove([probeKey]);
  } catch (error) {
    details.push(`originals: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const thumbProbe = `health/${ctx.ownerId}/${Date.now()}-t.webp`;
    await ctx.storage.thumbs.put(thumbProbe, payload, "text/plain");
    thumbsOk = (await ctx.storage.thumbs.head(thumbProbe)) !== null;
    await ctx.storage.thumbs.remove([thumbProbe]);
  } catch (error) {
    details.push(`thumbs: ${error instanceof Error ? error.message : String(error)}`);
  }

  const active = await ctx.env.DB.prepare(
    "select count(*) as n from upload_sessions where owner_id = ? and status = 'active'",
  )
    .bind(ctx.ownerId)
    .first<{ n: number }>();
  const jobs = await ctx.env.DB.prepare("select count(*) as n from jobs where status = 'pending'").first<{
    n: number;
  }>();

  return json({
    ok: originalsOk && thumbsOk,
    /** Định danh chủ kho được suy ra từ token — dùng để hiển thị, không phải bí mật. */
    ownerId: ctx.ownerId,
    storage: {
      driver: ctx.storage.kind,
      uploadMode: ctx.storage.uploadMode,
      originalsWritable: originalsOk,
      thumbnailsWritable: thumbsOk,
    },
    database: { ok: true },
    queue: { pendingJobs: jobs?.n ?? 0 },
    uploads: { activeSessions: active?.n ?? 0 },
    limits: {
      workerMaxRequestBytes: WORKER_MAX_REQUEST_BYTES,
      r2MaxParts: R2_MAX_PARTS,
      note: "Trần thân request 100 MB của Cloudflare là lý do mỗi phần bị giới hạn; đây là giới hạn nền tảng, không phải hạn mức ứng dụng.",
    },
    details,
  });
}
