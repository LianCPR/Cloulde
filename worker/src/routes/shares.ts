/**
 * Chia sẻ album cho khách không có tài khoản.
 *
 * Nguyên tắc bảo mật (giống bản thiết kế trước, giữ nguyên vì nó đúng):
 *   • Token chia sẻ 256-bit ngẫu nhiên, CHỈ hiển thị một lần cho chủ album.
 *   • Cơ sở dữ liệu CHỈ lưu SHA-256 của token. Rò rỉ DB không lộ liên kết.
 *   • Mật khẩu tuỳ chọn băm bằng PBKDF2 (chậm), không phải SHA-256 trần.
 *   • Mọi thao tác của khách đều đi qua server: trình duyệt khách KHÔNG BAO GIỜ
 *     nhận được khoá lưu trữ hay đường dẫn object.
 *   • Liên kết tải xuống là ticket ngắn hạn, ràng buộc đúng một ảnh và đúng
 *     phạm vi chia sẻ, nên không dùng chéo sang ngữ cảnh khác được.
 */

import type { Ctx } from "../context";
import {
  getAlbum,
  getPhoto,
  getShare,
  getShareByTokenHash,
  insertShare,
  listPhotos,
  listShares,
  nowIso,
  recentFailedAttempts,
  recordAttempt,
  touchShareAccess,
  updateShare,
} from "../db/repo";
import { hashPassword, randomToken, sha256Hex, verifyPassword } from "../lib/crypto";
import { HttpError, decodeCursor, encodeCursor, json, pageLimit, pickSort, readJson, requireString } from "../lib/http";
import { newId } from "../lib/ids";
import type { ShareRow } from "../db/repo";
import { signTicket } from "../lib/tickets";

export interface PublicCtx {
  request: Request;
  env: Ctx["env"];
  config: Ctx["config"];
  storage: Ctx["storage"];
  url: URL;
}

function shareDto(row: Awaited<ReturnType<typeof listShares>>[number]) {
  return {
    id: row.id,
    albumId: row.album_id,
    ownerId: row.owner_id,
    /** Luôn `null` sau khi tạo — token thô chỉ trả về đúng một lần. */
    token: null as string | null,
    allowDownload: Boolean(row.allow_download),
    hasPassword: Boolean(row.password_hash),
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    accessCount: row.access_count,
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
  };
}

export async function createShareRoute(ctx: Ctx, albumId: string): Promise<Response> {
  const album = await getAlbum(ctx.env.DB, albumId, ctx.ownerId);
  if (!album) throw new HttpError(404, "Không tìm thấy album.");
  const body = await readJson<{
    allowDownload?: boolean;
    password?: string | null;
    expiresInDays?: number | null;
  }>(ctx.request);

  if (body.password && body.password.length < 6) {
    throw new HttpError(400, "Mật khẩu chia sẻ cần tối thiểu 6 ký tự.");
  }

  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const password = body.password ? await hashPassword(body.password) : null;
  const expiresAt =
    body.expiresInDays && body.expiresInDays > 0
      ? new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString()
      : null;
  const id = newId();

  await insertShare(ctx.env.DB, {
    id,
    album_id: albumId,
    owner_id: ctx.ownerId,
    token_hash: tokenHash,
    password_hash: password?.hash ?? null,
    password_salt: password?.salt ?? null,
    password_iter: password?.iterations ?? null,
    allow_download: body.allowDownload === false ? 0 : 1,
    expires_at: expiresAt,
    revoked_at: null,
    access_count: 0,
    last_accessed_at: null,
    created_at: nowIso(),
  });

  const created = await getShare(ctx.env.DB, id, ctx.ownerId);
  return json(
    {
      share: { ...shareDto(created!), token },
      /** Hiển thị một lần. Hệ thống không thể hiện lại token này. */
      tokenVisibleOnce: true,
    },
    { status: 201 },
  );
}

export async function listSharesRoute(ctx: Ctx, albumId: string): Promise<Response> {
  const album = await getAlbum(ctx.env.DB, albumId, ctx.ownerId);
  if (!album) throw new HttpError(404, "Không tìm thấy album.");
  const rows = await listShares(ctx.env.DB, albumId, ctx.ownerId);
  return json({ shares: rows.map(shareDto) });
}

export async function updateShareRoute(ctx: Ctx, shareId: string): Promise<Response> {
  const share = await getShare(ctx.env.DB, shareId, ctx.ownerId);
  if (!share) throw new HttpError(404, "Không tìm thấy liên kết chia sẻ.");
  const body = await readJson<{
    allowDownload?: boolean;
    password?: string | null;
    removePassword?: boolean;
    expiresInDays?: number | null;
    revoke?: boolean;
  }>(ctx.request);

  let password: { hash: string | null; salt: string | null; iter: number | null } | undefined;
  if (body.removePassword) {
    password = { hash: null, salt: null, iter: null };
  } else if (body.password) {
    if (body.password.length < 6) throw new HttpError(400, "Mật khẩu cần tối thiểu 6 ký tự.");
    const hashed = await hashPassword(body.password);
    password = { hash: hashed.hash, salt: hashed.salt, iter: hashed.iterations };
  }

  await updateShare(ctx.env.DB, shareId, ctx.ownerId, {
    allowDownload: body.allowDownload,
    password,
    expiresAt:
      body.expiresInDays === undefined
        ? undefined
        : body.expiresInDays && body.expiresInDays > 0
          ? new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString()
          : null,
    revokedAt: body.revoke ? nowIso() : undefined,
  });

  const updated = await getShare(ctx.env.DB, shareId, ctx.ownerId);
  return json({ share: shareDto(updated!) });
}

export async function revokeShareRoute(ctx: Ctx, shareId: string): Promise<Response> {
  const share = await getShare(ctx.env.DB, shareId, ctx.ownerId);
  if (!share) throw new HttpError(404, "Không tìm thấy liên kết chia sẻ.");
  await updateShare(ctx.env.DB, shareId, ctx.ownerId, { revokedAt: nowIso() });
  return json({ revoked: true, shareId });
}

/* ── Phía khách ───────────────────────────────────────────────────────── */

interface ResolvedShare {
  share: ShareRow;
  tokenHash: string;
}

/**
 * Xác minh token + mật khẩu.
 * Không bao giờ tiết lộ liên kết có tồn tại hay không khi token sai (trả 404
 * giống nhau), để không dò được token.
 */
async function resolveShare(
  ctx: PublicCtx,
  token: string,
  password: string | null | undefined,
): Promise<ResolvedShare> {
  if (!token || token.length < 20) {
    throw new HttpError(404, "Liên kết chia sẻ không hợp lệ.", "not_found");
  }
  const tokenHash = await sha256Hex(token);
  const share = await getShareByTokenHash(ctx.env.DB, tokenHash);
  if (!share) throw new HttpError(404, "Liên kết chia sẻ không hợp lệ.", "not_found");
  if (share.revoked_at) throw new HttpError(410, "Chủ album đã thu hồi liên kết này.", "revoked");
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
    throw new HttpError(410, "Liên kết chia sẻ đã hết hạn.", "expired");
  }

  if (share.password_hash && share.password_salt && share.password_iter) {
    if (await recentFailedAttempts(ctx.env.DB, tokenHash) >= 10) {
      throw new HttpError(429, "Bạn đã thử quá nhiều lần. Vui lòng chờ vài phút.", "rate_limited");
    }
    if (!password) throw new HttpError(401, "PASSWORD_REQUIRED", "password_required");
    const ok = await verifyPassword(password, {
      hash: share.password_hash,
      salt: share.password_salt,
      iterations: share.password_iter,
    });
    await recordAttempt(ctx.env.DB, tokenHash, ok);
    if (!ok) throw new HttpError(401, "PASSWORD_WRONG", "password_wrong");
  }

  await touchShareAccess(ctx.env.DB, share.id);
  return { share, tokenHash };
}

export async function resolveShareRoute(ctx: PublicCtx, token: string): Promise<Response> {
  const body = await readJson<{ password?: string | null }>(ctx.request).catch(() => ({ password: null }));
  const { share } = await resolveShare(ctx, token, body.password ?? null);
  const album = await getAlbum(ctx.env.DB, share.album_id, share.owner_id);
  if (!album) throw new HttpError(404, "Album của liên kết này không còn tồn tại.");
  return json({
    share: {
      id: share.id,
      albumId: share.album_id,
      allowDownload: Boolean(share.allow_download),
      hasPassword: Boolean(share.password_hash),
      expiresAt: share.expires_at,
    },
    album: {
      id: album.id,
      title: album.title,
      description: album.description,
      coverPhotoId: album.cover_photo_id,
      photoCount: album.photo_count,
      totalBytes: album.total_bytes,
      createdAt: album.created_at,
      updatedAt: album.updated_at,
      // Không trả email hay định danh chủ album cho khách.
      ownerLabel: "Chủ album",
    },
  });
}

export async function listSharePhotosRoute(ctx: PublicCtx, token: string): Promise<Response> {
  const body = await readJson<{
    password?: string | null;
    cursor?: string | null;
    limit?: number;
    sort?: string;
  }>(ctx.request).catch(() => ({}) as Record<string, never>);

  const { share } = await resolveShare(ctx, token, body.password ?? null);
  const limit = pageLimit(body.limit ? String(body.limit) : null, 400, 400);
  const sort = pickSort(body.sort ?? null, ["uploaded-desc", "uploaded-asc", "filename-asc"] as const, "uploaded-desc");
  const rows = await listPhotos(ctx.env.DB, share.album_id, {
    sort,
    cursor: decodeCursor(body.cursor ?? null),
    limit,
  });
  const items = rows.slice(0, limit).map((row) => ({
    id: row.id,
    albumId: row.album_id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    width: row.width,
    height: row.height,
    previewable: Boolean(row.previewable),
    createdAt: row.created_at,
  }));
  const last = items[items.length - 1];
  return json({
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeCursor(sort === "filename-asc" ? last.originalFilename : last.createdAt, last.id)
        : null,
  });
}

/**
 * Cấp ticket ngắn hạn cho MỘT ảnh trong album được chia sẻ.
 * Ticket ràng buộc vào `share:<id>`, nên không dùng được cho album khác, và
 * cũng không dùng được cho tư cách chủ kho.
 */
export async function createSharePhotoLink(
  ctx: PublicCtx,
  token: string,
): Promise<Response> {
  const body = await readJson<{ password?: string | null; photoId?: string; variant?: "original" | "thumb" }>(
    ctx.request,
  );
  const photoId = requireString(body.photoId, "photoId", 64);
  const { share } = await resolveShare(ctx, token, body.password ?? null);

  // Ảnh phải thuộc ĐÚNG album của liên kết — không tin tham số từ client.
  const photo = await getPhoto(ctx.env.DB, photoId);
  if (!photo || photo.album_id !== share.album_id) {
    throw new HttpError(404, "Ảnh không thuộc album được chia sẻ.");
  }
  const requested = body.variant === "thumb" ? "thumb" : "original";
  if (requested === "original" && !share.allow_download) {
    throw new HttpError(403, "Chủ album không cho phép tải xuống liên kết này.", "download_disabled");
  }

  /**
   * Chọn biến thể THẬT SỰ phục vụ được — giống hệt cách lưới của chủ kho chọn
   * (xem `resolveDisplayPath`): ưu tiên ảnh thu nhỏ, không có thì dùng ảnh gốc
   * nếu trình duyệt giải mã được.
   *
   * Thiếu bước này thì ảnh chưa có bản thu nhỏ vẫn được ký một URL `:thumb`,
   * rồi chính URL đó trả 404 — lưới của khách hiện ô nhấp nháy vĩnh viễn thay vì
   * hiện ảnh hay biểu tượng định dạng.
   */
  let variant = requested;
  if (requested === "thumb" && !photo.thumbnail_key) {
    // Dùng ảnh gốc làm bản xem trước CHỈ khi chủ album cho phép tải: nếu không
    // thì việc xem trước sẽ vô hiệu hoá chính lựa chọn "chỉ cho xem".
    if (!photo.previewable || !share.allow_download) {
      throw new HttpError(404, "Ảnh này chưa có bản thu nhỏ nên không xem trước được.", "no_preview");
    }
    variant = "original";
  }

  const secret = ctx.env.LINK_SECRET ?? ctx.env.ARCHIVE_TOKEN;
  if (!secret) throw new HttpError(500, "Thiếu LINK_SECRET nên không ký được liên kết.");
  const exp = Math.floor(Date.now() / 1000) + ctx.config.linkTtlSeconds;
  const scope = `share:${share.id}`;
  const subject = variant === "thumb" ? `${photoId}:thumb` : photoId;
  const signature = await signTicket(secret, { scope, subject, exp });
  return json({
    url: `/dl/${encodeURIComponent(subject)}?scope=${encodeURIComponent(scope)}&exp=${exp}&sig=${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
    variant,
  });
}

/**
 * Phục vụ URL có chữ ký (`/dl/...`).
 *
 * Đây là đường đi của CẢ chủ kho và khách: chữ ký đã ràng buộc phạm vi, nhưng
 * với liên kết chia sẻ ta vẫn kiểm tra lại trạng thái hiện tại — thu hồi phải
 * có hiệu lực NGAY, kể cả khi URL đã được ký trước đó.
 */
export async function serveSignedDownload(ctx: PublicCtx, subject: string): Promise<Response> {
  const scope = ctx.url.searchParams.get("scope") ?? "";
  const exp = Number(ctx.url.searchParams.get("exp") ?? "0");
  const sig = ctx.url.searchParams.get("sig") ?? "";
  const secret = ctx.env.LINK_SECRET ?? ctx.env.ARCHIVE_TOKEN;
  if (!secret) throw new HttpError(500, "Thiếu LINK_SECRET.");

  try {
    const { verifyTicket } = await import("../lib/tickets");
    await verifyTicket(secret, { scope, subject, exp }, sig);
  } catch (error) {
    throw new HttpError(403, error instanceof Error ? error.message : "Liên kết không hợp lệ.", "bad_signature");
  }

  const [photoId, variant] = subject.split(":");
  const photo = await getPhoto(ctx.env.DB, photoId);
  if (!photo) throw new HttpError(404, "Ảnh không còn tồn tại.");

  if (scope.startsWith("share:")) {
    const shareId = scope.slice("share:".length);
    const share = await ctx.env.DB.prepare("select * from album_shares where id = ?")
      .bind(shareId)
      .first<ShareRow>();
    if (!share) throw new HttpError(404, "Liên kết chia sẻ không tồn tại.", "not_found");
    if (share.revoked_at) throw new HttpError(410, "Liên kết đã bị thu hồi.", "revoked");
    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
      throw new HttpError(410, "Liên kết đã hết hạn.", "expired");
    }
    if (photo.album_id !== share.album_id) {
      throw new HttpError(403, "Ảnh không thuộc album được chia sẻ.", "forbidden");
    }
    if (variant !== "thumb" && !share.allow_download) {
      throw new HttpError(403, "Chủ album không cho phép tải xuống.", "download_disabled");
    }
  }

  const fakeCtx = { ...ctx, ownerId: photo.owner_id };
  if (variant === "thumb") {
    if (!photo.thumbnail_key) throw new HttpError(404, "Ảnh này chưa có ảnh thu nhỏ.");
    const object = await ctx.storage.thumbs.get(photo.thumbnail_key);
    if (!object) throw new HttpError(404, "Không đọc được ảnh thu nhỏ.");
    return new Response(object.body, {
      headers: { "content-type": "image/webp", "cache-control": "private, max-age=3600", etag: object.etag },
    });
  }

  const { streamOriginal } = await import("./gallery");
  return streamOriginal(fakeCtx as Ctx, photo.storage_key, photo.original_filename, true);
}
