import { useCallback, useEffect, useRef, useState } from "react";
import type { Photo, PhotoSort } from "@/types";
import { photoService } from "@/services/photoService";
import { describeError } from "@/services/errors";

export interface PhotoFeedOptions {
  albumId: string;
  sort: PhotoSort;
  pageSize?: number;
  /** Tải ảnh do khách xem liên kết chia sẻ (khác nguồn dữ liệu). */
  fetchPage?: (
    cursor: string | null,
  ) => Promise<{ items: Photo[]; nextCursor: string | null; total?: number }>;
  enabled?: boolean;
}

export interface PhotoFeedState {
  photos: Photo[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  nextCursor: string | null;
  total: number | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => Promise<void>;
  /** Cập nhật tại chỗ sau khi tải lên hoặc xoá ảnh. */
  append: (photos: Photo[]) => void;
  removeLocal: (photoIds: string[]) => void;
  updateLocal: (photoId: string, patch: Partial<Photo>) => void;
}

/**
 * Nạp ảnh theo trang bằng con trỏ.
 *
 * Không bao giờ tải toàn bộ album một lần: mỗi trang mặc định 60 ảnh metadata.
 * Mọi yêu cầu cũ bị huỷ bằng cờ `stale` khi tham số thay đổi, tránh tình trạng
 * dữ liệu của album trước ghi đè album đang xem.
 */
export function usePhotoFeed(options: PhotoFeedOptions): PhotoFeedState {
  const { albumId, sort, pageSize = 60, enabled = true } = options;
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  const requestId = useRef(0);
  const fetchPage = options.fetchPage;

  const loadFirstPage = useCallback(async () => {
    if (!enabled) return;
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const page = fetchPage
        ? await fetchPage(null)
        : await photoService.list({ albumId, cursor: null, limit: pageSize, sort });
      if (current !== requestId.current) return;
      setPhotos(page.items);
      setNextCursor(page.nextCursor);
      setTotal(page.total ?? page.items.length);
    } catch (caught) {
      if (current !== requestId.current) return;
      setError(describeError(caught));
      setPhotos([]);
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [albumId, enabled, fetchPage, pageSize, sort]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(() => {
    if (!enabled || loadingMore || loading || !nextCursor) return;
    const current = requestId.current;
    setLoadingMore(true);
    const run = async () => {
      try {
        const page = fetchPage
          ? await fetchPage(nextCursor)
          : await photoService.list({ albumId, cursor: nextCursor, limit: pageSize, sort });
        if (current !== requestId.current) return;
        setPhotos((previous) => {
          const seen = new Set(previous.map((photo) => photo.id));
          return [...previous, ...page.items.filter((photo) => !seen.has(photo.id))];
        });
        setNextCursor(page.nextCursor);
        if (page.total !== undefined) setTotal(page.total);
      } catch (caught) {
        if (current === requestId.current) setError(describeError(caught));
      } finally {
        if (current === requestId.current) setLoadingMore(false);
      }
    };
    void run();
  }, [albumId, enabled, fetchPage, loading, loadingMore, nextCursor, pageSize, sort]);

  const append = useCallback((incoming: Photo[]) => {
    setPhotos((previous) => {
      const seen = new Set(previous.map((photo) => photo.id));
      const fresh = incoming.filter((photo) => !seen.has(photo.id));
      if (fresh.length === 0) return previous;
      // Ảnh mới nhất đứng đầu khi đang sắp xếp theo thời gian giảm dần.
      return [...fresh, ...previous];
    });
    setTotal((value) => (value === null ? value : value + incoming.length));
  }, []);

  const removeLocal = useCallback((photoIds: string[]) => {
    const removing = new Set(photoIds);
    setPhotos((previous) => previous.filter((photo) => !removing.has(photo.id)));
    setTotal((value) => (value === null ? value : Math.max(0, value - photoIds.length)));
  }, []);

  const updateLocal = useCallback((photoId: string, patch: Partial<Photo>) => {
    setPhotos((previous) =>
      previous.map((photo) => (photo.id === photoId ? { ...photo, ...patch } : photo)),
    );
  }, []);

  return {
    photos,
    loading,
    loadingMore,
    error,
    nextCursor,
    total,
    hasMore: Boolean(nextCursor),
    loadMore,
    refresh: loadFirstPage,
    append,
    removeLocal,
    updateLocal,
  };
}
