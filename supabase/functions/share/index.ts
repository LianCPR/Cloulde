/**
 * Cloudé — Edge Function `share`
 * ═══════════════════════════════════════════════════════════════════════
 * Đây là MÁY CHỦ TIN CẬY cho toàn bộ nghiệp vụ chia sẻ album.
 *
 * Vì sao cần: xác minh token/mật khẩu và tạo signed URL cho ảnh riêng tư đòi
 * hỏi service role key. Khoá này chỉ sống trong Edge Function, không bao giờ
 * xuất hiện trong mã trình duyệt.
 *
 * Deploy:
 *   supabase functions deploy share --no-verify-jwt
 *   (--no-verify-jwt để khách chưa đăng nhập vẫn gọi được; quyền truy cập thật
 *    do token + mật khẩu quyết định, không phải do JWT.)
 *
 * Biến môi trường (Supabase tự inject):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 * ═══════════════════════════════════════════════════════════════════════
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const ORIGINALS_BUCKET = Deno.env.get("ORIGINALS_BUCKET") ?? "photo-originals";
const THUMBNAILS_BUCKET = Deno.env.get("THUMBNAILS_BUCKET") ?? "photo-thumbnails";

/** Thời hạn signed URL: đủ ngắn để hạn chế rò rỉ, đủ dài cho một phiên tải. */
const URL_TTL_SECONDS = 60 * 60; // 1 giờ cho ảnh xem trước
const DOWNLOAD_TTL_SECONDS = 60 * 5; // 5 phút cho tải xuống

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  // "*" để trình duyệt được gửi thoải mái các header của supabase-js (bao gồm
  // x-supabase-api-version). Function không dùng credentials (cookie), nên
  // wildcard vẫn đúng chuẩn CORS.
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RequestBody {
  action: string;
  token?: string;
  password?: string | null;
  albumId?: string;
  shareId?: string;
  photoId?: string;
  filename?: string;
  purpose?: "thumbnail" | "original";
  photoIds?: string[];
  cursor?: string | null;
  limit?: number;
  sort?: string;
  allowDownload?: boolean;
  expiresInDays?: number | null;
  removePassword?: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function ok<T>(data: T): Response {
  return json({ data, error: null });
}

function fail(message: string, status = 400): Response {
  return json({ data: null, error: message }, status);
}

/** Giới hạn tần suất đơn giản theo IP để chống dò token hàng loạt. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const requestBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = requestBuckets.get(ip);
  if (!entry || now > entry.resetAt) {
    requestBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return fail("Chỉ hỗ trợ phương thức POST.", 405);
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return fail("Quá nhiều yêu cầu. Vui lòng thử lại sau một phút.", 429);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return fail("Edge Function chưa được cấu hình đầy đủ.", 500);
  }

  // Client quyền cao: CHỈ dùng trong function này.
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return fail("Dữ liệu gửi lên không hợp lệ.");
  }

  const action = body.action;

  /** Xác định người dùng đang đăng nhập (nếu có) từ header Authorization. */
  async function currentUser() {
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    if (!token || token === Deno.env.get("SUPABASE_ANON_KEY")) return null;
    const { data } = await admin.auth.getUser(token);
    return data.user ?? null;
  }

  /* ─────────────────────────────────────────────────────────────────
     Hành động của CHỦ ALBUM (cần đăng nhập và phải là chủ sở hữu)
     ───────────────────────────────────────────────────────────────── */

  if (action === "create") {
    const user = await currentUser();
    if (!user) return fail("Bạn cần đăng nhập.", 401);
    if (!body.albumId) return fail("Thiếu albumId.");

    const { data: album, error: albumError } = await admin
      .from("albums")
      .select("id, owner_id")
      .eq("id", body.albumId)
      .maybeSingle();
    if (albumError) return fail(albumError.message, 500);
    if (!album) return fail("Album không tồn tại.", 404);
    if (album.owner_id !== user.id) return fail("Đây không phải album của bạn.", 403);

    // Token 256-bit sinh bằng CSPRNG; chỉ trả về một lần, DB chỉ lưu SHA-256.
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    const token = btoa(String.fromCharCode(...raw))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const { data: tokenHash, error: hashError } = await admin.rpc("share_token_hash", {
      p_token: token,
    });
    if (hashError || !tokenHash) return fail("Không tạo được mã chia sẻ.", 500);

    let passwordHash: string | null = null;
    if (body.password) {
      if (body.password.length < 6) {
        return fail("Mật khẩu chia sẻ cần tối thiểu 6 ký tự.");
      }
      const { data: hashed, error: passwordError } = await admin.rpc("hash_share_password", {
        p_password: body.password,
      });
      if (passwordError || !hashed) return fail("Không đặt được mật khẩu.", 500);
      passwordHash = hashed as string;
    }

    const expiresAt =
      body.expiresInDays && body.expiresInDays > 0
        ? new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString()
        : null;

    const { data: share, error: insertError } = await admin
      .from("album_shares")
      .insert({
        album_id: album.id,
        owner_id: user.id,
        token_hash: tokenHash,
        password_hash: passwordHash,
        allow_download: body.allowDownload !== false,
        expires_at: expiresAt,
      })
      .select(
        "id, album_id, owner_id, allow_download, expires_at, revoked_at, created_at, access_count, last_accessed_at, password_hash",
      )
      .single();
    if (insertError || !share) return fail(insertError?.message ?? "Không tạo được liên kết.", 500);

    return ok({
      id: share.id,
      albumId: share.album_id,
      ownerId: share.owner_id,
      token,
      allowDownload: share.allow_download,
      hasPassword: Boolean(share.password_hash),
      expiresAt: share.expires_at,
      revokedAt: share.revoked_at,
      createdAt: share.created_at,
      accessCount: share.access_count,
      lastAccessedAt: share.last_accessed_at,
    });
  }

  if (action === "list") {
    const user = await currentUser();
    if (!user) return fail("Bạn cần đăng nhập.", 401);
    const { data, error } = await admin
      .from("album_shares")
      .select(
        "id, album_id, owner_id, allow_download, expires_at, revoked_at, created_at, access_count, last_accessed_at, password_hash",
      )
      .eq("album_id", body.albumId ?? "")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });
    if (error) return fail(error.message, 500);
    return ok(
      (data ?? []).map((share) => ({
        id: share.id,
        albumId: share.album_id,
        ownerId: share.owner_id,
        token: null,
        allowDownload: share.allow_download,
        hasPassword: Boolean(share.password_hash),
        expiresAt: share.expires_at,
        revokedAt: share.revoked_at,
        createdAt: share.created_at,
        accessCount: share.access_count,
        lastAccessedAt: share.last_accessed_at,
      })),
    );
  }

  if (action === "update") {
    const user = await currentUser();
    if (!user) return fail("Bạn cần đăng nhập.", 401);
    if (!body.shareId) return fail("Thiếu shareId.");

    const { data: existing } = await admin
      .from("album_shares")
      .select("id, owner_id, password_hash, expires_at")
      .eq("id", body.shareId)
      .maybeSingle();
    if (!existing) return fail("Liên kết không tồn tại.", 404);
    if (existing.owner_id !== user.id) return fail("Đây không phải liên kết của bạn.", 403);

    const patch: Record<string, unknown> = {};
    if (typeof body.allowDownload === "boolean") patch.allow_download = body.allowDownload;

    if (body.removePassword) {
      patch.password_hash = null;
    } else if (body.password) {
      if (body.password.length < 6) return fail("Mật khẩu cần tối thiểu 6 ký tự.");
      const { data: hashed, error: passwordError } = await admin.rpc("hash_share_password", {
        p_password: body.password,
      });
      if (passwordError || !hashed) return fail("Không cập nhật được mật khẩu.", 500);
      patch.password_hash = hashed;
    }

    if (body.expiresInDays !== undefined) {
      patch.expires_at =
        body.expiresInDays && body.expiresInDays > 0
          ? new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString()
          : null;
    }

    const { data: share, error } = await admin
      .from("album_shares")
      .update(patch)
      .eq("id", body.shareId)
      .select(
        "id, album_id, owner_id, allow_download, expires_at, revoked_at, created_at, access_count, last_accessed_at, password_hash",
      )
      .single();
    if (error || !share) return fail(error?.message ?? "Không cập nhật được.", 500);

    return ok({
      id: share.id,
      albumId: share.album_id,
      ownerId: share.owner_id,
      token: null,
      allowDownload: share.allow_download,
      hasPassword: Boolean(share.password_hash),
      expiresAt: share.expires_at,
      revokedAt: share.revoked_at,
      createdAt: share.created_at,
      accessCount: share.access_count,
      lastAccessedAt: share.last_accessed_at,
    });
  }

  if (action === "revoke") {
    const user = await currentUser();
    if (!user) return fail("Bạn cần đăng nhập.", 401);
    const { error } = await admin
      .from("album_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", body.shareId ?? "")
      .eq("owner_id", user.id);
    if (error) return fail(error.message, 500);
    return ok({ ok: true });
  }

  /* ─────────────────────────────────────────────────────────────────
     Hành động của KHÁCH (dựa trên token + mật khẩu, không cần tài khoản)
     ───────────────────────────────────────────────────────────────── */

  async function verifyShare() {
    const token = body.token;
    if (!token || token.length < 20) {
      return { error: fail("Liên kết chia sẻ không hợp lệ.", 404) } as const;
    }

    const { data: tokenHash, error: hashError } = await admin.rpc("share_token_hash", {
      p_token: token,
    });
    if (hashError || !tokenHash) {
      return { error: fail("Liên kết chia sẻ không hợp lệ.", 404) } as const;
    }

    const { data: share } = await admin
      .from("album_shares")
      .select(
        "id, album_id, owner_id, allow_download, expires_at, revoked_at, password_hash, access_count",
      )
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!share) return { error: fail("Liên kết chia sẻ không hợp lệ hoặc đã bị xoá.", 404) } as const;
    if (share.revoked_at) return { error: fail("Chủ album đã thu hồi liên kết này.", 410) } as const;
    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
      return { error: fail("Liên kết chia sẻ đã hết hạn.", 410) } as const;
    }

    if (share.password_hash) {
      const { data: allowed } = await admin.rpc("share_attempt_allowed", {
        p_token_hash: tokenHash,
      });
      if (allowed === false) {
        return { error: fail("Bạn đã thử quá nhiều lần. Vui lòng chờ vài phút.", 429) } as const;
      }
      if (!body.password) {
        return { error: fail("PASSWORD_REQUIRED", 401) } as const;
      }
      const { data: matches } = await admin.rpc("share_password_matches", {
        p_share_id: share.id,
        p_password: body.password,
      });
      if (matches !== true) {
        await admin.rpc("record_share_attempt", {
          p_token_hash: tokenHash,
          p_successful: false,
        });
        return { error: fail("PASSWORD_WRONG", 401) } as const;
      }
      await admin.rpc("record_share_attempt", { p_token_hash: tokenHash, p_successful: true });
    }

    await admin
      .from("album_shares")
      .update({
        access_count: (share.access_count ?? 0) + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq("id", share.id);

    return { share, tokenHash } as const;
  }

  if (action === "resolve") {
    const verified = await verifyShare();
    if ("error" in verified) return verified.error;
    const { share } = verified;

    const { data: album } = await admin
      .from("albums")
      .select("id, title, description, cover_photo_id, photo_count, total_bytes, created_at, updated_at, owner_id")
      .eq("id", share.album_id)
      .maybeSingle();
    if (!album) return fail("Album của liên kết này không còn tồn tại.", 404);

    // Không lộ email của chủ album: chỉ trả về tên hiển thị đã ẩn một phần.
    const { data: owner } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", album.owner_id)
      .maybeSingle()
      .then((result) => result, () => ({ data: null }));

    const ownerLabel =
      owner?.display_name ??
      (await admin.auth.admin
        .getUserById(album.owner_id)
        .then(({ data }) => {
          const email = data.user?.email ?? "";
          if (!email) return "Chủ album";
          const [name, domain] = email.split("@");
          return `${name.slice(0, 2)}***@${domain ?? ""}`;
        })
        .catch(() => "Chủ album"));

    return ok({
      share: {
        id: share.id,
        albumId: share.album_id,
        allowDownload: share.allow_download,
        hasPassword: Boolean(share.password_hash),
        expiresAt: share.expires_at,
      },
      album: {
        id: album.id,
        title: album.title,
        description: album.description,
        coverPhotoId: album.cover_photo_id,
        photoCount: album.photo_count,
        totalBytes: Number(album.total_bytes ?? 0),
        createdAt: album.created_at,
        updatedAt: album.updated_at,
        ownerLabel,
      },
    });
  }

  if (action === "list-photos") {
    const verified = await verifyShare();
    if ("error" in verified) return verified.error;
    const { share } = verified;

    const limit = Math.min(Math.max(body.limit ?? 60, 1), 200);
    const sort = body.sort ?? "uploaded-desc";
    const orderColumn = sort === "filename-asc" ? "filename_key" : "created_at";
    const ascending = sort === "uploaded-asc" || sort === "filename-asc";

    let query = admin
      .from("photos")
      .select(
        "id, album_id, owner_id, original_filename, storage_path, thumbnail_path, mime_type, file_size, width, height, checksum, previewable, created_at, filename_key",
        { count: "exact" },
      )
      .eq("album_id", share.album_id);

    if (body.cursor) {
      // Con trỏ dạng <khoá sắp xếp>|<id> đã mã hoá base64url ở client; ở đây ta
      // nhận đúng chuỗi khoá để dựng điều kiện keyset.
      const [key, id] = decodeCursor(body.cursor);
      if (key && id) {
        const operator = ascending ? "gt" : "lt";
        query = query.or(
          `${orderColumn}.${operator}.${key},and(${orderColumn}.eq.${key},id.${operator}.${id})`,
        );
      }
    }

    const { data, error, count } = await query
      .order(orderColumn, { ascending })
      .order("id", { ascending })
      .limit(limit + 1);
    if (error) return fail(error.message, 500);

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return ok({
      items: page.map(toPhotoDto),
      nextCursor:
        hasMore && last
          ? encodeCursor(
              orderColumn === "filename_key"
                ? (last as Record<string, string>).filename_key
                : (last as Record<string, string>).created_at,
              (last as Record<string, string>).id,
            )
          : null,
      total: count ?? undefined,
    });
  }

  if (action === "urls") {
    const verified = await verifyShare();
    if ("error" in verified) return verified.error;
    const { share } = verified;

    const photoIds = body.photoIds ?? [];
    if (photoIds.length === 0 || photoIds.length > 200) {
      return fail("Danh sách ảnh không hợp lệ.");
    }

    // Chỉ ký cho ảnh thuộc đúng album của liên kết — không tin đường dẫn từ client.
    const { data: rows, error } = await admin
      .from("photos")
      .select("id, storage_path, thumbnail_path")
      .eq("album_id", share.album_id)
      .in("id", photoIds);
    if (error) return fail(error.message, 500);

    const result: Record<string, string> = {};
    const useThumbnail = body.purpose !== "original";

    for (const row of rows ?? []) {
      const path =
        useThumbnail && row.thumbnail_path ? row.thumbnail_path : row.storage_path;
      const bucket = useThumbnail && row.thumbnail_path ? THUMBNAILS_BUCKET : ORIGINALS_BUCKET;
      const { data: signed } = await admin.storage
        .from(bucket)
        .createSignedUrl(path, URL_TTL_SECONDS);
      if (signed?.signedUrl) result[row.id] = signed.signedUrl;
    }
    return ok(result);
  }

  if (action === "download-url") {
    const verified = await verifyShare();
    if ("error" in verified) return verified.error;
    const { share } = verified;

    if (!share.allow_download) {
      return fail("Chủ album không cho phép tải xuống liên kết này.", 403);
    }
    if (!body.photoId) return fail("Thiếu photoId.");

    const { data: row } = await admin
      .from("photos")
      .select("id, album_id, storage_path, original_filename")
      .eq("id", body.photoId)
      .eq("album_id", share.album_id)
      .maybeSingle();
    if (!row) return fail("Ảnh không thuộc album được chia sẻ.", 404);

    const { data: signed, error } = await admin.storage
      .from(ORIGINALS_BUCKET)
      .createSignedUrl(row.storage_path, DOWNLOAD_TTL_SECONDS, {
        download: body.filename || row.original_filename,
      });
    if (error || !signed?.signedUrl) {
      return fail(error?.message ?? "Không tạo được liên kết tải xuống.", 500);
    }
    return ok({ url: signed.signedUrl });
  }

  return fail(`Hành động không được hỗ trợ: ${action}`, 400);
});

/* ── Tiện ích ───────────────────────────────────────────────────────── */

interface PhotoRowLike {
  id: string;
  album_id: string;
  owner_id: string;
  original_filename: string;
  storage_path: string;
  thumbnail_path: string | null;
  mime_type: string;
  file_size: number | string;
  width: number | null;
  height: number | null;
  checksum: string | null;
  previewable: boolean | null;
  created_at: string;
}

function toPhotoDto(row: PhotoRowLike) {
  return {
    id: row.id,
    albumId: row.album_id,
    ownerId: row.owner_id,
    originalFilename: row.original_filename,
    storagePath: row.storage_path,
    thumbnailPath: row.thumbnail_path,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size ?? 0),
    width: row.width,
    height: row.height,
    checksum: row.checksum,
    previewable: row.previewable ?? true,
    createdAt: row.created_at,
  };
}

function encodeCursor(key: string, id: string): string {
  const raw = `${key}\u001f${id}`;
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(cursor: string): [string | null, string | null] {
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    const [key, id] = raw.split("\u001f");
    return [key ?? null, id ?? null];
  } catch {
    return [null, null];
  }
}
