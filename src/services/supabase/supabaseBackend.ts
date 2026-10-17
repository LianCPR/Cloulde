import type {
  Album,
  AlbumQuery,
  AlbumShare,
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
import type {
  AlbumRepository,
  GalleryBackend,
  PhotoRepository,
  ShareRepository,
  UsageRepository,
} from "@/services/ports";
import { BUCKETS, SHARE_FUNCTION_NAME } from "@/config/env";
import { AuthRequiredError, NotFoundError } from "@/services/errors";
import { decodeCursor, encodeCursor } from "@/services/cursor";
import { normalizeSearchKey } from "@/lib/search";
import { normalizeFilenameKey } from "@/lib/fileTypes";
import { requireSupabaseClient } from "./client";
import { supabaseAuth } from "./supabaseAuth";
import { SupabaseStorageProvider } from "./supabaseStorage";

/**
 * Backend Supabase: PostgreSQL (RLS) + Storage + Auth + Edge Function chia sẻ.
 *
 * Nguyên tắc:
 *  - Mọi truy vấn đều bị giới hạn bởi RLS theo `auth.uid()`; frontend không
 *    bao giờ là nơi duy nhất kiểm tra quyền.
 *  - Chia sẻ công khai đi qua Edge Function vì chỉ ở đó mới có service role
 *    để xác minh token/mật khẩu và cấp signed URL ngắn hạn.
 */

/* ── Ánh xạ dữ liệu từ cơ sở dữ liệu ─────────────────────────── */

interface AlbumRow {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  cover_photo_id: string | null;
  photo_count: number | null;
  total_bytes: number | null;
  created_at: string;
  updated_at: string;
  title_key?: string;
  /** Ảnh bìa lấy kèm bằng một phép join — tránh N+1 truy vấn ở lưới album. */
  cover?: {
    storage_path: string;
    thumbnail_path: string | null;
    previewable: boolean | null;
  } | null;
}

/** Các cột cần cho lưới album, kèm ảnh bìa. */
const ALBUM_SELECT =
  "*, cover:photos!albums_cover_photo_id_fkey(storage_path, thumbnail_path, previewable)";

interface PhotoRow {
  id: string;
  album_id: string;
  owner_id: string;
  original_filename: string;
  storage_path: string;
  thumbnail_path: string | null;
  mime_type: string;
  file_size: number | string;
  width: number | null;
  height: number | null;
  checksum: string | null;
  previewable: boolean | null;
  created_at: string;
}

function mapAlbum(row: AlbumRow): Album {
  // `cover` có thể là object đơn hoặc mảng tuỳ cách PostgREST trả về quan hệ 1-1.
  const cover = Array.isArray(row.cover) ? (row.cover[0] ?? null) : (row.cover ?? null);
  row = { ...row, cover };
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    description: row.description,
    coverPhotoId: row.cover_photo_id,
    coverThumbnailPath: row.cover?.thumbnail_path ?? null,
    coverStoragePath: row.cover?.storage_path ?? null,
    coverPreviewable: row.cover?.previewable ?? false,
    photoCount: row.photo_count ?? 0,
    totalBytes: Number(row.total_bytes ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    albumId: row.album_id,
    ownerId: row.owner_id,
    originalFilename: row.original_filename,
    storagePath: row.storage_path,
    thumbnailPath: row.thumbnail_path,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size ?? 0),
    width: row.width,
    height: row.height,
    checksum: row.checksum,
    previewable: row.previewable ?? true,
    createdAt: row.created_at,
  };
}

async function requireUserId(): Promise<string> {
  const supabase = requireSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AuthRequiredError();
  return user.id;
}

/* ── Album ────────────────────────────────────────────────────── */

const albumRepository: AlbumRepository = {
  async list(query: AlbumQuery): Promise<Paged<Album>> {
    const supabase = requireSupabaseClient();
    const ownerId = await requireUserId();
    const limit = Math.min(Math.max(query.limit ?? 24, 1), 100);
    const sort = query.sort ?? "newest";
    const cursor = decodeCursor(query.cursor);

    const orderColumn = sort === "title" ? "title_key" : "created_at";
    const ascending = sort === "oldest";

    let statement = supabase
      .from("albums")
      .select(ALBUM_SELECT, { count: "exact" })
      .eq("owner_id", ownerId);

    const search = query.search?.trim();
    if (search) {
      statement = statement.ilike("search_key", `%${normalizeSearchKey(search)}%`);
    }

    if (cursor) {
      const operator = ascending ? "gt" : "lt";
      statement = statement.or(
        `${orderColumn}.${operator}.${cursor.key},and(${orderColumn}.eq.${cursor.key},id.${operator}.${cursor.id})`,
      );
    }

    const { data, error, count } = await statement
      .order(orderColumn, { ascending })
      .order("id", { ascending })
      .limit(limit + 1);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as AlbumRow[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map(mapAlbum),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              key: sort === "title" ? (last.title_key ?? last.title) : last.created_at,
              id: last.id,
            })
          : null,
      total: count ?? undefined,
    };
  },

  async get(albumId: string): Promise<Album | null> {
    const supabase = requireSupabaseClient();
    await requireUserId();
    const { data, error } = await supabase
      .from("albums")
      .select(ALBUM_SELECT)
      .eq("id", albumId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapAlbum(data as unknown as AlbumRow) : null;
  },

  async create(input: CreateAlbumInput): Promise<Album> {
    const supabase = requireSupabaseClient();
    const ownerId = await requireUserId();
    const title = input.title.trim();
    const description = input.description?.trim() || null;
    const { data, error } = await supabase
      .from("albums")
      .insert({
        owner_id: ownerId,
        title,
        description,
        search_key: normalizeSearchKey(`${title} ${description ?? ""}`),
        title_key: normalizeSearchKey(title),
      })
      .select(ALBUM_SELECT)
      .single();
    if (error) throw new Error(error.message);
    return mapAlbum(data as unknown as AlbumRow);
  },

  async update(albumId: string, input: UpdateAlbumInput): Promise<Album> {
    const supabase = requireSupabaseClient();
    await requireUserId();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.title !== undefined) {
      patch.title = input.title.trim();
      patch.title_key = normalizeSearchKey(input.title);
    }
    if (input.description !== undefined) patch.description = input.description?.trim() || null;
    if (input.coverPhotoId !== undefined) patch.cover_photo_id = input.coverPhotoId;

    const { data, error } = await supabase
      .from("albums")
      .update(patch)
      .eq("id", albumId)
      .select(ALBUM_SELECT)
      .single();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundError("Album không tồn tại.");

    // Cập nhật lại khoá tìm kiếm tổng hợp sau khi đổi tiêu đề/mô tả.
    if (input.title !== undefined || input.description !== undefined) {
      const row = data as AlbumRow;
      await supabase
        .from("albums")
        .update({ search_key: normalizeSearchKey(`${row.title} ${row.description ?? ""}`) })
        .eq("id", albumId);
    }
    return mapAlbum(data as unknown as AlbumRow);
  },

  async remove(albumId: string): Promise<void> {
    const supabase = requireSupabaseClient();
    await requireUserId();
    // Thu thập đường dẫn object TRƯỚC khi xoá bản ghi để chỉ xoá đúng
    // những tệp thuộc album này, không đụng tới dữ liệu khác.
    const { data: photos, error: photoError } = await supabase
      .from("photos")
      .select("storage_path, thumbnail_path")
      .eq("album_id", albumId);
    if (photoError) throw new Error(photoError.message);

    const { error } = await supabase.from("albums").delete().eq("id", albumId);
    if (error) throw new Error(error.message);

    const paths = (photos ?? []) as { storage_path: string; thumbnail_path: string | null }[];
    if (paths.length > 0) {
      const originals = new SupabaseStorageProvider(BUCKETS.originals);
      const thumbnails = new SupabaseStorageProvider(BUCKETS.thumbnails);
      await originals
        .remove(paths.map((p) => p.storage_path))
        .catch((error: unknown) => console.warn("Không xoá được một số ảnh gốc:", error));
      await thumbnails
        .remove(paths.flatMap((p) => (p.thumbnail_path ? [p.thumbnail_path] : [])))
        .catch((error: unknown) => console.warn("Không xoá được một số ảnh thu nhỏ:", error));
    }
  },

  async listRecent(limit: number): Promise<Album[]> {
    const supabase = requireSupabaseClient();
    const ownerId = await supabase.auth
      .getUser()
      .then(({ data }) => data.user?.id ?? null)
      .catch(() => null);
    if (!ownerId) return [];
    const { data, error } = await supabase
      .from("albums")
      .select(ALBUM_SELECT)
      .eq("owner_id", ownerId)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return ((data ?? []) as unknown as AlbumRow[]).map(mapAlbum);
  },
};

/* ── Ảnh ──────────────────────────────────────────────────────── */

const photoRepository: PhotoRepository = {
  async list(query: PhotoQuery): Promise<Paged<Photo>> {
    const supabase = requireSupabaseClient();
    await requireUserId();
    const limit = Math.min(Math.max(query.limit ?? 400, 1), 400);
    const sort = query.sort ?? "uploaded-desc";
    const cursor = decodeCursor(query.cursor);
    const orderColumn = sort === "filename-asc" ? "filename_key" : "created_at";
    const ascending = sort === "uploaded-asc" || sort === "filename-asc";

    let statement = supabase
      .from("photos")
      .select("*", { count: "exact" })
      .eq("album_id", query.albumId);

    if (cursor) {
      const operator = ascending ? "gt" : "lt";
      statement = statement.or(
        `${orderColumn}.${operator}.${cursor.key},and(${orderColumn}.eq.${cursor.key},id.${operator}.${cursor.id})`,
      );
    }

    const { data, error, count } = await statement
      .order(orderColumn, { ascending })
      .order("id", { ascending })
      .limit(limit + 1);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as (PhotoRow & { filename_key?: string })[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map(mapPhoto),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              key: orderColumn === "filename_key" ? (last.filename_key ?? "") : last.created_at,
              id: last.id,
            })
          : null,
      total: count ?? undefined,
    };
  },

  async get(photoId: string): Promise<Photo | null> {
    const supabase = requireSupabaseClient();
    await requireUserId();
    const { data, error } = await supabase
      .from("photos")
      .select("*")
      .eq("id", photoId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapPhoto(data as PhotoRow) : null;
  },

  async listAllMetadata(albumId: string): Promise<Photo[]> {
    const supabase = requireSupabaseClient();
    await requireUserId();
    // Chỉ lấy metadata, KHÔNG lấy nội dung ảnh. Phân trang nội bộ để tránh
    // truy vấn không giới hạn khi album có hàng nghìn ảnh.
    const pageSize = 1000;
    const collected: Photo[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("photos")
        .select("*")
        .eq("album_id", albumId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as PhotoRow[];
      collected.push(...rows.map(mapPhoto));
      if (rows.length < pageSize) break;
    }
    return collected;
  },

  async insert(input): Promise<Photo> {
    const supabase = requireSupabaseClient();
    const ownerId = await requireUserId();
    const { data, error } = await supabase
      .from("photos")
      .insert({
        album_id: input.albumId,
        owner_id: ownerId,
        original_filename: input.originalFilename,
        storage_path: input.storagePath,
        thumbnail_path: input.thumbnailPath ?? null,
        mime_type: input.mimeType,
        file_size: input.fileSize,
        width: input.width ?? null,
        height: input.height ?? null,
        checksum: input.checksum ?? null,
        previewable: input.previewable,
        filename_key: normalizeFilenameKey(input.originalFilename),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapPhoto(data as PhotoRow);
  },

  async remove(photoIds: string[]): Promise<void> {
    if (photoIds.length === 0) return;
    const supabase = requireSupabaseClient();
    await requireUserId();
    const { data, error } = await supabase
      .from("photos")
      .delete()
      .in("id", photoIds)
      .select("storage_path, thumbnail_path");
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as { storage_path: string; thumbnail_path: string | null }[];
    const originals = new SupabaseStorageProvider(BUCKETS.originals);
    const thumbnails = new SupabaseStorageProvider(BUCKETS.thumbnails);
    await originals
      .remove(rows.map((row) => row.storage_path))
      .catch((error: unknown) => console.warn("Không xoá được một số ảnh gốc:", error));
    await thumbnails
      .remove(rows.flatMap((row) => (row.thumbnail_path ? [row.thumbnail_path] : [])))
      .catch((error: unknown) => console.warn("Không xoá được một số ảnh thu nhỏ:", error));
  },

  async findByChecksum(albumId: string, checksum: string): Promise<Photo | null> {
    const supabase = requireSupabaseClient();
    await requireUserId();
    const { data, error } = await supabase
      .from("photos")
      .select("*")
      .eq("album_id", albumId)
      .eq("checksum", checksum)
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data ? mapPhoto(data as PhotoRow) : null;
  },

  async setThumbnail(photoId: string, thumbnailPath: string | null): Promise<void> {
    const supabase = requireSupabaseClient();
    await requireUserId();
    await supabase
      .from("photos")
      .update({ thumbnail_path: thumbnailPath })
      .eq("id", photoId);
  },
};

/* ── Gọi Edge Function chia sẻ ────────────────────────────────── */

interface ShareFunctionResponse<T> {
  data: T | null;
  error: string | null;
}

async function callShareFunction<T>(
  action: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.functions.invoke<ShareFunctionResponse<T>>(
    SHARE_FUNCTION_NAME,
    { body: { action, ...payload } },
  );
  if (error) {
    // Hàm chưa được deploy là lỗi cấu hình phổ biến nhất — nêu rõ cách xử lý.
    const message =
      error.message?.includes("Failed to send a request") ||
      error.message?.includes("not found")
        ? `Không gọi được Edge Function "${SHARE_FUNCTION_NAME}". Hãy deploy function này (xem README, mục Chia sẻ).`
        : error.message;
    throw new Error(message);
  }
  if (!data) throw new Error("Phản hồi không hợp lệ từ máy chủ chia sẻ.");
  if (data.error) throw new Error(data.error);
  return data.data as T;
}

/* ── Chia sẻ ──────────────────────────────────────────────────── */

const shareRepository: ShareRepository = {
  listForAlbum(albumId: string): Promise<AlbumShare[]> {
    return callShareFunction<AlbumShare[]>("list", { albumId });
  },
  create(input: CreateShareInput): Promise<AlbumShare> {
    return callShareFunction<AlbumShare>("create", { ...input });
  },
  update(shareId: string, input: UpdateShareInput): Promise<AlbumShare> {
    return callShareFunction<AlbumShare>("update", { shareId, ...input });
  },
  async revoke(shareId: string): Promise<void> {
    await callShareFunction<{ ok: boolean }>("revoke", { shareId });
  },
  resolveAccess(token: string, password?: string | null): Promise<ShareAccess> {
    return callShareFunction<ShareAccess>("resolve", { token, password: password ?? null });
  },
  listSharedPhotos(token, password, query): Promise<Paged<Photo>> {
    return callShareFunction<Paged<Photo>>("list-photos", {
      token,
      password: password ?? null,
      cursor: query.cursor ?? null,
      limit: query.limit ?? 60,
      sort: query.sort ?? "uploaded-desc",
    });
  },
  async fetchSharedOriginalBlob(token, password, photo): Promise<Blob> {
    // Backend cấp signed URL ngắn hạn sau khi đã xác minh token + mật khẩu.
    const result = await callShareFunction<{ url: string }>("download-url", {
      token,
      password: password ?? null,
      photoId: photo.id,
      filename: photo.originalFilename,
    });
    const response = await fetch(result.url);
    if (!response.ok) {
      throw new Error("Không tải được ảnh gốc từ kho lưu trữ.");
    }
    // Trả về nguyên byte: không giải mã, không mã hoá lại.
    return response.blob();
  },
};

/** Signed URL cho lưới ảnh của khách xem liên kết chia sẻ. */
export async function getSharedPhotoUrls(
  token: string,
  password: string | null,
  photos: { id: string; thumbnailPath: string | null; storagePath: string }[],
  purpose: "thumbnail" | "original",
): Promise<Record<string, string>> {
  return callShareFunction<Record<string, string>>("urls", {
    token,
    password,
    purpose,
    photoIds: photos.map((photo) => photo.id),
  });
}

/* ── Dung lượng ───────────────────────────────────────────────── */

const usageRepository: UsageRepository = {
  async getUsage(): Promise<StorageUsage> {
    const supabase = requireSupabaseClient();
    await requireUserId();
    const { data, error } = await supabase.rpc("storage_usage");
    if (error || !data) {
      return { usedBytes: 0, photoCount: 0, albumCount: 0, quotaBytes: null };
    }
    const row = (Array.isArray(data) ? data[0] : data) as {
      used_bytes: number | string;
      photo_count: number | string;
      album_count: number | string;
    };
    return {
      usedBytes: Number(row?.used_bytes ?? 0),
      photoCount: Number(row?.photo_count ?? 0),
      albumCount: Number(row?.album_count ?? 0),
      // 5 GB — hạn mức hiển thị mà người dùng chủ kho tự đặt (không phải hạn
      // mức cứng của Supabase Free). Có thể đổi trong app; bucket thật vẫn
      // theo các giới hạn của gói Supabase đang dùng.
      quotaBytes: 5 * 1024 * 1024 * 1024,
    };
  },
};

export function createSupabaseBackend(): GalleryBackend {
  const originals = new SupabaseStorageProvider(BUCKETS.originals);
  return {
    mode: "supabase",
    storageKind: originals.kind,
    auth: supabaseAuth,
    albums: albumRepository,
    photos: photoRepository,
    shares: shareRepository,
    storage: originals,
    thumbnailStorage: new SupabaseStorageProvider(BUCKETS.thumbnails),
    usage: usageRepository,
    description:
      "Đang chạy trên Supabase: ảnh gốc lưu trong bucket riêng tư, bảo vệ bằng Row Level Security.",
  };
}

export { SupabaseStorageProvider };
