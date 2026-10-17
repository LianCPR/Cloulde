import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActiveUploadSession, Photo, UploadItem } from "@/types";
import { UploadQueue, type UploadSummary } from "@/services/uploadService";
import { getBackend } from "@/services/backend";

export interface UseUploadQueueResult {
  items: UploadItem[];
  summary: UploadSummary;
  addFiles: (files: File[]) => void;
  /** Nối tiếp một phiên đã dở trên server bằng tệp gốc người dùng chọn lại. */
  resumeSession: (session: ActiveUploadSession, file: File) => void;
  retryFailed: () => void;
  retryItem: (id: string) => void;
  cancelItem: (id: string) => void;
  cancelAll: () => void;
  clearFinished: () => void;
}

const EMPTY_SUMMARY: UploadSummary = {
  total: 0,
  pending: 0,
  active: 0,
  completed: 0,
  failed: 0,
  duplicates: 0,
  cancelled: 0,
  fraction: 0,
  isRunning: false,
};

/**
 * Bọc `UploadQueue` cho React.
 *
 * Object URL xem trước được tạo/z thu hồi ở tầng hook, không phải tầng UI,
 * nên không bao giờ bị rò rỉ khi điều hướng giữa các trang.
 */
export function useUploadQueue(
  albumId: string,
  onPhotoUploaded?: (photo: Photo) => void,
): UseUploadQueueResult {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [summary, setSummary] = useState<UploadSummary>(EMPTY_SUMMARY);
  const queueRef = useRef<UploadQueue | null>(null);
  const callbackRef = useRef(onPhotoUploaded);
  callbackRef.current = onPhotoUploaded;

  useEffect(() => {
    const queue = new UploadQueue(getBackend(), albumId);
    queueRef.current = queue;

    const notify = new Set<string>();
    const unsubscribe = queue.subscribe((nextItems, nextSummary) => {
      setItems([...nextItems]);
      setSummary(nextSummary);
      for (const item of nextItems) {
        if (item.status === "completed" && item.photo && !notify.has(item.id)) {
          notify.add(item.id);
          callbackRef.current?.(item.photo);
        }
      }
    });

    return () => {
      unsubscribe();
      queue.dispose();
      queueRef.current = null;
    };
  }, [albumId]);

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    // Tạo ảnh xem trước cục bộ ngay để UI có phản hồi tức thì; object URL
    // thuộc quyền quản lý của hàng đợi và được thu hồi khi rời trang.
    queueRef.current?.addFiles(files);
  }, []);

  const resumeSession = useCallback((session: ActiveUploadSession, file: File) => {
    queueRef.current?.resumeSession(session, file);
  }, []);

  return useMemo(
    () => ({
      items,
      summary,
      addFiles,
      resumeSession,
      retryFailed: () => queueRef.current?.retryFailed(),
      retryItem: (id: string) => queueRef.current?.retryItem(id),
      cancelItem: (id: string) => queueRef.current?.cancelItem(id),
      cancelAll: () => queueRef.current?.cancelAll(),
      clearFinished: () => queueRef.current?.removeCompleted(),
    }),
    [addFiles, resumeSession, items, summary],
  );
}
