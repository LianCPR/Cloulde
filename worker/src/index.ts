/**
 * Router của Worker Cloudflare.
 *
 * Đây là toàn bộ backend của kho ảnh: xác thực, metadata (D1), lưu trữ (R2) và
 * chia sẻ. Không có server Node nào, không có tiến trình nền, không có tệp nào
 * được ghi cục bộ.
 *
 * Thứ tự xử lý một request:
 *   1. CORS (chỉ cần khi phát triển, vì lúc chạy thật SPA cùng origin).
 *   2. `/dl/...` — URL có chữ ký, KHÔNG cần bearer token (chính chữ ký là quyền).
 *   3. `/api/shared/...` — dành cho khách, xác thực bằng token chia sẻ.
 *   4. `/api/...` còn lại — bắt buộc bearer token của chủ kho.
 *   5. Còn lại — phục vụ SPA tĩnh.
 */

import { readConfig } from "./config";
import type { Ctx } from "./context";
import type { Env } from "./env";
import { errorResponse, HttpError, json, requireOwner } from "./lib/http";
import { createStorage } from "./storage";
import {
  attachThumbnail,
  abortUploadSession,
  completeUploadSession,
  createUploadSession,
  getUploadSession,
  listUploadSessions,
  runMaintenance,
  uploadPart,
} from "./routes/uploads";
import {
  createAlbumRoute,
  createDownloadLink,
  createDownloadLinks,
  deleteAlbumRoute,
  deletePhotoRoute,
  downloadOriginalRoute,
  getAlbumRoute,
  getPhotoRoute,
  healthRoute,
  listAlbumsRoute,
  listPhotosRoute,
  streamThumbnail,
  updateAlbumRoute,
  usageRoute,
} from "./routes/gallery";
import {
  createSharePhotoLink,
  createShareRoute,
  listSharePhotosRoute,
  listSharesRoute,
  resolveShareRoute,
  revokeShareRoute,
  serveSignedDownload,
  updateShareRoute,
  type PublicCtx,
} from "./routes/shares";

/**
 * Origin dùng khi chưa cấu hình `ALLOWED_ORIGINS` — chỉ đủ cho phát triển cục bộ.
 * Khi triển khai tách origin (SPA trên Vercel + API trên Cloudflare) PHẢI đặt
 * `ALLOWED_ORIGINS` thành tên miền thật, nếu không trình duyệt — kể cả trình duyệt
 * của khách mở liên kết chia sẻ — sẽ bị chặn ở tầng CORS.
 */
const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
];

/** Đọc danh sách origin cho phép từ cấu hình; bỏ dấu `/` cuối để so khớp đúng. */
function allowedOrigins(env: Env): string[] {
  const configured = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return configured.length > 0 ? configured : DEV_ORIGINS;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  // Chỉ echo origin nằm trong danh sách cho phép. Cùng origin thì không cần CORS.
  const allowed = allowedOrigins(env).includes(origin.replace(/\/+$/, "")) ? origin : null;
  if (!allowed) return {};
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "3600",
    vary: "origin",
  };
}

/**
 * Header an toàn áp cho MỌI phản hồi của Worker.
 *
 * Cần thiết vì khi Worker phục vụ luôn trang web thì không còn lớp cấu hình nào
 * khác (như `vercel.json`) đặt header hộ. Giá trị giống hệt `vercel.json` để hai
 * cách triển khai không lệch nhau về bảo mật.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "SAMEORIGIN",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

/**
 * Liên kết chia sẻ có bị máy tìm kiếm đánh chỉ mục không?
 *
 * TUYỆT ĐỐI KHÔNG được. Token trong URL CHÍNH LÀ quyền truy cập album: nếu Google
 * đánh chỉ mục `/share/<token>` thì album riêng tư trở thành công khai qua kết quả
 * tìm kiếm. Vì vậy mọi phản hồi cho đường này đều mang `X-Robots-Tag: noindex`,
 * kèm `noindex` đặt ở phía giao diện (thẻ meta) để cả hai lớp đều có.
 */
function isSharePath(pathname: string): boolean {
  return pathname === "/share" || pathname.startsWith("/share/");
}

function withBaseHeaders(response: Response, request: Request, env: Env, url: URL): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) headers.set(key, value);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  if (isSharePath(url.pathname)) {
    headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  }
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const config = readConfig(env);
    const storage = createStorage(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      const response = await handle(request, env, url, config, storage);
      return withBaseHeaders(response, request, env, url);
    } catch (error) {
      return withBaseHeaders(errorResponse(error), request, env, url);
    }
  },

  /**
   * Cron Trigger: dọn phiên bỏ dở và chạy hàng đợi xác minh checksum.
   * Nếu chưa cấu hình Cron Trigger, gọi `POST /api/maintenance/run` cũng cho
   * kết quả y hệt — chức năng không phụ thuộc vào việc bạn có bật cron hay không.
   */
  async scheduled(_event: ScheduledController, env: Env, execCtx: ExecutionContext): Promise<void> {
    const config = readConfig(env);
    const storage = createStorage(env);
    const owners = await env.DB.prepare(
      "select owner_id from albums union select owner_id from photos",
    ).all<{ owner_id: string }>();

    for (const row of owners.results ?? []) {
      const ctx: Ctx = {
        request: new Request("https://internal/maintenance", { method: "POST" }),
        env,
        config,
        storage,
        ownerId: row.owner_id,
        url: new URL("https://internal/api/maintenance/run"),
      };
      execCtx.waitUntil(runMaintenance(ctx).then(() => undefined));
    }
  },
} satisfies ExportedHandler<Env>;

async function handle(
  request: Request,
  env: Env,
  url: URL,
  config: ReturnType<typeof readConfig>,
  storage: ReturnType<typeof createStorage>,
): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  /* ── URL có chữ ký: quyền nằm trong chữ ký, không cần token ─────────── */
  if (path.startsWith("/dl/")) {
    const publicCtx: PublicCtx = { request, env, config, storage, url };
    return serveSignedDownload(publicCtx, decodeURIComponent(path.slice(4)));
  }

  /* ── Đường của khách (token chia sẻ) ───────────────────────────────── */
  const sharedMatch = /^\/api\/shared\/([^/]+)\/(resolve|photos|link)$/.exec(path);
  if (sharedMatch) {
    const token = decodeURIComponent(sharedMatch[1]);
    const publicCtx: PublicCtx = { request, env, config, storage, url };
    if (method !== "POST") throw new HttpError(405, "Chỉ hỗ trợ POST.");
    if (sharedMatch[2] === "resolve") return resolveShareRoute(publicCtx, token);
    if (sharedMatch[2] === "photos") return listSharePhotosRoute(publicCtx, token);
    return createSharePhotoLink(publicCtx, token);
  }

  /* ── Mọi đường /api khác đều cần xác thực chủ kho ──────────────────── */
  if (path.startsWith("/api/")) {
    const ownerId = await requireOwner(request, env);
    const ctx: Ctx = { request, env, config, storage, ownerId, url };

    // Uploads
    if (path === "/api/uploads" && method === "POST") return createUploadSession(ctx);
    if (path === "/api/uploads" && method === "GET") return listUploadSessions(ctx);

    const partMatch = /^\/api\/uploads\/([^/]+)\/parts\/(\d+)$/.exec(path);
    if (partMatch && method === "PUT") return uploadPart(ctx, partMatch[1], partMatch[2]);

    const completeMatch = /^\/api\/uploads\/([^/]+)\/complete$/.exec(path);
    if (completeMatch && method === "POST") return completeUploadSession(ctx, completeMatch[1]);

    const abortMatch = /^\/api\/uploads\/([^/]+)\/(abort)?$/.exec(path);
    if (abortMatch && (method === "POST" || method === "DELETE")) {
      return abortUploadSession(ctx, abortMatch[1]);
    }

    const sessionMatch = /^\/api\/uploads\/([^/]+)$/.exec(path);
    if (sessionMatch && method === "GET") return getUploadSession(ctx, sessionMatch[1]);

    // Albums
    if (path === "/api/albums" && method === "GET") return listAlbumsRoute(ctx);
    if (path === "/api/albums" && method === "POST") return createAlbumRoute(ctx);

    const albumPhotosMatch = /^\/api\/albums\/([^/]+)\/photos$/.exec(path);
    if (albumPhotosMatch && method === "GET") return listPhotosRoute(ctx, albumPhotosMatch[1]);

    const albumSharesMatch = /^\/api\/albums\/([^/]+)\/shares$/.exec(path);
    if (albumSharesMatch) {
      if (method === "GET") return listSharesRoute(ctx, albumSharesMatch[1]);
      if (method === "POST") return createShareRoute(ctx, albumSharesMatch[1]);
    }

    const albumMatch = /^\/api\/albums\/([^/]+)$/.exec(path);
    if (albumMatch) {
      if (method === "GET") return getAlbumRoute(ctx, albumMatch[1]);
      if (method === "PATCH") return updateAlbumRoute(ctx, albumMatch[1]);
      if (method === "DELETE") return deleteAlbumRoute(ctx, albumMatch[1]);
    }

    // Shares
    const shareMatch = /^\/api\/shares\/([^/]+)$/.exec(path);
    if (shareMatch) {
      if (method === "PATCH") return updateShareRoute(ctx, shareMatch[1]);
      if (method === "DELETE") return revokeShareRoute(ctx, shareMatch[1]);
    }

    // Photos
    const photoOriginalMatch = /^\/api\/photos\/([^/]+)\/original$/.exec(path);
    if (photoOriginalMatch && method === "GET") return downloadOriginalRoute(ctx, photoOriginalMatch[1]);

    const photoThumbMatch = /^\/api\/photos\/([^/]+)\/thumb$/.exec(path);
    if (photoThumbMatch && method === "GET") return streamThumbnail(ctx, photoThumbMatch[1]);

    // Đặt TRƯỚC nhóm `photos/:id` để "/api/photos/links" không bị hiểu là id.
    if (path === "/api/photos/links" && method === "POST") return createDownloadLinks(ctx);

    const photoLinkMatch = /^\/api\/photos\/([^/]+)\/link$/.exec(path);
    if (photoLinkMatch && method === "POST") return createDownloadLink(ctx, photoLinkMatch[1]);

    const photoThumbPutMatch = /^\/api\/photos\/([^/]+)\/thumbnail$/.exec(path);
    if (photoThumbPutMatch && method === "POST") return attachThumbnail(ctx, photoThumbPutMatch[1]);

    const photoMatch = /^\/api\/photos\/([^/]+)$/.exec(path);
    if (photoMatch) {
      if (method === "GET") return getPhotoRoute(ctx, photoMatch[1]);
      if (method === "DELETE") return deletePhotoRoute(ctx, photoMatch[1]);
    }

    // Vận hành
    if (path === "/api/usage" && method === "GET") return usageRoute(ctx);
    if (path === "/api/health" && method === "GET") return healthRoute(ctx);
    if (path === "/api/maintenance/run" && method === "POST") return runMaintenance(ctx);

    throw new HttpError(404, `Không có route cho ${method} ${path}.`);
  }

  /* ── Còn lại: phục vụ SPA tĩnh (nếu Worker được gắn assets) ─────────── */
  if (env.ASSETS) {
    return env.ASSETS.fetch(request);
  }
  return json({ error: "Không tìm thấy tài nguyên.", path }, { status: 404 });
}
