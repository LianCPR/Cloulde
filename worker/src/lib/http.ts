/**
 * Tiện ích HTTP cho Worker: phản hồi JSON, lỗi có mã trạng thái, xác thực chủ
 * kho, và con trỏ phân trang.
 *
 * Phân trang dùng KEYSET (so sánh khoá) chứ không dùng OFFSET: với hàng chục
 * nghìn ảnh, OFFSET buộc SQLite quét và bỏ qua N hàng ở mỗi trang, càng về sau
 * càng chậm. Keyset chỉ đọc đúng trang cần, nhờ index.
 */

import type { Env } from "../env";
import { hasAccessConfig, verifyAccessRequest } from "./access";
import { constantTimeEqual, sha256Hex } from "./crypto";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const NO_STORE = {
  // Mọi phản hồi riêng tư đều phải chặn cache trung gian.
  "cache-control": "private, no-store",
} as const;

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...NO_STORE,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message, code: error.code ?? null }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Lỗi không xác định.";
  // Lỗi nội bộ: giữ thông báo ngắn gọn cho client, nhưng ghi log đầy đủ.
  console.error("Lỗi Worker:", error);
  return json({ error: message }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Thân yêu cầu không phải JSON hợp lệ.");
  }
}

export function requireString(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `Thiếu trường bắt buộc: ${field}.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `Trường ${field} quá dài.`);
  }
  return trimmed;
}

export function requireInteger(value: unknown, field: string, min: number, max: number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `Trường ${field} phải là số nguyên trong khoảng ${min}–${max}.`);
  }
  return parsed;
}

/** Định danh chủ kho, suy ra từ chính token — ổn định và không cần bảng riêng. */
export async function ownerIdFor(token: string): Promise<string> {
  return `own_${(await sha256Hex(token)).slice(0, 16)}`;
}

/**
 * Xác thực chủ kho.
 *
 * Có HAI cách, theo thứ tự:
 *   1. Bearer token khớp `ARCHIVE_TOKEN` — so sánh theo thời gian hằng số.
 *   2. Danh tính do Cloudflare Access cấp: JWT ở header `Cf-Access-Jwt-Assertion`
 *      được XÁC MINH CHỮ KÝ RS256 trước khi tin (xem `lib/access.ts`). Đây là
 *      cách khuyến nghị cho môi trường thật vì không có token nào nằm trong
 *      trình duyệt. Chỉ có header thôi là KHÔNG đủ: chữ ký sai thì bị từ chối.
 *
 * Không có cách nào hợp lệ thì KHÔNG trả về bất kỳ dữ liệu nào.
 */
export async function requireOwner(request: Request, env: Env): Promise<string> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim() ?? "";
  const expected = (env.ARCHIVE_TOKEN ?? "").trim();

  // 1. Token chủ kho.
  if (expected && token && constantTimeEqual(token, expected)) {
    return ownerIdFor(token);
  }

  // 2. Danh tính Cloudflare Access (đã xác minh chữ ký).
  const identity = await verifyAccessRequest(request, env);
  if (identity) return ownerIdFor(identity.subject);

  // Chưa cấu hình cách nào: nói rõ cần đặt gì, thay vì lỗi mơ hồ.
  if (!expected && !hasAccessConfig(env)) {
    throw new HttpError(
      401,
      "Worker chưa cấu hình danh tính chủ kho. Hãy đặt ARCHIVE_TOKEN, hoặc đặt CF_ACCESS_TEAM_DOMAIN và CF_ACCESS_AUD để dùng Cloudflare Access.",
      "not_configured",
    );
  }
  throw new HttpError(401, "Cần xác thực chủ kho.", "unauthorized");
}

/* ── Con trỏ phân trang ─────────────────────────────────────────────────── */

export interface Cursor {
  key: string;
  id: string;
}

export function encodeCursor(key: string, id: string): string {
  return btoa(`${key}\u001f${id}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    const [key, id] = decoded.split("\u001f");
    return key && id ? { key, id } : null;
  } catch {
    return null;
  }
}

export function pageLimit(raw: string | null, fallback = 60, max = 200): number {
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

/** Chỉ cho phép các giá trị sắp xếp đã biết — chống SQL injection qua ORDER BY. */
export function pickSort<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}
