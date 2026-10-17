/**
 * Tiện ích mã hoá dùng WebCrypto (có sẵn trong workerd).
 *
 * Ghi chú triển khai: `node:crypto` với `createHash` cũng chạy được trong
 * workerd khi bật `nodejs_compat`, và QUAN TRỌNG là nó băm theo luồng — nhờ vậy
 * xác minh SHA-256 một tệp 500 MB không cần giữ cả tệp trong RAM (trần bộ nhớ
 * của Worker là 128 MB). Xem `hashObjectStream`.
 */

const encoder = new TextEncoder();

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

/** Băm ảnh gốc theo LUỒNG — bộ nhớ không đổi với tệp hàng trăm MB. */
export async function hashObjectStream(
  body: ReadableStream<Uint8Array>,
): Promise<{ hex: string; bytes: number }> {
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256");
  let bytes = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      hash.update(value);
      bytes += value.byteLength;
    }
  }
  return { hex: hash.digest("hex") as string, bytes };
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Token ngẫu nhiên 256-bit, dùng CSPRNG của nền tảng. */
export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** So sánh chuỗi theo thời gian hằng số — chống dò đoán qua thời gian phản hồi. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  // Luôn so sánh trên cùng độ dài để không lộ thông tin qua thời gian.
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToHex(new Uint8Array(signature));
}

/**
 * Băm mật khẩu chia sẻ bằng PBKDF2-HMAC-SHA256.
 *
 * Vì sao không dùng SHA-256 trần: mật khẩu do người dùng đặt có entropy thấp,
 * nên cần hàm băm CHẬM. PBKDF2 là hàm băm chậm duy nhất có sẵn trong WebCrypto
 * (workerd không có bcrypt), và đây là lựa chọn đúng cho ràng buộc đó.
 */
const PBKDF2_ITERATIONS = 210_000;

export interface PasswordHash {
  hash: string;
  salt: string;
  iterations: number;
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const bits = await derivePasswordBits(password, salt, PBKDF2_ITERATIONS);
  return {
    hash: bytesToHex(new Uint8Array(bits)),
    salt: bytesToHex(salt),
    iterations: PBKDF2_ITERATIONS,
  };
}

async function derivePasswordBits(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
}

export async function verifyPassword(
  password: string,
  stored: PasswordHash,
): Promise<boolean> {
  const bits = await derivePasswordBits(password, hexToBytes(stored.salt), stored.iterations);
  return constantTimeEqual(bytesToHex(new Uint8Array(bits)), stored.hash);
}
