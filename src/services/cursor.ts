/**
 * Phân trang bằng con trỏ (keyset pagination).
 *
 * Không dùng OFFSET: với hàng chục nghìn ảnh, OFFSET khiến cơ sở dữ liệu phải
 * quét và bỏ qua toàn bộ các bản ghi trước đó. Con trỏ chỉ chứa khoá của bản
 * ghi cuối cùng nên chi phí mỗi trang là hằng số.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(value: string): string {
  const bytes = encoder.encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return decoder.decode(bytes);
}

export interface CursorPayload {
  /** Khoá chính dùng để sắp xếp (thường là createdAt). */
  key: string;
  /** Khoá phụ để phá thế bằng (thường là id). */
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return toBase64Url(`${payload.key}\u001f${payload.id}`);
}

export function decodeCursor(cursor: string | null | undefined): CursorPayload | null {
  if (!cursor) return null;
  try {
    const raw = fromBase64Url(cursor);
    const [key, id] = raw.split("\u001f");
    if (!key || !id) return null;
    return { key, id };
  } catch {
    return null;
  }
}

/** Khoá sắp xếp ổn định: `<thời gian>|<id>` và bản đảo cho chiều giảm dần. */
export function buildSortKeys(
  createdAt: string,
  id: string,
): { sortKeyAsc: string; sortKeyDesc: string } {
  const time = new Date(createdAt).getTime().toString().padStart(15, "0");
  const ascending = `${time}|${id}`;
  // Đảo bit để chiều giảm dần vẫn dùng được index theo thứ tự tăng.
  const inverted = (999999999999999 - Number(time))
    .toString()
    .padStart(15, "0");
  return { sortKeyAsc: ascending, sortKeyDesc: `${inverted}|${id}` };
}
