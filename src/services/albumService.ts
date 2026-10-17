import type {
  Album,
  AlbumQuery,
  AlbumSort,
  CreateAlbumInput,
  Paged,
  UpdateAlbumInput,
} from "@/types";
import { getBackend } from "./backend";
import { NotFoundError } from "./errors";

/** Lớp dịch vụ cho album — UI không bao giờ gọi thẳng backend. */
export const albumService = {
  async list(query: AlbumQuery = {}): Promise<Paged<Album>> {
    return getBackend().albums.list(query);
  },

  async get(albumId: string): Promise<Album> {
    const album = await getBackend().albums.get(albumId);
    if (!album) throw new NotFoundError("Album không tồn tại hoặc bạn không có quyền xem.");
    return album;
  },

  async create(input: CreateAlbumInput): Promise<Album> {
    return getBackend().albums.create(input);
  },

  async update(albumId: string, input: UpdateAlbumInput): Promise<Album> {
    return getBackend().albums.update(albumId, input);
  },

  /** Xoá album kèm toàn bộ ảnh thuộc album đó (chỉ khi chủ sở hữu xác nhận). */
  async remove(albumId: string): Promise<void> {
    return getBackend().albums.remove(albumId);
  },

  async listRecent(limit = 6): Promise<Album[]> {
    return getBackend().albums.listRecent(limit);
  },

  sortLabels: {
    newest: "Mới cập nhật",
    oldest: "Cũ nhất",
    title: "Theo tên (A→Z)",
  } satisfies Record<AlbumSort, string>,
};
