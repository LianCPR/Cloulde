/**
 * SHA-256 chạy theo luồng (streaming) trên Web Crypto không hỗ trợ API
 * incremental, nên ta tự cài đặt thuật toán để có thể băm tệp vài trăm MB mà
 * không cần nạp toàn bộ vào bộ nhớ.
 *
 * Dùng để:
 *  - Kiểm tra toàn vẹn sau khi tải lên và sau khi tải xuống.
 *  - Phát hiện tải lên trùng lặp (cùng nội dung).
 * Không ảnh hưởng tới dữ liệu ảnh: chỉ đọc, không sửa byte nào.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

class Sha256 {
  private h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  private buffer = new Uint8Array(64);
  private bufferLength = 0;
  private bytesHashed = 0;
  private w = new Uint32Array(64);

  update(chunk: Uint8Array): void {
    let offset = 0;
    this.bytesHashed += chunk.length;
    if (this.bufferLength > 0) {
      const need = 64 - this.bufferLength;
      const take = Math.min(need, chunk.length);
      this.buffer.set(chunk.subarray(0, take), this.bufferLength);
      this.bufferLength += take;
      offset = take;
      if (this.bufferLength === 64) {
        this.compress(this.buffer);
        this.bufferLength = 0;
      }
    }
    while (offset + 64 <= chunk.length) {
      this.compress(chunk.subarray(offset, offset + 64));
      offset += 64;
    }
    if (offset < chunk.length) {
      this.buffer.set(chunk.subarray(offset), 0);
      this.bufferLength = chunk.length - offset;
    }
  }

  private compress(block: Uint8Array): void {
    const w = this.w;
    for (let i = 0; i < 16; i += 1) {
      const j = i * 4;
      w[i] =
        ((block[j] << 24) |
          (block[j + 1] << 16) |
          (block[j + 2] << 8) |
          block[j + 3]) >>>
        0;
    }
    for (let i = 16; i < 64; i += 1) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = this.h[0];
    let b = this.h[1];
    let c = this.h[2];
    let d = this.h[3];
    let e = this.h[4];
    let f = this.h[5];
    let g = this.h[6];
    let h = this.h[7];

    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.h[0] = (this.h[0] + a) >>> 0;
    this.h[1] = (this.h[1] + b) >>> 0;
    this.h[2] = (this.h[2] + c) >>> 0;
    this.h[3] = (this.h[3] + d) >>> 0;
    this.h[4] = (this.h[4] + e) >>> 0;
    this.h[5] = (this.h[5] + f) >>> 0;
    this.h[6] = (this.h[6] + g) >>> 0;
    this.h[7] = (this.h[7] + h) >>> 0;
  }

  hex(): string {
    const bitLength = this.bytesHashed * 8;
    // Padding: 0x80 rồi các byte 0 cho tới khi còn 8 byte cuối.
    const tail = new Uint8Array(this.bufferLength < 56 ? 64 : 128);
    tail.set(this.buffer.subarray(0, this.bufferLength), 0);
    tail[this.bufferLength] = 0x80;
    const view = new DataView(tail.buffer);
    // Độ dài bit là số nguyên 64-bit; ảnh thực tế luôn < 2^32 byte.
    view.setUint32(tail.length - 8, Math.floor(bitLength / 0x100000000));
    view.setUint32(tail.length - 4, bitLength >>> 0);
    for (let offset = 0; offset < tail.length; offset += 64) {
      this.compress(tail.subarray(offset, offset + 64));
    }
    let out = "";
    for (let i = 0; i < 8; i += 1) {
      out += this.h[i].toString(16).padStart(8, "0");
    }
    return out;
  }
}

/** Băm một Blob/File theo từng phần 4MB — bộ nhớ sử dụng không đổi. */
export async function sha256Blob(
  blob: Blob,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const hasher = new Sha256();
  const chunkSize = 4 * 1024 * 1024;
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    if (signal?.aborted) throw new DOMException("Đã huỷ", "AbortError");
    const slice = blob.slice(offset, Math.min(offset + chunkSize, blob.size));
    const buffer = await slice.arrayBuffer();
    hasher.update(new Uint8Array(buffer));
    onProgress?.(Math.min(1, (offset + chunkSize) / blob.size));
  }
  if (blob.size === 0) hasher.update(new Uint8Array(0));
  return hasher.hex();
}

/** Băm một chuỗi UTF-8 (dùng cho token chia sẻ và mật khẩu phía demo). */
export async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  const hasher = new Sha256();
  hasher.update(bytes);
  return hasher.hex();
}

/** So sánh chuỗi băm theo thời gian hằng định (tránh rò rỉ qua thời gian). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
