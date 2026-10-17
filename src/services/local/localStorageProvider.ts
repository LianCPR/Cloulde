import { assertSafeStoragePath } from "@/lib/fileTypes";
import type { StorageProvider, StorageUploadOptions } from "@/services/ports";
import { getLocalDb } from "./localDb";

/**
 * Nhà cung cấp lưu trữ cho backend `local`.
 *
 * Ảnh gốc được lưu nguyên byte trong IndexedDB (store `blobs`) — cùng một
 * đường dẫn object như khi dùng Supabase Storage, nên toàn bộ logic tải
 * xuống/phân trang ở tầng trên không cần thay đổi khi chuyển nhà cung cấp.
 */
class LocalStorageProvider implements StorageProvider {
  readonly kind = "indexeddb";

  /** url → object URL, dùng đếm tham chiếu để thu hồi đúng lúc. */
  private urlRefs = new Map<string, { path: string; count: number }>();

  async upload({
    path,
    file,
    contentType,
    onProgress,
    signal,
  }: StorageUploadOptions): Promise<void> {
    const safePath = assertSafeStoragePath(path);
    const db = await getLocalDb();

    const existing = await db.get("blobs", safePath);
    if (existing) {
      throw new Error("Đường dẫn lưu trữ đã tồn tại. Vui lòng thử lại.");
    }

    // Ghi theo từng phần để báo tiến độ thật và có thể huỷ giữa chừng.
    // Nội dung được cắt nguyên byte: không nén, không mã hoá lại.
    const total = file.size;
    const chunkSize = 4 * 1024 * 1024;
    const parts: BlobPart[] = [];
    let uploaded = 0;

    for (let offset = 0; offset < total; offset += chunkSize) {
      if (signal?.aborted) throw new DOMException("Đã huỷ", "AbortError");
      const slice = file.slice(offset, Math.min(offset + chunkSize, total));
      parts.push(slice);
      uploaded += slice.size;
      onProgress?.(total === 0 ? 1 : uploaded / total, uploaded, total);
      // Nhường một nhịp cho UI để thanh tiến độ cập nhật mượt.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (total === 0) onProgress?.(1, 0, 0);

    const blob = new Blob(parts, { type: contentType });
    await db.put("blobs", {
      path: safePath,
      blob,
      mimeType: contentType,
      createdAt: new Date().toISOString(),
    });
  }

  async fetchBlob(path: string, signal?: AbortSignal): Promise<Blob> {
    if (signal?.aborted) throw new DOMException("Đã huỷ", "AbortError");
    const db = await getLocalDb();
    const record = await db.get("blobs", assertSafeStoragePath(path));
    if (!record) throw new Error("Không tìm thấy tệp trong kho lưu trữ.");
    return record.blob;
  }

  async createUrl(path: string, _expiresInSeconds?: number): Promise<string> {
    void _expiresInSeconds;
    const blob = await this.fetchBlob(path);
    const url = URL.createObjectURL(blob);
    this.urlRefs.set(url, { path, count: 1 });
    return url;
  }

  async createDownloadUrl(
    path: string,
    _filename: string,
    _expiresInSeconds?: number,
  ): Promise<string> {
    // Object URL không hỗ trợ Content-Disposition; tên tệp được đặt khi thẻ <a>
    // tải xuống. Tầng tải xuống vẫn luôn trả về đúng byte của ảnh gốc.
    return this.createUrl(path);
  }

  async createUrls(
    paths: string[],
    _expiresInSeconds?: number,
  ): Promise<Record<string, string>> {
    void _expiresInSeconds;
    const result: Record<string, string> = {};
    for (const path of paths) {
      try {
        result[path] = await this.createUrl(path);
      } catch {
        // Bỏ qua tệp thiếu; nơi gọi sẽ hiển thị trạng thái lỗi cho ảnh đó.
      }
    }
    return result;
  }

  async remove(paths: string[]): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction("blobs", "readwrite");
    await Promise.all(
      paths.map((path) => tx.store.delete(assertSafeStoragePath(path))),
    );
    await tx.done;
    // Thu hồi mọi object URL trỏ tới các đường dẫn vừa xoá.
    for (const [url, info] of this.urlRefs) {
      if (paths.includes(info.path)) {
        URL.revokeObjectURL(url);
        this.urlRefs.delete(url);
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    const db = await getLocalDb();
    const key = await db.getKey("blobs", assertSafeStoragePath(path));
    return key !== undefined;
  }

  releaseUrl(url: string): void {
    const info = this.urlRefs.get(url);
    if (!info) return;
    info.count -= 1;
    if (info.count <= 0) {
      URL.revokeObjectURL(url);
      this.urlRefs.delete(url);
    }
  }

  /** Dọn mọi object URL khi rời trang (tránh rò rỉ bộ nhớ). */
  releaseAll(): void {
    for (const url of this.urlRefs.keys()) URL.revokeObjectURL(url);
    this.urlRefs.clear();
  }
}

export const localStorageProvider = new LocalStorageProvider();
