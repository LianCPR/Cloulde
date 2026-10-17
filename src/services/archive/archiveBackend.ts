/**
 * Backend "kho lưu trữ" — nói chuyện với Worker Cloudflare (R2 + D1).
 *
 * VÌ SAO CÓ TỆP NÀY: ảnh gốc của một nhiếp ảnh gia có thể gần 500 MB. Một
 * request duy nhất không mang nổi (Cloudflare giới hạn thân request ở 100 MB),
 * và trình duyệt không được phép giữ khoá API của nhà cung cấp. Vì vậy mọi thứ
 * đi qua Worker: trình duyệt gửi TỪNG PHẦN, kèm danh tính chủ kho, và Worker
 * giữ khoá rồi nói chuyện với R2.
 *
 * QUY ƯỚC QUAN TRỌNG — "đường dẫn" ở backend này là ĐỊNH DANH ẢNH:
 *   storagePath    = <photoId>
 *   thumbnailPath  = <photoId>:thumb
 *
 * Lý do: kho lưu trữ riêng tư không có URL công khai nào để lộ. Mọi liên kết đều
 * được ký theo yêu cầu, có thời hạn, và gắn với đúng một ảnh. Nhờ quy ước này,
 * toàn bộ tầng giao diện hiện có (lưới ảnh, trình xem, tải xuống, chia sẻ) hoạt
 * động nguyên vẹn mà không phải sửa component nào, đồng thời không có đường dẫn
 * đoán được nào bị rò rỉ.
 */

import type {
  ActiveUploadSession,
  Album,
  AlbumQuery,
  AlbumShare,
  ArchiveHealth,
  ArchiveMaintenanceResult,
  ArchiveUsage,
  CreateAlbumInput,
  CreateShareInput,
  Paged,
  Photo,
  PhotoQuery,
  ShareAccess,
  StorageUsage,
  UpdateAlbumInput,
  UpdateShareInput,
} from "@/types";
import { SIGNED_URL_TTL_SECONDS } from "@/config/env";
import type {
  AlbumRepository,
  AuthProvider,
  GalleryBackend,
  MultipartProgress,
  MultipartUploadRequest,
  MultipartUploadResult,
  MultipartUploader,
  PhotoRepository,
  ShareRepository,
  StorageProvider,
  UsageRepository,
} from "../ports";
import { archiveJson, ArchiveError, isDuplicateError, archiveUrl, fetchSignedBlob } from "./archiveClient";
import {
  clearArchiveConnection,
  normalizeBaseUrl,
  readArchiveConnection,
  writeArchiveConnection,
  type ArchiveConnection,
} from "./connectionStore";
import { sha256Blob } from "@/lib/checksum";
import { resolveMimeType } from "@/lib/fileTypes";

/* ── DTO từ Worker ────────────────────────────────────────────────────── */

interface PhotoDto {
  id: string;
  albumId: string;
  ownerId: string;
  originalFilename: string;
  storageKey: string;
  thumbnailKey: string | null;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  claimedChecksum: string | null;
  verifiedChecksum: string | null;
  verifiedAt: string | null;
  checksumMismatch: boolean;
  previewable: boolean;
  createdAt: string;
}

interface AlbumDto {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  coverPhotoId: string | null;
  photoCount: number;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
}

interface ShareDto {
  id: string;
  albumId: string;
  ownerId: string;
  token: string | null;
  allowDownload: boolean;
  hasPassword: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  accessCount: number;
  lastAccessedAt: string | null;
}

/**
 * Phiên tải lên nhiều phần — ĐÚNG theo những gì Worker trả về.
 *
 * LƯU Ý VỀ HÌNH DẠNG (từng gây lỗi "completedParts is not iterable"):
 *   • Tên tệp là `filename`, KHÔNG phải `originalFilename`.
 *   • Thông tin các phần KHÔNG nằm trong `session`; chúng ở CẤP TRÊN của phản
 *     hồi: `uploadedParts`, `missingParts`, `uploadedBytes`.
 * Xem `worker/src/routes/uploads.ts::serialiseSession` và hai route
 * `POST /api/uploads`, `GET /api/uploads/:id`.
 */
interface SessionDto {
  id: string;
  albumId: string;
  filename: string;
  mimeType: string;
  totalBytes: number;
  partSize: number;
  partCount: number;
  status?: string;
  createdAt: string;
  expiresAt: string;
}

/** Phần thông tin các phần của một phiên, ở cấp trên phản hồi. */
interface PartsSummary {
  uploadedParts?: number[];
  missingParts?: number[];
  uploadedBytes?: number;
}

const THUMB_SUFFIX = ":thumb";

function toPhoto(dto: PhotoDto): Photo {
  return {
    id: dto.id,
    albumId: dto.albumId,
    ownerId: dto.ownerId,
    originalFilename: dto.originalFilename,
    // Ở kho lưu trữ riêng tư, "đường dẫn" là định danh ảnh: mọi URL đều được ký
    // theo yêu cầu nên không tồn tại đường dẫn công khai nào để đoán.
    storagePath: dto.id,
    thumbnailPath: dto.thumbnailKey ? `${dto.id}${THUMB_SUFFIX}` : null,
    mimeType: dto.mimeType,
    fileSize: dto.fileSize,
    width: dto.width,
    height: dto.height,
    checksum: dto.verifiedChecksum ?? dto.claimedChecksum ?? null,
    previewable: dto.previewable,
    createdAt: dto.createdAt,
    verification: {
      verifiedChecksum: dto.verifiedChecksum ?? null,
      verifiedAt: dto.verifiedAt ?? null,
      mismatch: Boolean(dto.checksumMismatch),
    },
  };
}

function toAlbum(dto: AlbumDto): Album {
  return {
    id: dto.id,
    ownerId: dto.ownerId,
    title: dto.title,
    description: dto.description,
    coverPhotoId: dto.coverPhotoId,
    // Ảnh bìa dùng chính định danh ảnh, cùng quy ước như trên.
    coverThumbnailPath: dto.coverPhotoId ? `${dto.coverPhotoId}${THUMB_SUFFIX}` : null,
    coverStoragePath: dto.coverPhotoId,
    // Chưa biết chắc ảnh bìa có ảnh thu nhỏ hay không; nếu không, thẻ album sẽ
    // hiển thị nền trung tính thay vì vỡ ảnh.
    coverPreviewable: Boolean(dto.coverPhotoId),
    photoCount: dto.photoCount,
    totalBytes: dto.totalBytes,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

function toShare(dto: ShareDto): AlbumShare {
  return {
    id: dto.id,
    albumId: dto.albumId,
    ownerId: dto.ownerId,
    token: dto.token ?? null,
    allowDownload: dto.allowDownload,
    hasPassword: dto.hasPassword,
    expiresAt: dto.expiresAt,
    revokedAt: dto.revokedAt,
    createdAt: dto.createdAt,
    accessCount: dto.accessCount,
    lastAccessedAt: dto.lastAccessedAt,
  };
}

function photoQueryString(query: PhotoQuery): string {
  const params = new URLSearchParams();
  params.set("limit", String(query.limit ?? 60));
  if (query.sort) params.set("sort", query.sort);
  if (query.cursor) params.set("cursor", query.cursor);
  return params.toString();
}

/* ── Khoá ký URL có đệm ───────────────────────────────────────────────── */

interface SignedLink {
  url: string;
  expiresAt: number;
}

/**
 * Đệm liên kết đã ký theo ảnh + biến thể.
 *
 * Vì sao cần: lưới ảnh hỏi URL rất nhiều lần khi cuộn. Không đệm thì mỗi lần
 * cuộn lại sinh thêm một request ký, và mỗi request ký là một Class A operation
 * tính tiền. Liên kết sống 30 phút; đệm 25 phút để luôn còn hạn khi dùng.
 */
class LinkCache {
  private entries = new Map<string, SignedLink>();

  get(key: string): string | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.url;
  }

  set(key: string, url: string, ttlSeconds: number): void {
    this.entries.set(key, {
      url,
      // Chừa biên 5 phút và không bao giờ ngắn hơn 60 giây.
      expiresAt: Date.now() + Math.max(60, ttlSeconds - 300) * 1000,
    });
  }

  clear(): void {
    this.entries.clear();
  }
}

const linkCache = new LinkCache();

/* ── StorageProvider: URL có chữ ký ───────────────────────────────────── */

function splitPath(path: string): { photoId: string; variant: "thumb" | "original" } {
  if (path.endsWith(THUMB_SUFFIX)) {
    return { photoId: path.slice(0, -THUMB_SUFFIX.length), variant: "thumb" };
  }
  return { photoId: path, variant: "original" };
}

class ArchiveStorageProvider implements StorageProvider {
  readonly kind = "archive-signed";

  async upload(): Promise<void> {
    throw new ArchiveError(
      400,
      "Ở chế độ kho lưu trữ, tệp phải đi qua luồng tải lên nhiều phần. Dùng hàng đợi tải lên thay vì gọi trực tiếp.",
      "use_multipart_upload",
      null,
    );
  }

  async createUrl(path: string, expiresInSeconds = SIGNED_URL_TTL_SECONDS): Promise<string> {
    const { photoId, variant } = splitPath(path);
    const key = `${variant}:${photoId}`;
    const cached = linkCache.get(key);
    if (cached) return cached;

    const result = await archiveJson<{ url: string; expiresAt: string; ttlSeconds: number }>(
      `/api/photos/${encodeURIComponent(photoId)}/link`,
      { method: "POST", json: { variant } },
    );
    const url = archiveUrl(result.url);
    linkCache.set(key, url, result.ttlSeconds ?? expiresInSeconds);
    return url;
  }

  async createDownloadUrl(
    path: string,
    _filename: string,
    expiresInSeconds = SIGNED_URL_TTL_SECONDS,
  ): Promise<string> {
    // Tên tệp do Worker gắn qua Content-Disposition từ tên gốc đã lưu, nên không
    // truyền tên từ client — như vậy tên tải về luôn đúng tên đã lưu trữ.
    return this.createUrl(splitPath(path).photoId, expiresInSeconds);
  }

  async createUrls(
    paths: string[],
    expiresInSeconds = SIGNED_URL_TTL_SECONDS,
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const missing: { path: string; photoId: string; variant: "thumb" | "original" }[] = [];

    for (const path of paths) {
      const { photoId, variant } = splitPath(path);
      const cached = linkCache.get(`${variant}:${photoId}`);
      if (cached) result[path] = cached;
      else missing.push({ path, photoId, variant });
    }
    if (missing.length === 0) return result;

    // Gộp theo biến thể: một request cho ảnh thu nhỏ, một cho ảnh gốc.
    for (const variant of ["thumb", "original"] as const) {
      const group = missing.filter((item) => item.variant === variant);
      for (let index = 0; index < group.length; index += 200) {
        const chunk = group.slice(index, index + 200);
        const response = await archiveJson<{
          links: { id: string; url: string; expiresAt: string }[];
          ttlSeconds: number;
        }>("/api/photos/links", {
          method: "POST",
          json: { photoIds: chunk.map((item) => item.photoId), variant },
        });
        const byId = new Map(response.links.map((link) => [link.id, link.url]));
        for (const item of chunk) {
          const signed = byId.get(item.photoId);
          if (!signed) continue;
          const url = archiveUrl(signed);
          linkCache.set(`${variant}:${item.photoId}`, url, response.ttlSeconds ?? expiresInSeconds);
          result[item.path] = url;
        }
      }
    }
    return result;
  }

  async fetchBlob(path: string, signal?: AbortSignal): Promise<Blob> {
    const url = await this.createUrl(splitPath(path).photoId);
    return fetchSignedBlob(url.replace(archiveBaseUrlPrefix(), ""), signal);
  }

  async remove(paths: string[]): Promise<void> {
    const ids = [...new Set(paths.map((path) => splitPath(path).photoId))];
    for (const id of ids) {
      await archiveJson(`/api/photos/${encodeURIComponent(id)}`, { method: "DELETE" });
      linkCache.clear();
    }
  }

  async exists(path: string): Promise<boolean> {
    const { photoId } = splitPath(path);
    try {
      await archiveJson(`/api/photos/${encodeURIComponent(photoId)}`);
      return true;
    } catch (error) {
      if (error instanceof ArchiveError && error.status === 404) return false;
      throw error;
    }
  }

  releaseUrl(): void {
    // Liên kết có chữ ký không giữ tài nguyên cục bộ nào, và không thu hồi được
    // trước hạn. Việc thu hồi thật nằm ở trạng thái chia sẻ phía server.
  }
}

function archiveBaseUrlPrefix(): string {
  return archiveUrl("");
}

/* ── Auth: danh tính chủ kho ──────────────────────────────────────────── */

interface ProbeCache {
  ownerId: string;
  at: number;
}

let probeCache: ProbeCache | null = null;

class ArchiveAuthProvider implements AuthProvider {
  readonly kind = "archive" as const;

  async getCurrentUser() {
    const connection = readArchiveConnection();
    if (!connection) return null;
    if (probeCache && Date.now() - probeCache.at < 60_000) {
      return {
        id: probeCache.ownerId,
        email: connection.label ?? "chủ kho",
        displayName: connection.label ?? "Chủ kho",
        createdAt: connection.verifiedAt ?? new Date().toISOString(),
      };
    }
    try {
      const { probeArchive } = await import("./archiveClient");
      const probe = await probeArchive();
      probeCache = { ownerId: probe.ownerId, at: Date.now() };
      return {
        id: probe.ownerId,
        email: connection.label ?? "chủ kho",
        displayName: connection.label ?? "Chủ kho",
        createdAt: connection.verifiedAt ?? new Date().toISOString(),
      };
    } catch {
      // Mất kết nối hoặc token hết hiệu lực: coi như chưa đăng nhập, KHÔNG xoá
      // cấu hình — người dùng có thể chỉ đang ngoại tuyến.
      probeCache = null;
      return null;
    }
  }

  onAuthStateChange(): () => void {
    return () => undefined;
  }

  async signUp(): Promise<never> {
    throw new ArchiveError(
      400,
      "Kho lưu trữ không có đăng ký. Hãy kết nối tới Worker của bạn ở màn hình Kết nối kho lưu trữ.",
      "not_supported",
      null,
    );
  }

  async signIn(): Promise<never> {
    throw new ArchiveError(
      400,
      "Kho lưu trữ không dùng email/mật khẩu. Hãy kết nối bằng token chủ kho hoặc Cloudflare Access.",
      "not_supported",
      null,
    );
  }

  async signOut(): Promise<void> {
    probeCache = null;
    linkCache.clear();
    clearArchiveConnection();
  }

  async requestPasswordReset(): Promise<never> {
    throw new ArchiveError(400, "Không áp dụng cho kho lưu trữ.", "not_supported", null);
  }

  async updatePassword(): Promise<never> {
    throw new ArchiveError(400, "Không áp dụng cho kho lưu trữ.", "not_supported", null);
  }

  /** Xác minh và lưu kết nối. Không lưu gì khi chưa xác minh được. */
  async connect(input: {
    baseUrl: string;
    token: string | null;
    label: string | null;
  }): Promise<{ ownerId: string; driver: string }> {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const previous = readArchiveConnection();
    const candidate: ArchiveConnection = {
      baseUrl,
      token: input.token && input.token.trim() ? input.token.trim() : null,
      label: input.label?.trim() || null,
      verifiedAt: null,
    };
    writeArchiveConnection(candidate);
    try {
      const { probeArchive } = await import("./archiveClient");
      const probe = await probeArchive();
      probeCache = { ownerId: probe.ownerId, at: Date.now() };
      writeArchiveConnection({ ...candidate, verifiedAt: new Date().toISOString() });
      return { ownerId: probe.ownerId, driver: probe.driver };
    } catch (error) {
      // Sai token thì KHÔNG để lại cấu hình hỏng.
      if (previous) writeArchiveConnection(previous);
      else clearArchiveConnection();
      probeCache = null;
      throw error;
    }
  }
}

/* ── Albums ───────────────────────────────────────────────────────────── */

const albums: AlbumRepository = {
  async list(query: AlbumQuery): Promise<Paged<Album>> {
    const params = new URLSearchParams();
    params.set("limit", String(query.limit ?? 24));
    if (query.sort) params.set("sort", query.sort);
    if (query.search) params.set("search", query.search);
    if (query.cursor) params.set("cursor", query.cursor);
    const result = await archiveJson<{ items: AlbumDto[]; nextCursor: string | null }>(
      `/api/albums?${params.toString()}`,
    );
    return { items: result.items.map(toAlbum), nextCursor: result.nextCursor };
  },

  async get(albumId: string): Promise<Album | null> {
    try {
      const result = await archiveJson<{ album: AlbumDto }>(`/api/albums/${encodeURIComponent(albumId)}`);
      return result.album ? toAlbum(result.album) : null;
    } catch (error) {
      if (error instanceof ArchiveError && error.status === 404) return null;
      throw error;
    }
  },

  async create(input: CreateAlbumInput): Promise<Album> {
    const result = await archiveJson<{ album: AlbumDto }>("/api/albums", {
      method: "POST",
      json: { title: input.title, description: input.description ?? null },
    });
    return toAlbum(result.album);
  },

  async update(albumId: string, input: UpdateAlbumInput): Promise<Album> {
    const result = await archiveJson<{ album: AlbumDto }>(
      `/api/albums/${encodeURIComponent(albumId)}`,
      { method: "PATCH", json: input },
    );
    return toAlbum(result.album);
  },

  async remove(albumId: string): Promise<void> {
    await archiveJson(`/api/albums/${encodeURIComponent(albumId)}`, { method: "DELETE" });
  },

  async listRecent(limit: number): Promise<Album[]> {
    const result = await this.list({ limit });
    return result.items;
  },
};

/* ── Photos ───────────────────────────────────────────────────────────── */

const OWNER_PAGE_LIMIT = 500;
/** Trần an toàn khi duyệt hết album: 200 trang × 500 ảnh = 100.000 ảnh. */
const OWNER_MAX_PAGES = 200;

const photos: PhotoRepository = {
  async list(query: PhotoQuery): Promise<Paged<Photo>> {
    const result = await archiveJson<{ items: PhotoDto[]; nextCursor: string | null; total?: number }>(
      `/api/albums/${encodeURIComponent(query.albumId)}/photos?${photoQueryString(query)}`,
    );
    return {
      items: result.items.map(toPhoto),
      nextCursor: result.nextCursor,
      total: result.total,
    };
  },

  async get(photoId: string): Promise<Photo | null> {
    try {
      const result = await archiveJson<{ photo: PhotoDto }>(`/api/photos/${encodeURIComponent(photoId)}`);
      return result.photo ? toPhoto(result.photo) : null;
    } catch (error) {
      if (error instanceof ArchiveError && error.status === 404) return null;
      throw error;
    }
  },

  async listAllMetadata(albumId: string): Promise<Photo[]> {
    const all: Photo[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < OWNER_MAX_PAGES; page += 1) {
      const result = await this.list({ albumId, limit: OWNER_PAGE_LIMIT, cursor, sort: "uploaded-desc" });
      all.push(...result.items);
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    return all;
  },

  async insert(): Promise<never> {
    throw new ArchiveError(
      400,
      "Ảnh được tạo bởi chính phiên tải lên nhiều phần trên kho lưu trữ, không chèn trực tiếp. Dùng hàng đợi tải lên.",
      "use_multipart_upload",
      null,
    );
  },

  async remove(photoIds: string[]): Promise<void> {
    for (const id of photoIds) {
      await archiveJson(`/api/photos/${encodeURIComponent(id)}`, { method: "DELETE" });
    }
  },

  async findByChecksum(): Promise<null> {
    // Không quét toàn kho theo checksum: việc chặn trùng do SERVER làm ngay khi
    // tạo phiên tải lên, trước khi một byte nào được gửi. Trả về null ở đây chỉ
    // có nghĩa "không kiểm tra tại chỗ", không phải "chắc chắn không trùng".
    return null;
  },

  async setThumbnail(): Promise<never> {
    throw new ArchiveError(
      400,
      "Ảnh thu nhỏ do Worker quản lý (POST /api/photos/:id/thumbnail). Dùng attachThumbnail của luồng tải lên.",
      "use_multipart_upload",
      null,
    );
  },
};

/* ── Shares ───────────────────────────────────────────────────────────── */

const shares: ShareRepository & {
  resolveGuestUrls(token: string, password: string | null, photos: Photo[], purpose: "thumbnail" | "original"): Promise<Record<string, string>>;
  createGuestDownloadUrl(token: string, password: string | null, photo: Photo): Promise<string>;
} = {
  async listForAlbum(albumId: string): Promise<AlbumShare[]> {
    const result = await archiveJson<{ shares: ShareDto[] }>(
      `/api/albums/${encodeURIComponent(albumId)}/shares`,
    );
    return result.shares.map(toShare);
  },

  async create(input: CreateShareInput): Promise<AlbumShare> {
    const result = await archiveJson<{ share: ShareDto; tokenVisibleOnce: boolean }>(
      `/api/albums/${encodeURIComponent(input.albumId)}/shares`,
      {
        method: "POST",
        json: {
          allowDownload: input.allowDownload,
          password: input.password ?? null,
          expiresInDays: input.expiresInDays ?? null,
        },
      },
    );
    // Token thô chỉ có ở đúng phản hồi này; server chỉ lưu hash.
    return toShare(result.share);
  },

  async update(shareId: string, input: UpdateShareInput): Promise<AlbumShare> {
    const result = await archiveJson<{ share: ShareDto }>(`/api/shares/${encodeURIComponent(shareId)}`, {
      method: "PATCH",
      json: {
        allowDownload: input.allowDownload,
        password: input.password ?? null,
        removePassword: input.removePassword,
        expiresInDays: input.expiresInDays,
      },
    });
    return toShare(result.share);
  },

  async revoke(shareId: string): Promise<void> {
    await archiveJson(`/api/shares/${encodeURIComponent(shareId)}`, { method: "DELETE" });
  },

  async resolveAccess(token: string, password?: string | null): Promise<ShareAccess> {
    return archiveJson<ShareAccess>(`/api/shared/${encodeURIComponent(token)}/resolve`, {
      method: "POST",
      json: { password: password ?? null },
      anonymous: true,
    });
  },

  async listSharedPhotos(token, password, query): Promise<Paged<Photo>> {
    const result = await archiveJson<{ items: PhotoDto[]; nextCursor: string | null }>(
      `/api/shared/${encodeURIComponent(token)}/photos`,
      {
        method: "POST",
        anonymous: true,
        json: {
          password: password ?? null,
          cursor: query.cursor ?? null,
          limit: query.limit ?? 60,
          sort: query.sort ?? "uploaded-desc",
        },
      },
    );
    return { items: result.items.map(toPhoto), nextCursor: result.nextCursor };
  },

  async fetchSharedOriginalBlob(token, password, photo): Promise<Blob> {
    const url = await this.createGuestDownloadUrl(token, password, photo);
    return fetchSignedBlob(url.replace(archiveBaseUrlPrefix(), ""));
  },

  /** URL hiển thị cho lưới ảnh của khách. */
  async resolveGuestUrls(token, password, photoList, purpose): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const links = await archiveJson<{ links: { id: string; url: string }[] }>(
      `/api/shared/${encodeURIComponent(token)}/photos`,
      { method: "POST", anonymous: true, json: { password: password ?? null, limit: 1 } },
    );
    void links; // chỉ để giữ chữ ký hàm rõ ràng; URL lấy theo từng ảnh bên dưới

    for (const photo of photoList) {
      try {
        const signed = await archiveJson<{ url: string }>(
          `/api/shared/${encodeURIComponent(token)}/link`,
          {
            method: "POST",
            anonymous: true,
            json: {
              password: password ?? null,
              photoId: photo.id,
              variant: purpose === "thumbnail" ? "thumb" : "original",
            },
          },
        );
        result[photo.id] = archiveUrl(signed.url);
      } catch {
        // Ảnh chưa có bản thu nhỏ hoặc không xem trước được: bỏ qua ảnh đó.
      }
    }
    return result;
  },

  async createGuestDownloadUrl(token, password, photo): Promise<string> {
    const signed = await archiveJson<{ url: string }>(`/api/shared/${encodeURIComponent(token)}/link`, {
      method: "POST",
      anonymous: true,
      json: { password: password ?? null, photoId: photo.id, variant: "original" },
    });
    return archiveUrl(signed.url);
  },
};

/* ── Tải lên nhiều phần ───────────────────────────────────────────────── */

const PART_ATTEMPTS = 3;

async function waitFor(seconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

const multipart: MultipartUploader = {
  kind: "r2-multipart-via-worker",

  async upload(request: MultipartUploadRequest): Promise<MultipartUploadResult> {
    const { albumId, file, filename, mimeType, width, height, previewable, checksum, signal } = request;
    const totalBytes = file.size;

    const report = (progress: Partial<MultipartProgress> & { phase: MultipartProgress["phase"] }): void => {
      request.onProgress?.({
        phase: progress.phase,
        sessionId: progress.sessionId ?? session?.id ?? null,
        uploadedBytes: progress.uploadedBytes ?? 0,
        totalBytes,
        completedParts: progress.completedParts ?? [],
        totalParts: progress.totalParts ?? session?.partCount ?? 0,
        partSize: progress.partSize ?? session?.partSize ?? 0,
        resumed: progress.resumed ?? resumed,
      });
    };

    let session: SessionDto | null = null;
    let resumed = false;
    /** Số phần đã nằm trên kho lưu trữ — lấy từ SERVER, không từ bộ nhớ trình duyệt. */
    let completedParts: number[] = [];
    /** Số byte đã nằm trên kho lưu trữ. */
    let uploadedBytes = 0;

    // 1. Nối tiếp phiên cũ nếu có, và chỉ khi tệp khớp về kích thước — ghép các
    //    phần của hai tệp khác nhau sẽ tạo ra một tệp hỏng.
    if (request.resumeSessionId) {
      try {
        const existing = await archiveJson<{ session: SessionDto } & PartsSummary>(
          `/api/uploads/${encodeURIComponent(request.resumeSessionId)}`,
        );
        if (existing.session.totalBytes !== totalBytes) {
          throw new ArchiveError(
            409,
            `Phiên cũ dành cho tệp ${existing.session.totalBytes} byte, tệp đang chọn là ${totalBytes} byte. Không thể nối tiếp — hãy chọn đúng tệp gốc.`,
            "size_mismatch",
            null,
          );
        }
        session = existing.session;
        // Thông tin phần nằm ở CẤP TRÊN của phản hồi, không nằm trong `session`.
        completedParts = [...(existing.uploadedParts ?? [])];
        uploadedBytes = existing.uploadedBytes ?? 0;
        resumed = true;
      } catch (error) {
        if (error instanceof ArchiveError && error.code === "size_mismatch") throw error;
        session = null; // phiên đã biến mất: tạo phiên mới bên dưới
      }
    }

    // 2. Tạo phiên mới. Trùng nội dung bị chặn Ở ĐÂY, trước khi gửi byte nào.
    if (!session) {
      const created = await archiveJson<{ session: SessionDto; uploadMode: string }>("/api/uploads", {
        method: "POST",
        json: {
          albumId,
          filename,
          totalBytes,
          mimeType,
          claimedChecksum: checksum,
          width,
          height,
          previewable,
        },
      });
      session = created.session;
      // Phiên mới: chưa có phần nào trên kho lưu trữ.
      completedParts = [];
      uploadedBytes = 0;
    }

    const active = session;
    report({
      phase: "uploading",
      sessionId: active.id,
      uploadedBytes,
      completedParts: [...completedParts],
      totalParts: active.partCount,
      partSize: active.partSize,
      resumed,
    });

    // 3. Gửi những phần còn thiếu. Danh sách lấy từ SERVER, không từ bộ nhớ
    //    trình duyệt — nhờ vậy mở lại tab vẫn biết chính xác đang ở đâu.
    for (let partNumber = 1; partNumber <= active.partCount; partNumber += 1) {
      if (signal?.aborted) throw new DOMException("Đã huỷ", "AbortError");
      if (completedParts.includes(partNumber)) continue;

      const offset = (partNumber - 1) * active.partSize;
      const length = Math.min(active.partSize, totalBytes - offset);
      const chunk = file.slice(offset, offset + length);

      let lastError: unknown = null;
      for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt += 1) {
        try {
          await putPart(active.id, partNumber, chunk, signal);
          lastError = null;
          break;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
          lastError = error;
          const status = error instanceof ArchiveError ? error.status : 0;
          // 4xx (trừ 408/429) là lỗi vĩnh viễn: thử lại chỉ tốn thời gian.
          if (status >= 400 && status < 500 && status !== 408 && status !== 429) break;
          if (attempt < PART_ATTEMPTS) await waitFor(1.5 * attempt);
        }
      }
      if (lastError) throw lastError;

      uploadedBytes += length;
      completedParts.push(partNumber);
      report({
        phase: "uploading",
        sessionId: active.id,
        uploadedBytes,
        completedParts: [...completedParts],
        totalParts: active.partCount,
        partSize: active.partSize,
      });
    }

    // 4. Ghép các phần và để SERVER xác minh kích thước thật của object.
    report({
      phase: "verifying",
      sessionId: active.id,
      uploadedBytes,
      completedParts: [...completedParts],
      totalParts: active.partCount,
      partSize: active.partSize,
    });
    const completed = await archiveJson<{
      photo: PhotoDto;
      sizeVerified: boolean;
      checksumVerification: string;
    }>(`/api/uploads/${encodeURIComponent(active.id)}/complete`, { method: "POST" });

    return {
      photo: toPhoto(completed.photo),
      sessionId: active.id,
      resumed,
      verifiedBytes: completed.photo.fileSize,
    };
  },

  async attachThumbnail(photoId: string, blob: Blob, mimeType: string): Promise<string | null> {
    const headers = new Headers({ "content-type": mimeType });
    const token = readArchiveConnection()?.token;
    if (token) headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(archiveUrl(`/api/photos/${encodeURIComponent(photoId)}/thumbnail`), {
      method: "POST",
      headers,
      body: blob as BodyInit,
      credentials: archiveBaseUrlPrefix() ? "include" : "same-origin",
    });
    if (!response.ok) {
      // Ảnh thu nhỏ lỗi KHÔNG được làm hỏng việc lưu ảnh gốc.
      throw new ArchiveError(response.status, "Không gắn được ảnh thu nhỏ.", "thumbnail_failed", null);
    }
    // Ảnh thu nhỏ mới đổi trạng thái có bản xem trước: xoá đệm liên kết cũ.
    linkCache.clear();
    // Trả về đường dẫn để tầng gọi cập nhật đối tượng ảnh đang giữ trong bộ nhớ.
    return `${photoId}${THUMB_SUFFIX}`;
  },

  async listActiveSessions(): Promise<ActiveUploadSession[]> {
    const result = await archiveJson<{ sessions: (SessionDto & PartsSummary)[] }>("/api/uploads");
    return result.sessions.map((session) => {
      const uploaded = new Set(session.uploadedParts ?? []);
      const missingParts: number[] = [];
      for (let part = 1; part <= session.partCount; part += 1) {
        if (!uploaded.has(part)) missingParts.push(part);
      }
      return {
        id: session.id,
        albumId: session.albumId,
        // Worker đặt tên trường là `filename`; giao diện dùng `originalFilename`.
        originalFilename: session.filename,
        mimeType: session.mimeType,
        totalBytes: session.totalBytes,
        partSize: session.partSize,
        partCount: session.partCount,
        uploadedBytes: session.uploadedBytes ?? 0,
        completedParts: uploaded.size,
        missingParts,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      };
    });
  },

  async abortSession(sessionId: string): Promise<void> {
    await archiveJson(`/api/uploads/${encodeURIComponent(sessionId)}/abort`, { method: "POST" });
  },

  async verifyPhoto(photoId: string): Promise<void> {
    await archiveJson("/api/maintenance/run", { method: "POST", json: { photoIds: [photoId] } });
  },
};

/** Gửi một phần lên Worker. Worker chuyển tiếp sang R2 (multipart). */
async function putPart(
  sessionId: string,
  partNumber: number,
  chunk: Blob,
  signal?: AbortSignal,
): Promise<void> {
  const headers = new Headers({ "content-type": "application/octet-stream" });
  const token = readArchiveConnection()?.token;
  if (token) headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(
    archiveUrl(`/api/uploads/${encodeURIComponent(sessionId)}/parts/${partNumber}`),
    {
      method: "PUT",
      headers,
      body: chunk as BodyInit,
      signal,
      credentials: archiveBaseUrlPrefix() ? "include" : "same-origin",
    },
  );
  if (!response.ok) {
    let message = `Phần ${partNumber} tải lên thất bại (${response.status}).`;
    let code: string | null = null;
    try {
      const payload = (await response.json()) as { error?: string; code?: string };
      if (payload.error) message = payload.error;
      if (payload.code) code = payload.code;
    } catch {
      // giữ thông điệp mặc định
    }
    throw new ArchiveError(response.status, message, code, null);
  }
}

/* ── Dung lượng & sức khoẻ ────────────────────────────────────────────── */

const usage: UsageRepository = {
  async getUsage(): Promise<StorageUsage> {
    const details = await archiveJson<ArchiveUsage>("/api/usage");
    return {
      usedBytes: details.usedBytes,
      photoCount: details.photoCount,
      albumCount: details.albumCount,
      // KHÔNG có hạn mức do ứng dụng đặt. Ngưỡng cảnh báo của nhà cung cấp nằm
      // trong `usageDetails().thresholds` và chỉ để CẢNH BÁO.
      quotaBytes: null,
    };
  },
};

/* ── Băm cục bộ trước khi tải lên ─────────────────────────────────────── */

/**
 * Băm SHA-256 của tệp gốc Ở TRÌNH DUYỆT, theo luồng.
 *
 * Vì sao phải băm trước: nhờ có checksum, kho lưu trữ chặn được ảnh trùng NGAY
 * khi tạo phiên — trước khi tốn bằng thông để gửi 500 MB. Và sau khi ghép các
 * phần, server đọc lại object rồi băm lần nữa: hai lần băm độc lập là cách phát
 * hiện tệp hỏng hoặc bị xen vào giữa đường.
 */
export async function hashOriginalFile(
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  return sha256Blob(file, onProgress, signal);
}

/* ── Backend ──────────────────────────────────────────────────────────── */

const archiveAuth = new ArchiveAuthProvider();
let storageProvider: ArchiveStorageProvider | null = null;

function storage(): ArchiveStorageProvider {
  if (!storageProvider) storageProvider = new ArchiveStorageProvider();
  return storageProvider;
}

export function createArchiveBackend(): GalleryBackend {
  const connection = readArchiveConnection();
  return {
    mode: "archive",
    storageKind: "archive-signed",
    auth: archiveAuth,
    albums,
    photos,
    shares,
    storage: storage(),
    thumbnailStorage: storage(),
    usage,
    multipart,
    usageDetails: () => archiveJson<ArchiveUsage>("/api/usage"),
    health: () => archiveJson<ArchiveHealth>("/api/health"),
    runMaintenance: () =>
      archiveJson<ArchiveMaintenanceResult>("/api/maintenance/run", { method: "POST", json: {} }),
    description: connection
      ? `Kho Cloudflare R2 (${connection.baseUrl || "cùng origin"}) — ảnh gốc nguyên byte, không nén lại.`
      : "Kho Cloudflare R2 — chưa kết nối.",
  };
}

/** Truy cập phần kết nối/khoá của backend kho lưu trữ từ giao diện. */
export const archiveConnection = {
  current: (): ArchiveConnection | null => readArchiveConnection(),
  connect: (input: { baseUrl: string; token: string | null; label: string | null }) =>
    archiveAuth.connect(input),
  disconnect: async (): Promise<void> => {
    await archiveAuth.signOut();
  },
  refresh: (): void => {
    probeCache = null;
    linkCache.clear();
  },
  /** Băm tệp gốc cục bộ (dùng cho nút \"chọn tệp\" và cho luồng tải lên). */
  hashFile: hashOriginalFile,
  /** Kiểm tra nhanh một tệp có phải định dạng xem trước được không. */
  resolveMimeType,
  isArchiveError: (error: unknown): error is ArchiveError => error instanceof ArchiveError,
  isDuplicateError,
};
