/**
 * API tải lên nhiều phần (multipart) — đường đi chính của toàn bộ hệ thống.
 *
 * Vì sao phải chia phần: Cloudflare giới hạn thân request ở 100 MB (gói
 * Free/Pro) và KHÔNG thể vượt qua bằng cách stream. Một tệp 500 MB vì thế bắt
 * buộc phải là nhiều request. Điều đó cũng mang lại lợi ích thật: resume được
 * sau khi mất mạng, và chỉ phải gửi lại đúng phần bị lỗi.
 *
 * Trạng thái phiên nằm trong D1 chứ KHÔNG nằm trong trình duyệt. Nhờ vậy đóng
 * tab, đổi máy hay mất kết nối đều resume được: client hỏi server "đã có phần
 * nào rồi" thay vì phải tự nhớ.
 */

import type { Ctx } from "../context";
import { partByteSize, planStorage } from "../config";
import {
  countParts,
  countPendingJobs,
  deleteSession,
  expireStaleSessions,
  findByChecksum,
  finishJob,
  jobsForPhotos,
  getAlbum,
  getSession,
  insertPhoto,
  insertSession,
  listActiveSessions,
  listParts,
  markVerified,
  pendingJobs,
  nowIso,
  recomputeAlbumCounters,
  savePart,
  updateSessionStatus,
  bumpStats,
  enqueueJob,
} from "../db/repo";
import { hashObjectStream } from "../lib/crypto";
import { HttpError, json, readJson, requireInteger, requireString } from "../lib/http";
import { buildOriginalKey, contentTypeFor, newId } from "../lib/ids";
import type { PhotoRow } from "../db/repo";

interface CreateSessionBody {
  albumId?: string;
  filename?: string;
  totalBytes?: number;
  mimeType?: string;
  claimedChecksum?: string;
  width?: number | null;
  height?: number | null;
  previewable?: boolean;
}

const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;

function assertChecksum(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !CHECKSUM_PATTERN.test(raw.toLowerCase())) {
    throw new HttpError(400, "checksum phải là SHA-256 hex 64 ký tự.");
  }
  return raw.toLowerCase();
}

function serialiseSession(row: Awaited<ReturnType<typeof getSession>>) {
  if (!row) return null;
  return {
    id: row.id,
    albumId: row.album_id,
    filename: row.original_filename,
    mimeType: row.mime_type,
    totalBytes: row.total_bytes,
    partSize: row.part_size,
    partCount: row.part_count,
    status: row.status,
    claimedChecksum: row.claimed_checksum,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    lastError: row.last_error,
  };
}

/**
 * Bắt đầu một phiên tải lên.
 *
 * Kiểm tra ảnh trùng TRƯỚC khi tạo phiên: nếu nội dung đã có trong album thì
 * dừng ngay, để người dùng không phải tải lên 500 MB vô ích.
 */
export async function createUploadSession(ctx: Ctx): Promise<Response> {
  const body = await readJson<CreateSessionBody>(ctx.request);
  const albumId = requireString(body.albumId, "albumId", 64);
  const filename = requireString(body.filename, "filename", 255);
  const totalBytes = requireInteger(body.totalBytes, "totalBytes", 1, 5 * 1024 ** 4);
  const claimedChecksum = assertChecksum(body.claimedChecksum);

  const album = await getAlbum(ctx.env.DB, albumId, ctx.ownerId);
  if (!album) throw new HttpError(404, "Album không tồn tại hoặc không thuộc về bạn.");

  if (claimedChecksum) {
    const duplicate = await findByChecksum(ctx.env.DB, albumId, claimedChecksum);
    if (duplicate) {
      return json(
        {
          error: "Ảnh này đã có trong album (trùng nội dung SHA-256).",
          code: "duplicate",
          duplicate: { id: duplicate.id, originalFilename: duplicate.original_filename },
        },
        { status: 409 },
      );
    }
  }

  let plan;
  try {
    plan = planStorage(totalBytes);
  } catch (error) {
    // Giới hạn kỹ thuật của nền tảng, không phải hạn mức của ứng dụng.
    throw new HttpError(413, error instanceof Error ? error.message : "Tệp quá lớn.");
  }

  const storageKey = buildOriginalKey(ctx.ownerId, albumId, filename);
  const mimeType = contentTypeFor(filename, body.mimeType || "application/octet-stream");

  // Không bao giờ ghi đè: nếu khoá đã tồn tại (gần như không thể vì có hậu tố
  // ngẫu nhiên), dừng lại thay vì thay thế dữ liệu cũ.
  const existing = await ctx.storage.originals.head(storageKey);
  if (existing) {
    throw new HttpError(409, "Khoá lưu trữ đã tồn tại — từ chối ghi đè để bảo vệ ảnh cũ.");
  }

  const handle = await ctx.storage.originals.createMultipart(storageKey, mimeType);
  const sessionId = newId();
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + ctx.config.sessionTtlSeconds * 1000).toISOString();

  await insertSession(ctx.env.DB, {
    id: sessionId,
    owner_id: ctx.ownerId,
    album_id: albumId,
    storage_key: storageKey,
    original_filename: filename,
    mime_type: mimeType,
    total_bytes: totalBytes,
    part_size: plan.partSize,
    part_count: plan.partCount,
    r2_upload_id: handle.uploadId,
    claimed_checksum: claimedChecksum,
    width: body.width ?? null,
    height: body.height ?? null,
    previewable: body.previewable ? 1 : 0,
    status: "active",
    attempts: 0,
    last_error: null,
    created_at: timestamp,
    updated_at: timestamp,
    expires_at: expiresAt,
  });

  // Class A: CreateMultipartUpload.
  await bumpStats(ctx.env.DB, ctx.ownerId, { classA: 1 });

  const session = await getSession(ctx.env.DB, sessionId, ctx.ownerId);
  return json(
    {
      session: serialiseSession(session),
      partSize: plan.partSize,
      partCount: plan.partCount,
      /** `worker-proxy`: mỗi phần gửi tới Worker. Không có khoá nào ở trình duyệt. */
      uploadMode: ctx.storage.uploadMode,
      driver: ctx.storage.kind,
    },
    { status: 201 },
  );
}

/** Danh sách phiên đang dở — nguồn dữ liệu cho nút "tiếp tục tải lên". */
export async function listUploadSessions(ctx: Ctx): Promise<Response> {
  const sessions = await listActiveSessions(ctx.env.DB, ctx.ownerId);
  const withParts = [];
  for (const session of sessions) {
    const parts = await listParts(ctx.env.DB, session.id);
    withParts.push({
      ...serialiseSession(session),
      uploadedParts: parts.map((part) => part.part_number),
      uploadedBytes: parts.reduce((sum, part) => sum + part.byte_size, 0),
    });
  }
  return json({ sessions: withParts });
}

export async function getUploadSession(ctx: Ctx, sessionId: string): Promise<Response> {
  const session = await getSession(ctx.env.DB, sessionId, ctx.ownerId);
  if (!session) throw new HttpError(404, "Không tìm thấy phiên tải lên.");
  const parts = await listParts(ctx.env.DB, sessionId);
  const uploaded = new Set(parts.map((part) => part.part_number));
  const missing: number[] = [];
  for (let n = 1; n <= session.part_count; n += 1) if (!uploaded.has(n)) missing.push(n);
  return json({
    session: serialiseSession(session),
    uploadedParts: [...uploaded].sort((a, b) => a - b),
    missingParts: missing,
    uploadedBytes: parts.reduce((sum, part) => sum + part.byte_size, 0),
  });
}

/**
 * Ghi MỘT phần.
 *
 * Byte được chuyển thẳng từ thân request vào R2 dưới dạng luồng, không giữ cả
 * phần trong bộ nhớ. Kích thước được kiểm tra trước bằng `content-length` và
 * sau đó được xác nhận lại bằng tổng kích thước của object hoàn chỉnh.
 */
export async function uploadPart(ctx: Ctx, sessionId: string, partNumberRaw: string): Promise<Response> {
  const partNumber = Number(partNumberRaw);
  if (!Number.isInteger(partNumber) || partNumber < 1) {
    throw new HttpError(400, "Số thứ tự phần không hợp lệ.");
  }

  const session = await getSession(ctx.env.DB, sessionId, ctx.ownerId);
  if (!session) throw new HttpError(404, "Không tìm thấy phiên tải lên.");
  if (session.status !== "active") {
    throw new HttpError(409, `Phiên tải lên đang ở trạng thái "${session.status}", không ghi thêm được.`);
  }
  if (partNumber > session.part_count) {
    throw new HttpError(400, `Phần ${partNumber} vượt quá số phần của phiên (${session.part_count}).`);
  }

  const expectedBytes = partByteSize(session.total_bytes, session.part_size, partNumber);
  const declaredLength = Number(ctx.request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength !== expectedBytes) {
    // Sai kích thước phần sẽ làm hỏng `complete` với lỗi khó hiểu (mã 10048),
    // nên chặn ngay ở đây với thông báo rõ ràng.
    throw new HttpError(
      400,
      `Phần ${partNumber} phải đúng ${expectedBytes} byte, nhận được ${declaredLength}.`,
    );
  }
  if (!ctx.request.body) throw new HttpError(400, "Thiếu dữ liệu phần.");

  const handle = { key: session.storage_key, uploadId: session.r2_upload_id };
  const uploaded = await ctx.storage.originals.uploadPart(
    handle,
    partNumber,
    ctx.request.body as ReadableStream<Uint8Array>,
    expectedBytes,
  );

  await savePart(ctx.env.DB, {
    session_id: session.id,
    part_number: uploaded.partNumber,
    byte_size: uploaded.byteSize,
    etag: uploaded.etag,
    uploaded_at: nowIso(),
  });
  await bumpStats(ctx.env.DB, ctx.ownerId, { classA: 1, bytesWritten: expectedBytes });

  return json({
    partNumber: uploaded.partNumber,
    etag: uploaded.etag,
    byteSize: uploaded.byteSize,
  });
}

/**
 * Hoàn tất phiên: ghép các phần, XÁC MINH, rồi mới ghi metadata.
 *
 * Thứ tự này quan trọng: một ảnh chỉ được coi là "đã lưu trữ" sau khi kích
 * thước thật của object khớp với kích thước đã khai báo.
 */
export async function completeUploadSession(ctx: Ctx, sessionId: string): Promise<Response> {
  const session = await getSession(ctx.env.DB, sessionId, ctx.ownerId);
  if (!session) throw new HttpError(404, "Không tìm thấy phiên tải lên.");
  if (session.status !== "active") {
    throw new HttpError(409, `Phiên đang ở trạng thái "${session.status}".`);
  }

  const parts = await listParts(ctx.env.DB, sessionId);
  if (parts.length !== session.part_count) {
    const present = new Set(parts.map((part) => part.part_number));
    const missing: number[] = [];
    for (let n = 1; n <= session.part_count; n += 1) if (!present.has(n)) missing.push(n);
    return json(
      {
        error: `Còn thiếu ${missing.length} phần chưa tải lên.`,
        code: "incomplete",
        missingParts: missing,
      },
      { status: 409 },
    );
  }

  const totalUploaded = parts.reduce((sum, part) => sum + part.byte_size, 0);
  if (totalUploaded !== session.total_bytes) {
    throw new HttpError(
      400,
      `Tổng kích thước các phần (${totalUploaded}) không khớp kích thước đã khai báo (${session.total_bytes}).`,
    );
  }

  // Bảo vệ quy tắc của R2 trước khi gọi: mọi phần không phải phần cuối phải
  // đúng bằng `part_size`, và phần cuối phải ≤ `part_size`.
  for (const part of parts) {
    const expected = partByteSize(session.total_bytes, session.part_size, part.part_number);
    if (part.byte_size !== expected) {
      throw new HttpError(
        400,
        `Phần ${part.part_number} có kích thước ${part.byte_size}, phải là ${expected}.`,
      );
    }
  }

  const handle = { key: session.storage_key, uploadId: session.r2_upload_id };
  const object = await ctx.storage.originals.complete(
    handle,
    parts.map((part) => ({
      partNumber: part.part_number,
      etag: part.etag,
      byteSize: part.byte_size,
    })),
  );

  // XÁC MINH kích thước bằng dữ liệu của nhà cung cấp, không tin client.
  if (object.size !== session.total_bytes) {
    await ctx.storage.originals.remove([session.storage_key]).catch(() => undefined);
    await updateSessionStatus(
      ctx.env.DB,
      sessionId,
      "failed",
      `Kích thước object sau khi ghép là ${object.size}, không khớp ${session.total_bytes}. Đã xoá object sai.`,
    );
    throw new HttpError(500, "Kích thước tệp sau khi ghép không khớp. Đã huỷ và xoá object.");
  }

  const photoId = newId();
  const timestamp = nowIso();
  const photo: PhotoRow = {
    id: photoId,
    album_id: session.album_id,
    owner_id: ctx.ownerId,
    original_filename: session.original_filename,
    storage_key: session.storage_key,
    thumbnail_key: null,
    mime_type: session.mime_type,
    file_size: object.size,
    thumbnail_bytes: 0,
    width: session.width,
    height: session.height,
    claimed_checksum: session.claimed_checksum,
    verified_checksum: null,
    verified_at: null,
    checksum_mismatch: 0,
    etag: object.etag,
    upload_id: session.r2_upload_id,
    previewable: session.previewable,
    created_at: timestamp,
  };

  try {
    await insertPhoto(ctx.env.DB, photo);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique|constraint/i.test(message)) {
      // Đua tranh: một lần tải khác đã ghi cùng nội dung trước đó vài mili-giây.
      // Xoá object vừa ghép để không để lại tệp mồ côi.
      await ctx.storage.originals.remove([session.storage_key]).catch(() => undefined);
      await updateSessionStatus(ctx.env.DB, sessionId, "failed", "Trùng nội dung với ảnh đã có.");
      return json(
        { error: "Ảnh này đã có trong album (trùng nội dung).", code: "duplicate" },
        { status: 409 },
      );
    }
    throw error;
  }

  await updateSessionStatus(ctx.env.DB, sessionId, "completed");
  await deleteSession(ctx.env.DB, sessionId);
  await recomputeAlbumCounters(ctx.env.DB, session.album_id);
  await bumpStats(ctx.env.DB, ctx.ownerId, { classA: 1 });
  // Xác minh SHA-256 đầy đủ chạy nền: đọc lại object và băm theo luồng.
  await enqueueJob(ctx.env.DB, "verify_checksum", { photoId });

  return json(
    {
      photo: {
        id: photo.id,
        albumId: photo.album_id,
        originalFilename: photo.original_filename,
        storageKey: photo.storage_key,
        mimeType: photo.mime_type,
        fileSize: photo.file_size,
        claimedChecksum: photo.claimed_checksum,
        width: photo.width,
        height: photo.height,
        previewable: Boolean(photo.previewable),
        createdAt: photo.created_at,
      },
      /** Xác minh kích thước đã đạt; checksum đầy đủ sẽ xác minh ở bước nền. */
      sizeVerified: true,
      checksumVerification: "pending",
    },
    { status: 201 },
  );
}

/** Huỷ phiên và dọn dẹp các phần đã ghi trên R2. */
export async function abortUploadSession(ctx: Ctx, sessionId: string): Promise<Response> {
  const session = await getSession(ctx.env.DB, sessionId, ctx.ownerId);
  if (!session) throw new HttpError(404, "Không tìm thấy phiên tải lên.");
  if (session.status === "active") {
    await ctx.storage.originals
      .abort({ key: session.storage_key, uploadId: session.r2_upload_id })
      .catch((error) => console.error("Không huỷ được multipart trên R2:", error));
    await updateSessionStatus(ctx.env.DB, sessionId, "aborted");
  }
  await deleteSession(ctx.env.DB, sessionId);
  return json({ aborted: true, sessionId });
}

/**
 * Dọn dẹp phiên bỏ dở và chạy hàng đợi công việc nền.
 *
 * Được gọi từ `scheduled` (Cron Trigger) nếu cấu hình, hoặc thủ công từ
 * dashboard sức khoẻ. Không có Cron Trigger thì gọi thủ công vẫn đúng.
 *
 * Thân request TUỲ CHỌN `{ "photoIds": ["..."] }` sẽ ưu tiên xác minh đúng
 * những ảnh đó — đây là nút "xác minh ngay" của một ảnh, không phụ thuộc vào
 * việc hàng đợi còn bao nhiêu việc cũ xếp trước.
 */
export async function runMaintenance(ctx: Ctx): Promise<Response> {
  const stale = await expireStaleSessions(ctx.env.DB, nowIso());
  for (const session of stale) {
    await ctx.storage.originals
      .abort({ key: session.storage_key, uploadId: session.r2_upload_id })
      .catch((error) => console.error("Không huỷ được multipart bỏ dở:", error));
    await deleteSession(ctx.env.DB, session.id);
  }

  const requested = await requestedPhotoIds(ctx);
  const jobs =
    requested.length > 0
      ? await jobsForPhotos(ctx.env.DB, ctx.ownerId, requested)
      : await pendingJobs(ctx.env.DB, ctx.config.maintenanceBatch);
  const processed: { id: number; kind: string; ok: boolean; detail?: string }[] = [];

  for (const job of jobs) {
    if (job.kind !== "verify_checksum" || !job.photo_id) {
      await finishJob(ctx.env.DB, job.id, { ok: false, error: `Loại công việc không hỗ trợ: ${job.kind}` });
      processed.push({ id: job.id, kind: job.kind, ok: false, detail: "unsupported" });
      continue;
    }
    const photo = await ctx.env.DB.prepare("select * from photos where id = ?")
      .bind(job.photo_id)
      .first<PhotoRow>();
    if (!photo) {
      await finishJob(ctx.env.DB, job.id, { ok: true });
      processed.push({ id: job.id, kind: job.kind, ok: true, detail: "photo gone" });
      continue;
    }
    const object = await ctx.storage.originals.get(photo.storage_key);
    if (!object) {
      await finishJob(ctx.env.DB, job.id, { ok: false, error: "Không đọc được object trên R2." });
      processed.push({ id: job.id, kind: job.kind, ok: false, detail: "object missing" });
      continue;
    }
    const { hex, bytes } = await hashObjectStream(object.body);
    const matches = photo.claimed_checksum ? hex === photo.claimed_checksum : true;
    const sizeMatches = bytes === photo.file_size;
    await markVerified(ctx.env.DB, photo.id, {
      verified: matches && sizeMatches ? hex : null,
      mismatch: !(matches && sizeMatches),
    });
    await bumpStats(ctx.env.DB, photo.owner_id, { classB: 1, bytesRead: bytes });
    await finishJob(ctx.env.DB, job.id, { ok: true });
    processed.push({ id: job.id, kind: job.kind, ok: true, detail: hex.slice(0, 12) });
  }

  return json({
    abortedStaleSessions: stale.length,
    jobsProcessed: processed,
    /** Số việc còn lại — cho thấy hàng đợi đang rút chứ không kẹt. */
    pendingJobsRemaining: await countPendingJobs(ctx.env.DB),
    remainingActiveSessions: (await listActiveSessions(ctx.env.DB, ctx.ownerId)).length,
  });
}

/** Đọc danh sách ảnh cần xác minh ngay từ thân request (nếu có). */
async function requestedPhotoIds(ctx: Ctx): Promise<string[]> {
  let body: unknown;
  try {
    body = await ctx.request.clone().json();
  } catch {
    return [];
  }
  if (typeof body !== "object" || body === null) return [];
  const raw = (body as { photoIds?: unknown }).photoIds;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .slice(0, 50);
}

/** Gắn ảnh thu nhỏ cho một ảnh đã lưu trữ (không bao giờ thay thế ảnh gốc). */
export async function attachThumbnail(ctx: Ctx, photoId: string): Promise<Response> {
  const photo = await ctx.env.DB.prepare("select * from photos where id = ? and owner_id = ?")
    .bind(photoId, ctx.ownerId)
    .first<PhotoRow>();
  if (!photo) throw new HttpError(404, "Không tìm thấy ảnh.");

  const bytes = new Uint8Array(await ctx.request.arrayBuffer());
  if (bytes.byteLength === 0) throw new HttpError(400, "Ảnh thu nhỏ rỗng.");
  if (bytes.byteLength > 5 * 1024 * 1024) throw new HttpError(413, "Ảnh thu nhỏ vượt 5 MB.");

  const key = photo.storage_key.replace(/^originals\//, "thumbnails/").replace(/\.[^./]+$/, "") + ".thumb.webp";
  const object = await ctx.storage.thumbs.put(key, bytes, "image/webp");
  await ctx.env.DB.prepare("update photos set thumbnail_key = ?, thumbnail_bytes = ? where id = ?")
    .bind(key, object.size, photoId)
    .run();
  await bumpStats(ctx.env.DB, photo.owner_id, { classA: 1, bytesWritten: object.size });
  return json({ thumbnailKey: key, thumbnailBytes: object.size });
}

export async function countSessionParts(ctx: Ctx, sessionId: string): Promise<Response> {
  const session = await getSession(ctx.env.DB, sessionId, ctx.ownerId);
  if (!session) throw new HttpError(404, "Không tìm thấy phiên tải lên.");
  return json({ parts: await countParts(ctx.env.DB, sessionId), expected: session.part_count });
}
