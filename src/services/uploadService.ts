import type { Photo, UploadItem, UploadStatus } from "@/types";
import { uploadLimitBytes, UPLOAD_CONCURRENCY, BUCKETS } from "@/config/env";
import {
  buildOriginalStoragePath,
  buildThumbnailStoragePath,
  resolveMimeType,
  sanitizeOriginalFilename,
} from "@/lib/fileTypes";
import { generateThumbnail, readImageMetadata } from "@/lib/imageMeta";
import { sha256Blob } from "@/lib/checksum";
import { describeError } from "./errors";
import type { GalleryBackend, MultipartProgress } from "./ports";
import { SupabaseStorageProvider } from "./supabase/supabaseBackend";
import { isDuplicateError } from "./archive/archiveClient";

/**
 * Hàng đợi tải lên.
 *
 * Yêu cầu nghiệp vụ được đáp ứng:
 *  - Nhiều tệp một lúc, có giới hạn số luồng song song.
 *  - Tiến độ theo từng tệp và tiến độ tổng.
 *  - Thử lại với backoff cho lỗi tạm thời; không tạo bản ghi trùng khi thử lại.
 *  - Có thể huỷ từng tệp hoặc toàn bộ.
 *  - Ảnh gốc được tải lên NGUYÊN BYTE trước, sau đó mới sinh ảnh thu nhỏ riêng.
 *  - Chỉ báo "hoàn tất" sau khi object đã nằm trong kho lưu trữ.
 *
 * Hai đường đi tải lên, chọn theo năng lực của backend:
 *   1. NHIỀU PHẦN (kho lưu trữ R2/S3): bắt buộc với tệp lớn, vì một request
 *      không thể mang quá 100 MB qua Cloudflare. Có resume, thử lại từng phần,
 *      và trạng thái phiên nằm ở SERVER nên đóng tab vẫn tiếp tục được.
 *   2. MỘT LẦN (Supabase/IndexedDB): một request duy nhất, không resume được.
 */

export interface UploadQueueEvents {
  onChange: (items: UploadItem[], summary: UploadSummary) => void;
  onItemCompleted?: (item: UploadItem) => void;
}

export interface UploadSummary {
  total: number;
  pending: number;
  active: number;
  completed: number;
  failed: number;
  duplicates: number;
  cancelled: number;
  /** 0–1 theo byte đã gửi thật. */
  fraction: number;
  isRunning: boolean;
}

/** Lỗi tạm thời nên thử lại; lỗi vĩnh viễn thì dừng ngay. */
function isRetryable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  const message = error instanceof Error ? error.message : String(error);
  return !/quá lớn|exceeded|vượt quá|không hợp lệ|đã tồn tại|định dạng|permission|không có quyền|JWT|hết hạn|unauthorized|forbidden|400|401|403|413|415/i.test(
    message,
  );
}

const MAX_ATTEMPTS = 3;

export class UploadQueue {
  private items = new Map<string, UploadItem>();
  private controllers = new Map<string, AbortController>();
  private listeners = new Set<UploadQueueEvents["onChange"]>();
  private running = false;
  private disposed = false;
  private readonly backend: GalleryBackend;
  private readonly albumId: string;

  constructor(backend: GalleryBackend, albumId: string) {
    this.backend = backend;
    this.albumId = albumId;
  }

  subscribe(listener: UploadQueueEvents["onChange"]): () => void {
    this.listeners.add(listener);
    listener(this.snapshot(), this.summary());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const items = this.snapshot();
    const summary = this.summary();
    for (const listener of this.listeners) listener(items, summary);
  }

  snapshot(): UploadItem[] {
    return [...this.items.values()];
  }

  summary(): UploadSummary {
    const items = this.snapshot();
    const counted = (status: UploadStatus) => items.filter((i) => i.status === status).length;
    const totalBytes = items.reduce((sum, item) => sum + item.fileSize, 0);
    const sentBytes = items.reduce(
      (sum, item) => sum + (item.status === "completed" ? item.fileSize : item.uploadedBytes),
      0,
    );
    return {
      total: items.length,
      pending: counted("pending"),
      active: counted("preparing") + counted("uploading") + counted("verifying"),
      completed: counted("completed"),
      failed: counted("failed"),
      duplicates: counted("duplicate"),
      cancelled: counted("cancelled"),
      fraction: totalBytes > 0 ? Math.min(1, sentBytes / totalBytes) : 0,
      isRunning: this.running,
    };
  }

  /**
   * Thêm tệp vào hàng đợi.
   * Tệp vượt giới hạn kích thước bị đánh dấu lỗi ngay, kèm lý do rõ ràng.
   */
  addFiles(files: File[]): void {
    for (const file of files) {
      const id =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const filename = sanitizeOriginalFilename(file.name);
      const tooLarge = file.size > uploadLimitBytes;
      const empty = file.size === 0;

      this.items.set(id, {
        id,
        file,
        filename,
        fileSize: file.size,
        status: tooLarge || empty ? "failed" : "pending",
        progress: 0,
        uploadedBytes: 0,
        attempts: 0,
        error: tooLarge
          ? `Tệp ${(file.size / 1024 / 1024).toFixed(1)}MB vượt trần ${(uploadLimitBytes / 1024 / 1024).toFixed(0)}MB của kho lưu trữ.`
          : empty
            ? "Tệp rỗng, không có dữ liệu để tải lên."
            : null,
        photo: null,
        previewUrl: null,
        duplicateOf: null,
        multipart: null,
      });
    }
    this.emit();
    void this.pump();
  }

  /**
   * Thêm tệp để NỐI TIẾP một phiên đã dở trên server.
   *
   * Trình duyệt không thể tự giữ tệp qua lần tải lại trang, nên người dùng chọn
   * lại đúng tệp gốc; server đối chiếu kích thước và từ chối nếu không khớp.
   */
  resumeSession(session: { id: string; totalBytes: number; originalFilename: string }, file: File): void {
    if (file.size !== session.totalBytes) {
      throw new Error(
        `Tệp đã chọn có ${file.size} byte, phiên cũ cần ${session.totalBytes} byte. Hãy chọn đúng tệp gốc.`,
      );
    }
    const id =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.items.set(id, {
      id,
      file,
      filename: sanitizeOriginalFilename(file.name || session.originalFilename),
      fileSize: file.size,
      status: "pending",
      progress: 0,
      uploadedBytes: 0,
      attempts: 0,
      error: null,
      photo: null,
      previewUrl: null,
      duplicateOf: null,
      multipart: {
        sessionId: session.id,
        uploadedBytes: 0,
        partSize: 0,
        totalParts: 0,
        completedParts: [],
        sessionResumed: true,
      },
    });
    this.emit();
    void this.pump();
  }

  /** Thử lại các tệp lỗi (không thử lại tệp bị huỷ hoặc vượt giới hạn). */
  retryFailed(): void {
    for (const item of this.items.values()) {
      if (item.status === "failed" && item.fileSize > 0 && item.fileSize <= uploadLimitBytes) {
        item.status = "pending";
        item.error = null;
        item.progress = 0;
        item.uploadedBytes = 0;
      }
    }
    this.emit();
    void this.pump();
  }

  retryItem(id: string): void {
    const item = this.items.get(id);
    if (!item) return;
    if (item.fileSize === 0 || item.fileSize > uploadLimitBytes) return;
    item.status = "pending";
    item.error = null;
    item.progress = 0;
    item.uploadedBytes = 0;
    this.emit();
    void this.pump();
  }

  cancelItem(id: string): void {
    const controller = this.controllers.get(id);
    if (controller) controller.abort();
    const item = this.items.get(id);
    if (item && item.status !== "completed" && item.status !== "duplicate") {
      item.status = "cancelled";
      item.error = "Đã huỷ.";
      this.emit();
    }
  }

  cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
    for (const item of this.items.values()) {
      if (item.status !== "completed" && item.status !== "duplicate") {
        item.status = "cancelled";
        item.error = "Đã huỷ.";
      }
    }
    this.running = false;
    this.emit();
  }

  removeCompleted(): void {
    for (const [id, item] of this.items) {
      if (item.status === "completed" || item.status === "cancelled" || item.status === "duplicate") {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        this.items.delete(id);
      }
    }
    this.emit();
  }

  /** Giải phóng mọi object URL và dừng hàng đợi khi rời trang. */
  dispose(): void {
    this.disposed = true;
    this.cancelAll();
    for (const item of this.items.values()) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    this.listeners.clear();
  }

  private update(id: string, patch: Partial<UploadItem>): void {
    const item = this.items.get(id);
    if (!item) return;
    Object.assign(item, patch);
    this.emit();
  }

  /** Chạy song song có giới hạn. */
  private async pump(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      for (;;) {
        const next = [...this.items.values()].filter((item) => item.status === "pending");
        if (next.length === 0) break;
        const batch = next.slice(0, UPLOAD_CONCURRENCY);
        await Promise.all(batch.map((item) => this.processItem(item.id)));
      }
    } finally {
      this.running = false;
      this.emit();
    }
  }

  private async processItem(id: string): Promise<void> {
    const item = this.items.get(id);
    if (!item || this.disposed) return;
    if (item.status === "cancelled") return;

    const controller = new AbortController();
    this.controllers.set(id, controller);

    try {
      for (;;) {
        item.attempts += 1;
        try {
          await this.attemptUpload(item, controller.signal);
          return;
        } catch (error) {
          if (controller.signal.aborted) {
            this.update(id, { status: "cancelled", error: "Đã huỷ." });
            return;
          }
          const canRetry = isRetryable(error) && item.attempts < MAX_ATTEMPTS;
          if (!canRetry) {
            this.update(id, { status: "failed", error: describeError(error) });
            return;
          }
          // Backoff: 1s, 3s, ... trước khi thử lại.
          const delay = 1000 * 3 ** (item.attempts - 1);
          this.update(id, {
            status: "pending",
            error: `Lỗi tạm thời, sẽ thử lại sau ${Math.round(delay / 1000)}s…`,
            progress: item.progress,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (controller.signal.aborted) {
            this.update(id, { status: "cancelled", error: "Đã huỷ." });
            return;
          }
          this.update(id, { status: "uploading", error: null });
        }
      }
    } finally {
      this.controllers.delete(id);
    }
  }

  /** Một lần thử tải lên trọn vẹn cho một tệp. */
  private async attemptUpload(item: UploadItem, signal: AbortSignal): Promise<void> {
    const { file } = item;
    if (this.backend.multipart) {
      await this.attemptMultipartUpload(item, signal);
      return;
    }

    const ownerId = (await this.backend.auth.getCurrentUser())?.id;
    if (!ownerId) throw new Error("Bạn cần đăng nhập để tải ảnh lên.");

    this.update(item.id, { status: "preparing", error: null, progress: 0.02 });

    const mimeType = resolveMimeType(file);
    const storagePath = buildOriginalStoragePath(ownerId, this.albumId, item.filename);

    // 1. Đọc metadata (kích thước, khả năng xem trước) — chỉ đọc, không sửa tệp.
    const metadata = await readImageMetadata(file);
    if (signal.aborted) throw new DOMException("Đã huỷ", "AbortError");

    // 2. Băm SHA-256 để kiểm tra toàn vẹn và phát hiện ảnh đã có trong album.
    const checksum = await sha256Blob(file, (fraction) => {
      this.update(item.id, { progress: 0.05 + fraction * 0.1 });
    });
    if (signal.aborted) throw new DOMException("Đã huỷ", "AbortError");

    const duplicate = await this.backend.photos.findByChecksum(this.albumId, checksum);
    if (duplicate) {
      // Không tự xoá, không tự bỏ qua âm thầm: đánh dấu rõ là ảnh trùng.
      this.update(item.id, {
        status: "duplicate",
        progress: 1,
        uploadedBytes: file.size,
        photo: duplicate,
        duplicateOf: duplicate.id,
        error: `Ảnh này đã có trong album (tên gốc: ${duplicate.originalFilename}). Đã bỏ qua để tránh lưu trùng.`,
      });
      return;
    }

    // 3. Tải ảnh GỐC lên nguyên byte. Đây là bước quan trọng nhất.
    this.update(item.id, { status: "uploading", progress: 0.15 });
    await this.backend.storage.upload({
      path: storagePath,
      file,
      contentType: mimeType,
      upsert: false,
      onProgress: (fraction) => {
        this.update(item.id, {
          progress: 0.15 + fraction * 0.8,
          uploadedBytes: Math.round(file.size * fraction),
        });
      },
      signal,
    });

    // 4. Sinh ảnh thu nhỏ (KHÔNG thay thế ảnh gốc; định dạng không giải mã được thì bỏ qua).
    let thumbnailPath: string | null = null;
    const preview = await generateThumbnail(file).catch(() => null);
    if (preview && !signal.aborted) {
      // Ảnh gốc và ảnh thu nhỏ nằm ở hai bucket/không gian khác nhau.
      // Backend local dùng chung một kho nên thêm tiền tố `thumb/` để tách biệt.
      const relativePath = buildThumbnailStoragePath(storagePath);
      const targetPath =
        this.backend.mode === "supabase" ? relativePath : `thumb/${relativePath}`;
      try {
        const thumbnailStorage =
          this.backend.mode === "supabase"
            ? new SupabaseStorageProvider(BUCKETS.thumbnails)
            : this.backend.storage;
        await thumbnailStorage.upload({
          path: targetPath,
          file: preview.blob,
          contentType: preview.mimeType,
        });
        thumbnailPath = targetPath;
      } catch {
        // Ảnh thu nhỏ lỗi không được làm hỏng việc lưu ảnh gốc.
        thumbnailPath = null;
      }
    }

    // 5. Ghi metadata vào cơ sở dữ liệu — chỉ metadata, không có nhị phân ảnh.
    this.update(item.id, { status: "verifying", progress: 0.96 });
    const photo: Photo = await this.backend.photos.insert({
      albumId: this.albumId,
      ownerId,
      originalFilename: item.filename,
      storagePath,
      thumbnailPath,
      mimeType,
      fileSize: file.size,
      width: metadata.width,
      height: metadata.height,
      checksum,
      previewable: metadata.decodable,
    });

    this.update(item.id, {
      status: "completed",
      progress: 1,
      uploadedBytes: file.size,
      photo,
      error: null,
    });
  }

  /**
   * Tải lên nhiều phần (kho lưu trữ R2/S3).
   *
   * Thứ tự cố ý: BĂM TRƯỚC, GỬI SAU. Nhờ vậy ảnh trùng nội dung bị chặn khi mới
   * tạo phiên — trước khi tốn bằng thông cho 500 MB — và server vẫn tự băm lại
   * sau khi ghép để phát hiện tệp hỏng.
   */
  private async attemptMultipartUpload(item: UploadItem, signal: AbortSignal): Promise<void> {
    const multipart = this.backend.multipart;
    if (!multipart) return;
    const { file } = item;

    // 1. SHA-256 của tệp gốc, tính tại trình duyệt theo luồng 4 MB.
    let checksum: string | null = null;
    if (item.multipart?.sessionId && item.multipart.sessionResumed) {
      // Nối tiếp phiên cũ: server đã có checksum từ lần tạo phiên (nếu có),
      // không cần đọc lại 500 MB từ đĩa.
      checksum = null;
    } else {
      this.update(item.id, { status: "hashing", error: null, progress: 0 });
      checksum = await sha256Blob(
        file,
        (fraction) => this.update(item.id, { progress: fraction * 0.08 }),
        signal,
      );
    }
    if (signal.aborted) throw new DOMException("Đã huỷ", "AbortError");

    const metadata = await readImageMetadata(file);
    this.update(item.id, { status: "uploading", error: null, progress: 0.1 });

    try {
      const result = await multipart.upload({
        albumId: this.albumId,
        file,
        filename: item.filename,
        mimeType: resolveMimeType(file),
        width: metadata.width,
        height: metadata.height,
        previewable: metadata.decodable,
        checksum,
        resumeSessionId: item.multipart?.sessionId ?? null,
        signal,
        onProgress: (progress: MultipartProgress) => {
          this.update(item.id, {
            status: progress.phase === "verifying" ? "verifying" : "uploading",
            // 0.1–0.95 dành cho phần gửi byte thật; 0.95+ cho bước ghép.
            progress:
              progress.phase === "verifying"
                ? 0.96
                : 0.1 +
                  (progress.totalBytes > 0 ? progress.uploadedBytes / progress.totalBytes : 0) * 0.85,
            uploadedBytes: progress.uploadedBytes,
            multipart: {
              sessionId: progress.sessionId,
              uploadedBytes: progress.uploadedBytes,
              partSize: progress.partSize,
              totalParts: progress.totalParts,
              completedParts: progress.completedParts,
              sessionResumed: progress.resumed,
            },
          });
        },
      });

      // 2. Ảnh thu nhỏ sinh RIÊNG, và lỗi ở bước này không làm hỏng ảnh gốc.
      const preview = await generateThumbnail(file).catch(() => null);
      let thumbnailPath: string | null = result.photo.thumbnailPath;
      if (preview && !signal.aborted) {
        try {
          thumbnailPath =
            (await multipart.attachThumbnail(result.photo.id, preview.blob, preview.mimeType)) ??
            thumbnailPath;
        } catch {
          // Bỏ qua: ảnh gốc đã nằm an toàn trên kho lưu trữ.
        }
      }

      this.update(item.id, {
        status: "completed",
        progress: 1,
        uploadedBytes: result.verifiedBytes,
        // PHẢI cập nhật đường dẫn ảnh thu nhỏ vừa gắn. Nếu bỏ bước này, đối tượng
        // ảnh vẫn mang `thumbnailPath: null`, và lưới thư viện sẽ tải thẳng ẢNH
        // GỐC để hiển thị — với ảnh 500 MB thì đây là lỗi nghiêm trọng.
        photo: { ...result.photo, thumbnailPath },
        error: null,
        multipart: item.multipart
          ? { ...item.multipart, sessionId: null, sessionResumed: false }
          : null,
      });
    } catch (error) {
      if (isDuplicateError(error)) {
        this.update(item.id, {
          status: "duplicate",
          progress: 1,
          uploadedBytes: file.size,
          duplicateOf: null,
          error:
            describeError(error) ||
            "Ảnh này đã có trong album (trùng nội dung). Đã bỏ qua để tránh lưu trùng.",
        });
        return;
      }
      throw error;
    }
  }
}
