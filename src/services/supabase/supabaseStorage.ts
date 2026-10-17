import * as tus from "tus-js-client";
import { SUPABASE_URL } from "@/config/env";
import { assertSafeStoragePath } from "@/lib/fileTypes";
import type { StorageProvider, StorageUploadOptions } from "@/services/ports";
import { requireSupabaseClient } from "./client";

/**
 * Nhà cung cấp lưu trữ Supabase Storage.
 *
 * Ảnh gốc được tải lên NGUYÊN BYTE bằng giao thức TUS (resumable/multipart):
 *  - Có tiến độ theo byte thật, không phải tiến độ giả.
 *  - Tự động thử lại khi mạng chập chờn và có thể tiếp tục giữa chừng.
 *  - Không nén, không chuyển định dạng, không sửa metadata.
 *
 * Mọi thao tác tải xuống đều trả về đúng object đã lưu.
 */

/** Supabase yêu cầu chunk 6MiB cho endpoint resumable. */
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

export class SupabaseStorageProvider implements StorageProvider {
  readonly kind = "supabase-storage";
  private readonly bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
  }

  private tusEndpoint(): string {
    return `${SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/upload/resumable`;
  }

  async upload({
    path,
    file,
    contentType,
    cacheControl = "3600",
    onProgress,
    signal,
  }: StorageUploadOptions): Promise<void> {
    const safePath = assertSafeStoragePath(path);
    const supabase = requireSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại rồi thử lại.");
    }

    if (signal?.aborted) throw new DOMException("Đã huỷ", "AbortError");

    await new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: this.tusEndpoint(),
        headers: { authorization: `Bearer ${session.access_token}` },
        metadata: {
          bucketName: this.bucket,
          objectName: safePath,
          contentType: contentType || "application/octet-stream",
          cacheControl,
        },
        // Thử lại có kiểm soát: ngay lập tức, rồi giãn dần.
        retryDelays: [0, 2000, 5000, 10_000, 20_000, 30_000],
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: TUS_CHUNK_SIZE,
        onError: (error) => reject(error instanceof Error ? error : new Error(String(error))),
        onProgress: (uploaded, total) => {
          onProgress?.(total === 0 ? 1 : uploaded / total, uploaded, total);
        },
        onSuccess: () => {
          onProgress?.(1, file.size, file.size);
          resolve();
        },
      });

      const abort = () => {
        // abort() dừng yêu cầu nhưng giữ lại tiến trình đã tải để có thể tiếp tục.
        void upload.abort(false);
        reject(new DOMException("Đã huỷ", "AbortError"));
      };
      signal?.addEventListener("abort", abort, { once: true });

      void upload.findPreviousUploads().then((previous) => {
        if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      });
    });
  }

  async fetchBlob(path: string, signal?: AbortSignal): Promise<Blob> {
    if (signal?.aborted) throw new DOMException("Đã huỷ", "AbortError");
    const supabase = requireSupabaseClient();
    const { data, error } = await supabase.storage
      .from(this.bucket)
      .download(assertSafeStoragePath(path));
    if (error || !data) {
      throw new Error(error?.message ?? "Không tải được tệp từ kho lưu trữ.");
    }
    return data;
  }

  async createUrl(path: string, expiresInSeconds = 3600): Promise<string> {
    const supabase = requireSupabaseClient();
    const { data, error } = await supabase.storage
      .from(this.bucket)
      .createSignedUrl(assertSafeStoragePath(path), expiresInSeconds);
    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? "Không tạo được liên kết xem ảnh.");
    }
    return data.signedUrl;
  }

  async createDownloadUrl(
    path: string,
    filename: string,
    expiresInSeconds = 300,
  ): Promise<string> {
    const supabase = requireSupabaseClient();
    const { data, error } = await supabase.storage
      .from(this.bucket)
      .createSignedUrl(assertSafeStoragePath(path), expiresInSeconds, {
        // Tham số `download` khiến Storage trả về Content-Disposition kèm tên tệp.
        download: filename,
      });
    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? "Không tạo được liên kết tải xuống.");
    }
    return data.signedUrl;
  }

  async createUrls(
    paths: string[],
    expiresInSeconds = 3600,
  ): Promise<Record<string, string>> {
    const supabase = requireSupabaseClient();
    const result: Record<string, string> = {};
    const safe = paths.map((path) => assertSafeStoragePath(path));
    for (let index = 0; index < safe.length; index += 100) {
      const batch = safe.slice(index, index + 100);
      const { data, error } = await supabase.storage
        .from(this.bucket)
        .createSignedUrls(batch, expiresInSeconds);
      if (error) throw new Error(error.message);
      for (const item of data ?? []) {
        if (item.path && item.signedUrl) result[item.path] = item.signedUrl;
      }
    }
    return result;
  }

  async remove(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const supabase = requireSupabaseClient();
    const safe = paths.map((path) => assertSafeStoragePath(path));
    // Supabase giới hạn số object mỗi lần gọi, nên chia theo lô 100.
    for (let index = 0; index < safe.length; index += 100) {
      const batch = safe.slice(index, index + 100);
      const { error } = await supabase.storage.from(this.bucket).remove(batch);
      if (error) throw new Error(error.message);
    }
  }

  async exists(path: string): Promise<boolean> {
    const supabase = requireSupabaseClient();
    const safe = assertSafeStoragePath(path);
    const slash = safe.lastIndexOf("/");
    const folder = slash > 0 ? safe.slice(0, slash) : "";
    const name = slash > 0 ? safe.slice(slash + 1) : safe;
    const { data, error } = await supabase.storage
      .from(this.bucket)
      .list(folder, { search: name, limit: 1 });
    if (error) return false;
    return (data ?? []).some((item) => item.name === name);
  }

  releaseUrl(): void {
    // Signed URL không cần thu hồi phía client; chúng tự hết hạn.
  }
}
