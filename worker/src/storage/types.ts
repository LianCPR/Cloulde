/**
 * Lớp trừu tượng lưu trữ object.
 *
 * Vì sao tách riêng: yêu cầu là "giữ tầng lưu trữ mô-đun để sau này thêm được
 * nhà cung cấp tương thích S3 khác". Mọi thứ phía trên tệp này (route, API,
 * D1) chỉ biết `StorageDriver`, không biết R2 là gì.
 *
 * Hai driver được hình dung:
 *   • `r2-binding`  — dùng binding R2 của Worker. Không cần khoá API, mặc định.
 *   • `s3-presign`  — ký URL S3 để trình duyệt tải TRỰC TIẾP lên bucket. Cần
 *                     API token của R2 và CORS trên bucket.
 *
 * Hai chế độ tải lên tương ứng với hai driver:
 *   • `worker-proxy` — mỗi phần là một request tới Worker (trần 100 MB/request
 *                      của Cloudflare là lý do phải chia phần).
 *   • `direct`       — mỗi phần đi thẳng từ trình duyệt tới bucket.
 */

export interface MultipartHandle {
  key: string;
  uploadId: string;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
  byteSize: number;
}

export interface ObjectInfo {
  key: string;
  size: number;
  etag: string;
  contentType?: string;
}

export interface ObjectBody {
  body: ReadableStream<Uint8Array>;
  size: number;
  etag: string;
}

export interface StorageDriver {
  readonly kind: "r2-binding" | "s3-presign";
  /** Cách client đưa từng phần lên. */
  readonly uploadMode: "worker-proxy" | "direct";

  createMultipart(key: string, contentType: string): Promise<MultipartHandle>;
  /** Nối tiếp một phiên multipart đã có — cơ sở của khả năng resume. */
  resumeMultipart(key: string, uploadId: string): Promise<MultipartHandle>;
  /**
   * Ghi một phần. Nhận cả `ReadableStream` để một phần 64 MB không bao giờ phải
   * nằm trọn trong bộ nhớ Worker (trần bộ nhớ là 128 MB).
   */
  uploadPart(
    handle: MultipartHandle,
    partNumber: number,
    body: ReadableStream<Uint8Array> | Uint8Array,
    byteSize: number,
  ): Promise<UploadedPart>;
  complete(handle: MultipartHandle, parts: UploadedPart[]): Promise<ObjectInfo>;
  abort(handle: MultipartHandle): Promise<void>;

  /** Ghi một object nhỏ trong một lần (dùng cho ảnh thu nhỏ). */
  put(key: string, body: Uint8Array, contentType: string): Promise<ObjectInfo>;
  /** Metadata của object mà KHÔNG tải nội dung — dùng để xác minh kích thước. */
  head(key: string): Promise<ObjectInfo | null>;
  get(key: string, range?: { offset: number; length: number }): Promise<ObjectBody | null>;
  remove(keys: string[]): Promise<void>;

  /**
   * Ký URL cho một phần để client tải trực tiếp lên bucket.
   * Chỉ driver `s3-presign` có; driver `r2-binding` trả về `null` và client
   * phải đi qua Worker.
   */
  presignPartUrl?(
    handle: MultipartHandle,
    partNumber: number,
    expiresSeconds: number,
  ): Promise<string>;
}
