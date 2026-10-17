/**
 * Đọc và chuẩn hoá biến môi trường.
 *
 * Quy tắc quan trọng: ứng dụng phải chạy được ngay cả khi chưa có Supabase.
 * Khi thiếu cấu hình, ta chuyển sang backend `local` (IndexedDB) và hiển thị
 * thông báo hướng dẫn thiết lập — không bao giờ ném lỗi trắng trang.
 */

import { hasSavedArchiveConnection } from "@/services/archive/connectionStore";

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  const raw = readString(value);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const env = import.meta.env;

export const SUPABASE_URL = readString(env.VITE_SUPABASE_URL);
export const SUPABASE_ANON_KEY = readString(env.VITE_SUPABASE_ANON_KEY);

/** Supabase chỉ được coi là "đã cấu hình" khi cả URL và anon key hợp lệ. */
export const hasSupabaseCredentials = Boolean(
  SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    /^https?:\/\//.test(SUPABASE_URL) &&
    !SUPABASE_URL.includes("your-project-ref") &&
    !SUPABASE_ANON_KEY.includes("your-anon"),
);

const requestedBackend = readString(env.VITE_BACKEND).toLowerCase();

/**
 * Gốc của Worker kho lưu trữ (R2).
 * Để trống nghĩa là dùng cùng origin — trường hợp phổ biến khi Worker vừa phục
 * vụ SPA vừa phục vụ API, nên không bao giờ lệch origin.
 */
export const ARCHIVE_URL = readString(env.VITE_ARCHIVE_URL);

/** Đã có kết nối kho lưu trữ được lưu trên máy người dùng chưa. */
const savedArchiveConnection = hasSavedArchiveConnection();

export const hasArchiveConfiguration = Boolean(ARCHIVE_URL) || savedArchiveConnection;

/**
 * Backend đang hoạt động.
 * - `archive`: kho riêng trên Cloudflare (R2 + D1) — dùng cho ảnh gốc tới hàng trăm MB.
 * - `supabase`: lưu trữ thật trên Supabase (Postgres + Storage + Auth).
 * - `local`: backend IndexedDB nội bộ dùng cho phát triển/demo khi chưa có khoá.
 *
 * Thứ tự ưu tiên: lựa chọn TƯỜNG MINH trong VITE_BACKEND trước, sau đó tự nhận
 * diện. Chỉ tự nhận diện kho lưu trữ khi đã có cấu hình/kết nối thật.
 */
export const BACKEND: "supabase" | "local" | "archive" =
  requestedBackend === "local"
    ? "local"
    : requestedBackend === "supabase"
      ? "supabase"
      : requestedBackend === "archive"
        ? "archive"
        : hasArchiveConfiguration
          ? "archive"
          : hasSupabaseCredentials
            ? "supabase"
            : "local";

export const BUCKETS = {
  originals: readString(env.VITE_ORIGINALS_BUCKET, "photo-originals"),
  thumbnails: readString(env.VITE_THUMBNAILS_BUCKET, "photo-thumbnails"),
  archives: readString(env.VITE_ARCHIVES_BUCKET, "photo-archives"),
} as const;

/** Giới hạn tải lên mặc định 50MB — đúng mức tối đa của gói Supabase Free. */
export const MAX_UPLOAD_BYTES = readNumber(
  env.VITE_MAX_UPLOAD_BYTES,
  50 * 1024 * 1024,
);

/**
 * Trần kích thước MỘT tệp ở chế độ kho lưu trữ.
 *
 * Con số này KHÔNG phải hạn mức do ứng dụng đặt ra: nó suy ra từ giới hạn thật
 * của R2 (tối đa 10.000 phần, mỗi phần tối đa 64 MiB) và có thể ghi đè bằng
 * biến môi trường. Không có tổng dung lượng, không có số ảnh tối đa.
 */
export const ARCHIVE_MAX_FILE_BYTES = readNumber(
  env.VITE_ARCHIVE_MAX_FILE_BYTES,
  64 * 1024 * 1024 * 9_999,
);

/** Giới hạn kích thước tệp áp dụng cho backend đang chạy. */
export const uploadLimitBytes =
  BACKEND === "archive" ? ARCHIVE_MAX_FILE_BYTES : MAX_UPLOAD_BYTES;

export const UPLOAD_CONCURRENCY = Math.min(
  Math.max(readNumber(env.VITE_UPLOAD_CONCURRENCY, 3), 1),
  8,
);

export const DOWNLOAD_CONCURRENCY = Math.min(
  Math.max(readNumber(env.VITE_DOWNLOAD_CONCURRENCY, 4), 1),
  8,
);

export const ZIP_WARN_BYTES = readNumber(
  env.VITE_ZIP_WARN_BYTES,
  1024 * 1024 * 1024,
);
export const ZIP_MAX_BYTES = readNumber(
  env.VITE_ZIP_MAX_BYTES,
  4 * 1024 * 1024 * 1024,
);
export const ZIP_MAX_FILES = readNumber(env.VITE_ZIP_MAX_FILES, 2000);

export const SHARE_FUNCTION_NAME = readString(env.VITE_SHARE_FUNCTION, "share");

export const APP_NAME = "Cloudé";

/** Thời hạn signed URL cho ảnh xem trước / tải về (giây). */
export const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 giờ
export const SIGNED_URL_TTL_SHORT = 60 * 5; // 5 phút cho tải xuống

export const isLocalBackend = BACKEND === "local";
