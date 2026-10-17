/**
 * Driver mặc định: R2 qua binding của Worker.
 *
 * Vì sao đây là mặc định:
 *   • Không cần tạo API token R2, không cần cấu hình CORS trên bucket.
 *   • KHÔNG tồn tại khoá truy cập nào ở phía trình duyệt — không có gì để lộ.
 *   • Binding hỗ trợ đầy đủ multipart, kể cả `resumeMultipartUpload` và `abort`,
 *     là hai thứ bắt buộc để resume và dọn dẹp được.
 *
 * Đánh đổi nói rõ: byte đi qua Worker. Trần thân request 100 MB của Cloudflare
 * là lý do mỗi phần phải ≤ 64 MB. Băng thông này không mất phí (egress của R2
 * miễn phí, kể cả qua Workers).
 *
 * ĐIỂM QUAN TRỌNG: mỗi request là một lần chạy Worker riêng, nên đối tượng
 * multipart không thể lưu trong bộ nhớ giữa các request. Mọi thao tác đều
 * `resumeMultipartUpload` lại từ `(key, uploadId)` — đó cũng chính là cơ chế
 * khiến resume hoạt động xuyên phiên.
 */

import type { MultipartHandle, ObjectBody, ObjectInfo, StorageDriver, UploadedPart } from "./types";

export class R2BindingDriver implements StorageDriver {
  readonly kind = "r2-binding" as const;
  readonly uploadMode = "worker-proxy" as const;

  constructor(private readonly bucket: R2Bucket) {}

  async createMultipart(key: string, contentType: string): Promise<MultipartHandle> {
    const upload = await this.bucket.createMultipartUpload(key, {
      httpMetadata: { contentType },
    });
    return { key: upload.key, uploadId: upload.uploadId };
  }

  async resumeMultipart(key: string, uploadId: string): Promise<MultipartHandle> {
    const upload = this.bucket.resumeMultipartUpload(key, uploadId);
    return { key: upload.key, uploadId: upload.uploadId };
  }

  async uploadPart(
    handle: MultipartHandle,
    partNumber: number,
    body: ReadableStream<Uint8Array> | Uint8Array,
    byteSize: number,
  ): Promise<UploadedPart> {
    const upload = this.bucket.resumeMultipartUpload(handle.key, handle.uploadId);
    // R2 nhận thẳng ReadableStream — byte đi từ request vào bucket mà không bị
    // sao chép vào bộ nhớ Worker.
    const part = await upload.uploadPart(partNumber, body);
    return { partNumber: part.partNumber, etag: part.etag, byteSize };
  }

  async complete(handle: MultipartHandle, parts: UploadedPart[]): Promise<ObjectInfo> {
    const upload = this.bucket.resumeMultipartUpload(handle.key, handle.uploadId);
    const object = await upload.complete(
      parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag })),
    );
    return { key: object.key, size: object.size, etag: object.etag };
  }

  async abort(handle: MultipartHandle): Promise<void> {
    const upload = this.bucket.resumeMultipartUpload(handle.key, handle.uploadId);
    await upload.abort();
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<ObjectInfo> {
    const object = await this.bucket.put(key, body, { httpMetadata: { contentType } });
    return { key, size: object?.size ?? body.byteLength, etag: object?.etag ?? "" };
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const object = await this.bucket.head(key);
    if (!object) return null;
    return {
      key: object.key,
      size: object.size,
      etag: object.etag,
      contentType: object.httpMetadata?.contentType,
    };
  }

  async get(key: string, range?: { offset: number; length: number }): Promise<ObjectBody | null> {
    const object = range
      ? await this.bucket.get(key, { range: { offset: range.offset, length: range.length } })
      : await this.bucket.get(key);
    if (!object || !("body" in object)) return null;
    const withBody = object as R2ObjectBody;
    return { body: withBody.body as ReadableStream<Uint8Array>, size: object.size, etag: object.etag };
  }

  async remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.bucket.delete(keys);
  }
}
