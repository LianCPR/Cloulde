/**
 * Ticket có chữ ký, có thời hạn.
 *
 * Dùng cho URL tải xuống: server không thể "ký" URL kiểu S3 khi đi qua binding
 * R2, nên thay vào đó URL mang một ticket HMAC ngắn hạn. Ticket:
 *   • chỉ chứa định danh + hạn dùng + phạm vi, KHÔNG chứa thông tin bí mật;
 *   • bị ràng buộc vào đúng một phạm vi (`scope`) để không dùng chéo được —
 *     link của chủ kho không thể biến thành link của một liên kết chia sẻ;
 *   • hết hạn theo thời gian và được kiểm tra theo thời gian hằng số.
 *
 * Đây là dạng "quyền tải ngắn hạn" mà trình duyệt nhận được: nó KHÔNG bao giờ
 * chứa khoá API, và chỉ mở đúng một đối tượng trong một khoảng thời gian.
 */

import { constantTimeEqual, hmacSha256Hex } from "./crypto";

export interface TicketPayload {
  /** Phạm vi: `owner:<id>` hoặc `share:<shareId>`. */
  scope: string;
  /** Đối tượng được phép truy cập. */
  subject: string;
  /** Hạn dùng, epoch giây. */
  exp: number;
}

function serialise(payload: TicketPayload): string {
  return `${payload.scope}|${payload.subject}|${payload.exp}`;
}

export async function signTicket(secret: string, payload: TicketPayload): Promise<string> {
  return hmacSha256Hex(secret, serialise(payload));
}

export async function verifyTicket(
  secret: string,
  payload: TicketPayload,
  signature: string,
): Promise<void> {
  const expected = await signTicket(secret, payload);
  if (!constantTimeEqual(expected, signature)) {
    throw new Error("Chữ ký không hợp lệ.");
  }
  if (payload.exp * 1000 < Date.now()) {
    throw new Error("Liên kết đã hết hạn.");
  }
}

export function parseExpiry(raw: string | null): number {
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}
