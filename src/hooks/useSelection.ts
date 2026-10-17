import { useCallback, useMemo, useState } from "react";
import type { Photo } from "@/types";

export interface SelectionApi {
  selectedIds: Set<string>;
  count: number;
  totalBytes: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  select: (id: string) => void;
  deselect: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  /** Đảo ngược lựa chọn trong tập ảnh đang hiển thị. */
  invert: () => void;
  isAllSelected: boolean;
  selectedPhotos: Photo[];
}

/**
 * Quản lý lựa chọn ảnh.
 * `visiblePhotos` là những ảnh người dùng đang thấy (đã tải metadata),
 * nên "Chọn tất cả" luôn có nghĩa rõ ràng và không tải thêm dữ liệu.
 */
export function useSelection(visiblePhotos: Photo[]): SelectionApi {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const select = useCallback((id: string) => {
    setSelectedIds((previous) => {
      if (previous.has(id)) return previous;
      const next = new Set(previous);
      next.add(id);
      return next;
    });
  }, []);

  const deselect = useCallback((id: string) => {
    setSelectedIds((previous) => {
      if (!previous.has(id)) return previous;
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(visiblePhotos.map((photo) => photo.id)));
  }, [visiblePhotos]);

  const deselectAll = useCallback(() => setSelectedIds(new Set()), []);

  const invert = useCallback(() => {
    setSelectedIds((previous) => {
      const next = new Set<string>();
      for (const photo of visiblePhotos) {
        if (!previous.has(photo.id)) next.add(photo.id);
      }
      return next;
    });
  }, [visiblePhotos]);

  const selectedPhotos = useMemo(
    () => visiblePhotos.filter((photo) => selectedIds.has(photo.id)),
    [selectedIds, visiblePhotos],
  );

  const totalBytes = useMemo(
    () => selectedPhotos.reduce((sum, photo) => sum + (photo.fileSize || 0), 0),
    [selectedPhotos],
  );

  const isAllSelected = useMemo(
    () => visiblePhotos.length > 0 && visiblePhotos.every((photo) => selectedIds.has(photo.id)),
    [selectedIds, visiblePhotos],
  );

  return {
    selectedIds,
    count: selectedIds.size,
    totalBytes,
    isSelected: (id: string) => selectedIds.has(id),
    toggle,
    select,
    deselect,
    selectAll,
    deselectAll,
    invert,
    isAllSelected,
    selectedPhotos,
  };
}
