import type { AlbumShare, CreateShareInput, Paged, Photo, ShareAccess, UpdateShareInput } from "@/types";
import { getBackend } from "./backend";
import { getSharedPhotoUrls } from "./supabase/supabaseBackend";
import { getSupabaseClient } from "./supabase/client";
import { SHARE_FUNCTION_NAME } from "@/config/env";
import { sourceFromBlobFactory, sourceFromResponse, type OriginalSource } from "./originalSource";

/**
 * Dịch vụ chia sẻ.
 *
 * Nguyên tắc bảo mật: mọi quyết định cho phép/không cho phép đều được đưa ra ở
 * phía backend (RLS hoặc Edge Function). Ở đây chỉ là lớp gọi hàm, không có
 * bất kỳ kiểm tra quyền nào phía client có thể bị vượt qua.
 */

/** URL công khai để gửi cho bạn bè: `/share/<token>`. */
export function buildShareUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/share/${token}`;
}

export const shareService = {
  async listForAlbum(albumId: string): Promise<AlbumShare[]> {
    return getBackend().shares.listForAlbum(albumId);
  },

  async create(input: CreateShareInput): Promise<AlbumShare> {
    return getBackend().shares.create(input);
  },

  async update(shareId: string, input: UpdateShareInput): Promise<AlbumShare> {
    return getBackend().shares.update(shareId, input);
  },

  async revoke(shareId: string): Promise<void> {
    return getBackend().shares.revoke(shareId);
  },

  /** Xác minh token + mật khẩu (phía backend). */
  async resolveAccess(token: string, password?: string | null): Promise<ShareAccess> {
    return getBackend().shares.resolveAccess(token, password);
  },

  async listPhotos(
    token: string,
    password: string | null,
    query: { cursor?: string | null; limit?: number } = {},
  ): Promise<Paged<Photo>> {
    return getBackend().shares.listSharedPhotos(token, password, {
      cursor: query.cursor ?? null,
      limit: query.limit ?? 60,
      sort: "uploaded-desc",
    });
  },

  /** URL hiển thị cho lưới ảnh của khách. */
  async resolveUrls(
    token: string,
    password: string | null,
    photos: Photo[],
    purpose: "thumbnail" | "original",
  ): Promise<Record<string, string>> {
    const backend = getBackend();
    if (backend.mode === "archive" && backend.shares.resolveGuestUrls) {
      // Kho lưu trữ riêng tư: mỗi URL được ký riêng, ngắn hạn, và gắn với đúng
      // album của liên kết. Không có đường dẫn công khai nào để lộ.
      return backend.shares.resolveGuestUrls(token, password, photos, purpose);
    }
    if (backend.mode === "supabase") {
      return getSharedPhotoUrls(token, password, photos, purpose);
    }
    // Backend cục bộ: đọc trực tiếp sau khi đã xác minh quyền.
    const result: Record<string, string> = {};
    for (const photo of photos) {
      try {
        const path =
          purpose === "thumbnail" && photo.thumbnailPath
            ? photo.thumbnailPath
            : photo.storagePath;
        const urls = await backend.storage.createUrls?.([path]);
        const url = urls?.[path] ?? (await backend.storage.createUrl(path));
        result[photo.id] = url;
      } catch {
        // Ảnh thiếu hoặc định dạng không xem trước được: bỏ qua.
      }
    }
    return result;
  },

  /** Nguồn byte GỐC cho khách tải xuống (đã được backend cấp quyền). */
  async getOriginalSource(
    token: string,
    password: string | null,
    photo: Photo,
  ): Promise<OriginalSource> {
    const backend = getBackend();
    if (backend.mode === "archive" && backend.shares.createGuestDownloadUrl) {
      // URL có chữ ký + đọc theo luồng: khách tải tệp 500 MB mà không phải nạp
      // trọn vào bộ nhớ.
      const blobUrl = await backend.shares.createGuestDownloadUrl(token, password, photo);
      const response = await fetch(blobUrl);
      if (!response.ok) throw new Error(`Không tải được ảnh gốc (${response.status}).`);
      return sourceFromResponse(response, photo.fileSize);
    }
    if (backend.mode === "supabase") {
      // Backend trả signed URL ngắn hạn; đọc theo luồng để không nạp cả tệp.
      const blobUrl = await getSharedDownloadUrl(token, password, photo);
      const response = await fetch(blobUrl);
      if (!response.ok) throw new Error("Không tải được ảnh gốc.");
      return sourceFromResponse(response, photo.fileSize);
    }
    return sourceFromBlobFactory(
      () => backend.shares.fetchSharedOriginalBlob(token, password, photo),
      photo.fileSize,
    );
  },
};

/** Lấy signed URL tải xuống cho khách (Supabase: qua Edge Function). */
function getSharedDownloadUrl(
  token: string,
  password: string | null,
  photo: Photo,
): Promise<string> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Chưa cấu hình Supabase.");
  return supabase.functions
    .invoke<{
      data: { url: string } | null;
      error: string | null;
    }>(SHARE_FUNCTION_NAME, {
      body: {
        action: "download-url",
        token,
        password,
        photoId: photo.id,
        filename: photo.originalFilename,
      },
    })
    .then(({ data, error }) => {
      if (error || !data?.data?.url) {
        throw new Error(error?.message ?? data?.error ?? "Không lấy được liên kết tải xuống.");
      }
      return data.data.url;
    });
}
