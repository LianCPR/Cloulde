import { useCallback, useEffect, useRef, useState } from "react";
import type { DownloadProgress, DownloadStrategy, Photo } from "@/types";
import { runDownload, type DownloadSummary, type DownloadRunOptions } from "@/services/downloadService";
import type { DirectoryHandleLike } from "@/services/fsAccess";
import { describeError } from "@/services/errors";
import { announce } from "@/components/ui/LiveRegion";

const IDLE: DownloadProgress = {
  status: "idle",
  totalFiles: 0,
  completedFiles: 0,
  failedFiles: 0,
  currentFile: null,
  processedBytes: 0,
  totalBytes: 0,
  fraction: null,
  errors: [],
  message: null,
};

export interface DownloadJobState {
  progress: DownloadProgress;
  summary: DownloadSummary | null;
  error: string | null;
  isRunning: boolean;
  start: (
    photos: Photo[],
    options: Omit<DownloadRunOptions, "onProgress" | "signal">,
  ) => Promise<DownloadSummary | null>;
  cancel: () => void;
  reset: () => void;
}

/**
 * Điều khiển một phiên tải xuống.
 * Trạng thái được đẩy lên UI theo tiến độ byte thật, đồng thời thông báo cho
 * trình đọc màn hình ở những mốc quan trọng.
 */
export function useDownloadJob(): DownloadJobState {
  const [progress, setProgress] = useState<DownloadProgress>(IDLE);
  const [summary, setSummary] = useState<DownloadSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const lastAnnounced = useRef<number>(-1);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const start = useCallback(
    async (
      photos: Photo[],
      options: Omit<DownloadRunOptions, "onProgress" | "signal">,
    ): Promise<DownloadSummary | null> => {
      if (photos.length === 0) return null;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setError(null);
      setSummary(null);
      setIsRunning(true);
      lastAnnounced.current = -1;

      try {
        const result = await runDownload(photos, {
          ...options,
          signal: controller.signal,
          onProgress: (next) => {
            setProgress(next);
            // Thông báo cho trình đọc màn hình mỗi 25% để không nói quá nhiều.
            const milestone = Math.floor((next.fraction ?? 0) * 4);
            if (milestone > lastAnnounced.current && next.totalFiles > 0) {
              lastAnnounced.current = milestone;
              announce(
                `Đang tải xuống: ${next.completedFiles}/${next.totalFiles} tệp (${Math.round((next.fraction ?? 0) * 100)}%).`,
              );
            }
          },
        });
        setSummary(result);
        if (result.status === "completed") {
          announce(`Tải xuống hoàn tất: ${result.completed} tệp.`);
        } else if (result.status === "cancelled") {
          announce("Phiên tải xuống đã bị huỷ.");
        } else {
          announce(`Tải xuống thất bại: ${result.failed} tệp lỗi.`);
        }
        return result;
      } catch (caught) {
        const message = describeError(caught);
        setError(message);
        setProgress((previous) => ({ ...previous, status: "failed", message }));
        announce(`Tải xuống thất bại: ${message}`);
        return null;
      } finally {
        setIsRunning(false);
        controllerRef.current = null;
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    setProgress(IDLE);
    setSummary(null);
    setError(null);
  }, []);

  return { progress, summary, error, isRunning, start, cancel, reset };
}

export type { DirectoryHandleLike };
export type { DownloadStrategy };
