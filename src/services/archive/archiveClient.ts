/**
 * HTTP client cho kho lưu trữ Cloudflare (Worker + R2 + D1).
 *
 * Quy tắc bảo mật của tệp này:
 *   • KHÔNG có khoá truy cập R2/S3 nào ở đây. Trình duyệt chỉ nói chuyện với
 *     Worker của chính mình; Worker giữ khoá và nói chuyện với R2.
 *   • Danh tính chủ kho đến từ MỘT trong hai nguồn: cookie của Cloudflare Access
 *     (khuyến nghị) hoặc bearer token do người dùng tự dán vào.
 *   • Không log token, không đưa token vào URL (chỉ trong header Authorization).
 */

import { ARCHIVE_URL } from "@/config/env";
import {
  readArchiveConnection,
  type ArchiveConnection,
} from "./connectionStore";

export class ArchiveError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly payload: unknown;

  constructor(status: number, message: string, code: string | null, payload: unknown) {
    super(message);
    this.name = "ArchiveError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

/** Ảnh trùng nội dung — bị chặn TRƯỚC khi truyền byte nào. */
export function isDuplicateError(error: unknown): boolean {
  return error instanceof ArchiveError && error.code === "duplicate";
}

/** Phiên tải lên không còn hiệu lực (đã huỷ, đã xong hoặc hết hạn). */
export function isSessionGoneError(error: unknown): boolean {
  return error instanceof ArchiveError && (error.status === 404 || error.status === 409);
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ArchiveError && error.status === 401;
}

/**
 * Kết nối đang có hiệu lực.
 *
 * Nếu ĐÃ có kết nối được lưu thì tôn trọng nó tuyệt đối — KỂ CẢ khi `baseUrl`
 * là chuỗi rỗng, vì chuỗi rỗng là một LỰA CHỌN có nghĩa: "Worker phục vụ luôn
 * trang này (cùng origin)". Chỉ khi chưa có kết nối nào mới lấy
 * `VITE_ARCHIVE_URL` làm mặc định.
 */
function activeConnection(): ArchiveConnection {
  return readArchiveConnection() ?? { baseUrl: ARCHIVE_URL, token: null, label: null, verifiedAt: null };
}

/**
 * Gốc của kho lưu trữ đang dùng.
 *
 * Chuỗi rỗng = cùng origin. KHÔNG được thay bằng `ARCHIVE_URL` ở bước này:
 * làm vậy sẽ lặng lẽ bỏ qua lựa chọn "để trống" mà màn hình /connect hứa với
 * người dùng, và request sẽ đi tới nhầm máy chủ.
 */
export function archiveBaseUrl(): string {
  return activeConnection().baseUrl;
}

export function archiveToken(): string | null {
  return activeConnection().token;
}

export function archiveUrl(path: string): string {
  return `${archiveBaseUrl()}${path}`;
}

function authHeaders(): HeadersInit {
  const token = archiveToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

interface RequestOptions {
  method?: string;
  json?: unknown;
  body?: BodyInit;
  headers?: HeadersInit;
  /** Cho phép yêu cầu không cần danh tính (đường của khách). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

/**
 * Gọi API và trả về JSON.
 *
 * Lỗi được dịch thành `ArchiveError` với thông điệp tiếng Việt đọc được, và giữ
 * nguyên mã `code` của server để tầng trên phân biệt được trùng nội dung, thiếu
 * mật khẩu, hết hạn…
 */
export async function archiveJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await archiveFetch(path, options);
  const text = await response.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ArchiveError(response.status, "Phản hồi không phải JSON hợp lệ.", null, text.slice(0, 200));
  }
}

export async function archiveFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  if (!options.anonymous) for (const [key, value] of Object.entries(authHeaders())) headers.set(key, value);
  let body = options.body;
  if (options.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.json);
  }

  let response: Response;
  try {
    response = await fetch(archiveUrl(path), {
      method: options.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      signal: options.signal,
      // Cookie của Cloudflare Access phải được gửi kèm khi Worker ở origin khác.
      credentials: archiveBaseUrl() ? "include" : "same-origin",
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ArchiveError(
      0,
      "Không kết nối được tới kho lưu trữ. Kiểm tra mạng hoặc địa chỉ Worker.",
      "network",
      error,
    );
  }

  if (!response.ok) throw await toArchiveError(response);
  return response;
}

async function toArchiveError(response: Response): Promise<ArchiveError> {
  let payload: unknown = null;
  let message = `Lỗi ${response.status} từ kho lưu trữ.`;
  let code: string | null = null;
  try {
    const text = await response.text();
    payload = text ? JSON.parse(text) : null;
    const record = payload as { error?: unknown; message?: unknown; code?: unknown } | null;
    const raw = record?.error ?? record?.message;
    if (typeof raw === "string" && raw.trim()) message = raw;
    if (typeof record?.code === "string") code = record.code;
  } catch {
    // Giữ thông điệp mặc định.
  }
  if (response.status === 401) {
    message =
      "Chưa xác thực được với kho lưu trữ. Kiểm tra token chủ kho, hoặc đăng nhập lại nếu dùng Cloudflare Access.";
  }
  return new ArchiveError(response.status, message, code, payload);
}

export interface ArchiveProbe {
  ok: boolean;
  ownerId: string;
  driver: string;
  uploadMode: string;
  originalsWritable: boolean;
  thumbnailsWritable: boolean;
  pendingJobs: number;
  activeSessions: number;
}

/** Gọi `/api/health` — thử GHI/ĐỌC/XOÁ object thật, không phải ping suông. */
export async function probeArchive(options: RequestOptions = {}): Promise<ArchiveProbe> {
  const health = await archiveJson<{
    ok: boolean;
    ownerId: string;
    storage: { driver: string; uploadMode: string; originalsWritable: boolean; thumbnailsWritable: boolean };
    queue: { pendingJobs: number };
    uploads: { activeSessions: number };
  }>("/api/health", options);
  return {
    ok: health.ok,
    ownerId: health.ownerId,
    driver: health.storage.driver,
    uploadMode: health.storage.uploadMode,
    originalsWritable: health.storage.originalsWritable,
    thumbnailsWritable: health.storage.thumbnailsWritable,
    pendingJobs: health.queue.pendingJobs,
    activeSessions: health.uploads.activeSessions,
  };
}

/** Tải một URL có chữ ký (đường `/dl/...`) thành Blob nguyên byte. */
export async function fetchSignedBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(archiveUrl(url), { signal, cache: "no-store" });
  if (!response.ok) {
    throw new ArchiveError(response.status, `Không tải được tệp từ kho lưu trữ (${response.status}).`, null, null);
  }
  return response.blob();
}
