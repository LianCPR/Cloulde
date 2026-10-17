import type { Album, Paged, Photo, PhotoQuery, PhotoSort } from "@/types";
import { SIGNED_URL_TTL_SECONDS, SIGNED_URL_TTL_SHORT } from "@/config/env";
import { getBackend } from "./backend";
import {
  sourceFromBlobFactory,
  sourceFromResponse,
  type OriginalSource,
} from "./originalSource";

/**
 * Dịch vụ ảnh.
 *
 * Hai điểm cốt lõi:
 *  1. Lưới thư viện chỉ dùng ẢNH THU NHỎ. Ảnh full-resolution chỉ được nạp khi
 *     mở trình xem ảnh hoặc khi tải xuống — không bao giờ tải sẵn cả album.
 *  2. Mọi thao tác tải xuống đều đi qua `getOriginalSource`, trả về nguyên byte
 *     của object đã lưu.
 */

export type MediaPurpose = "thumbnail" | "original";

type StorageKind = "original" | "thumbnail";

interface CacheEntry {
  url: string;
  expiresAt: number;
  refs: number;
  promise: Promise<string> | null;
}

/**
 * Bộ nhớ đệm URL theo ĐƯỜNG DẪN, có đếm tham chiếu.
 *
 * - Supabase: signed URL dùng lại được cho tới khi hết hạn (50 phút).
 * - Backend cục bộ: object URL phải được thu hồi khi không còn ai dùng, nếu
 *   không ảnh sẽ chiếm bộ nhớ mãi cho tới khi tải lại trang.
 */
class MediaUrlCache {
  private entries = new Map<string, CacheEntry>();

  private key(kind: StorageKind, path: string): string {
    return `${kind}:${path}`;
  }

  private provider(kind: StorageKind) {
    const backend = getBackend();
    return kind === "thumbnail" ? backend.thumbnailStorage : backend.storage;
  }

  /** Lấy URL cho một đường dẫn; tự tăng tham chiếu. */
  acquire(kind: StorageKind, path: string): Promise<string> {
    const key = this.key(kind, path);
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      existing.refs += 1;
      return existing.promise ?? Promise.resolve(existing.url);
    }

    const entry: CacheEntry = { url: "", expiresAt: 0, refs: 1, promise: null };
    entry.promise = this.provider(kind)
      .createUrl(path, SIGNED_URL_TTL_SECONDS)
      .then((url) => {
        entry.url = url;
        // Object URL cục bộ không hết hạn; signed URL thì có.
        entry.expiresAt = url.startsWith("blob:")
          ? Date.now() + 24 * 60 * 60 * 1000
          : Date.now() + 50 * 60 * 1000;
        return url;
      })
      .catch((error) => {
        this.entries.delete(key);
        throw error;
      });
    this.entries.set(key, entry);
    return entry.promise;
  }

  release(kind: StorageKind, path: string): void {
    const key = this.key(kind, path);
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.refs -= 1;
    if (entry.refs <= 0) {
      this.entries.delete(key);
      if (entry.url.startsWith("blob:")) {
        queueMicrotask(() => URL.revokeObjectURL(entry.url));
      }
    }
  }

  /** Nạp trước URL cho một loạt đường dẫn, gộp yêu cầu ký URL khi có thể. */
  async prefetch(kind: StorageKind, paths: string[]): Promise<void> {
    const unique = [...new Set(paths.filter(Boolean))];
    const pending = unique.filter((path) => {
      const entry = this.entries.get(this.key(kind, path));
      return !entry || entry.expiresAt <= Date.now();
    });
    if (pending.length === 0) return;

    const provider = this.provider(kind);
    const batchSize = 100;
    for (let index = 0; index < pending.length; index += batchSize) {
      const batch = pending.slice(index, index + batchSize);
      if (provider.createUrls && batch.length > 1) {
        try {
          const urls = await provider.createUrls(batch, SIGNED_URL_TTL_SECONDS);
          for (const [path, url] of Object.entries(urls)) {
            const key = this.key(kind, path);
            const entry = this.entries.get(key);
            if (entry) {
              entry.url = url;
              entry.expiresAt = Date.now() + 50 * 60 * 1000;
              entry.promise = Promise.resolve(url);
            } else {
              this.entries.set(key, {
                url,
                expiresAt: Date.now() + 50 * 60 * 1000,
                refs: 0,
                promise: Promise.resolve(url),
              });
            }
          }
          continue;
        } catch {
          // Rơi xuống đường đi từng ảnh.
        }
      }
      await Promise.all(batch.map((path) => this.acquire(kind, path).catch(() => null)));
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      if (entry.url.startsWith("blob:")) URL.revokeObjectURL(entry.url);
    }
    this.entries.clear();
  }
}

export const mediaUrlCache = new MediaUrlCache();

/** Đường dẫn hiển thị của một ảnh: ưu tiên ảnh thu nhỏ, không có thì dùng ảnh gốc. */
export function resolveDisplayPath(
  photo: Pick<Photo, "thumbnailPath" | "storagePath" | "previewable">,
): { kind: StorageKind; path: string } | null {
  if (photo.thumbnailPath) return { kind: "thumbnail", path: photo.thumbnailPath };
  // Không có ảnh thu nhỏ (RAW/TIFF/HEIC): chỉ hiển thị khi trình duyệt giải mã được.
  if (photo.previewable) return { kind: "original", path: photo.storagePath };
  return null;
}

/** Nguồn ảnh bìa của album. */
export function resolveAlbumCover(
  album: Pick<Album, "coverThumbnailPath" | "coverStoragePath" | "coverPreviewable">,
): { kind: StorageKind; path: string } | null {
  if (album.coverThumbnailPath) return { kind: "thumbnail", path: album.coverThumbnailPath };
  if (album.coverStoragePath && album.coverPreviewable) {
    return { kind: "original", path: album.coverStoragePath };
  }
  return null;
}

export const photoService = {
  async list(query: Omit<PhotoQuery, "sort"> & { sort?: PhotoSort }): Promise<Paged<Photo>> {
    return getBackend().photos.list({
      albumId: query.albumId,
      cursor: query.cursor ?? null,
      limit: query.limit,
      sort: query.sort ?? "uploaded-desc",
    });
  },

  async get(photoId: string): Promise<Photo | null> {
    return getBackend().photos.get(photoId);
  },

  async listAllMetadata(albumId: string): Promise<Photo[]> {
    return getBackend().photos.listAllMetadata(albumId);
  },

  async remove(photoIds: string[]): Promise<void> {
    await getBackend().photos.remove(photoIds);
  },

  async setThumbnail(photoId: string, thumbnailPath: string | null): Promise<void> {
    await getBackend().photos.setThumbnail(photoId, thumbnailPath);
  },

  /**
   * Nguồn byte GỐC của một ảnh.
   * Dùng cho mọi thao tác tải xuống. Không giải mã, không vẽ lại qua canvas.
   */
  async getOriginalSource(photo: Photo): Promise<OriginalSource> {
    const backend = getBackend();
    if (backend.mode === "archive") {
      // URL có chữ ký ngắn hạn rồi đọc THEO LUỒNG: tệp 500 MB không bao giờ
      // được nạp trọn vào bộ nhớ trình duyệt.
      const url = await backend.storage.createDownloadUrl(
        photo.storagePath,
        photo.originalFilename,
        SIGNED_URL_TTL_SHORT,
      );
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Không tải được ảnh gốc từ kho lưu trữ (${response.status}).`);
      return sourceFromResponse(response, photo.fileSize);
    }
    if (backend.mode === "supabase") {
      // Signed URL kèm Content-Disposition rồi đọc theo luồng.
      const url = await backend.storage.createDownloadUrl(
        photo.storagePath,
        photo.originalFilename,
        SIGNED_URL_TTL_SHORT,
      );
      const response = await fetch(url);
      if (!response.ok) throw new Error("Không tải được ảnh gốc từ kho lưu trữ.");
      return sourceFromResponse(response, photo.fileSize);
    }
    return sourceFromBlobFactory(
      () => backend.storage.fetchBlob(photo.storagePath),
      photo.fileSize,
    );
  },

  /** URL full-size cho trình xem ảnh (vẫn là tệp gốc, chỉ khác thời hạn chữ ký). */
  async getViewerUrl(photo: Photo): Promise<string> {
    return getBackend().storage.createUrl(photo.storagePath, SIGNED_URL_TTL_SECONDS);
  },

  sortLabels: {
    "uploaded-desc": "Mới tải lên trước",
    "uploaded-asc": "Cũ nhất trước",
    "filename-asc": "Theo tên tệp (A→Z)",
  } satisfies Record<PhotoSort, string>,
};
