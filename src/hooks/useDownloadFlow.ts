import { useCallback, useRef, useState } from "react";
import type { DownloadStrategy, Photo } from "@/types";
import { useDownloadJob } from "./useDownloadJob";
import { chooseDestinationFolder, canPickDirectory } from "@/services/downloadService";
import type { DirectoryHandleLike } from "@/services/fsAccess";
import type { OriginalSource } from "@/services/originalSource";
import { toastError, toastInfo } from "@/components/ui/Toast";

export interface DownloadFlow {
  open: boolean;
  photos: Photo[];
  job: ReturnType<typeof useDownloadJob>;
  canChooseFolder: boolean;
  /** Mở hộp thoại tải xuống cho một nhóm ảnh. */
  start: (photos: Photo[]) => void;
  close: () => void;
  /** Chọn thư mục đích rồi chạy chiến lược ghi trực tiếp cho nhóm ảnh đã chọn. */
  pickFolder: () => Promise<void>;
  /** Như `pickFolder` nhưng nhận thẳng danh sách ảnh (tránh phụ thuộc state). */
  pickFolderFor: (photos: Photo[]) => Promise<void>;
  /** Chạy với chiến lược khác (zip / từng tệp / share sheet). */
  run: (strategy: DownloadStrategy) => Promise<void>;
  /** Tải một ảnh duy nhất, không mở hộp thoại. */
  downloadSingle: (photo: Photo) => Promise<void>;
  /**
   * Lấy nguồn byte gốc của một ảnh.
   * Cần cho luồng lưu vào Thư viện ảnh trên iOS, vốn tự tải ảnh theo từng đợt
   * thay vì đi qua `job.start`.
   */
  sourceFor: (photo: Photo) => Promise<OriginalSource>;
}

/**
 * Ghép nối UI với dịch vụ tải xuống.
 *
 * `sourceFor` được giữ trong ref để không bao giờ dùng phiên bản cũ của hàm
 * lấy dữ liệu (ví dụ token chia sẻ vừa thay đổi).
 */
export function useDownloadFlow(options: {
  title: string;
  sourceFor: (photo: Photo) => Promise<OriginalSource>;
}): DownloadFlow {
  const job = useDownloadJob();
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const sourceRef = useRef(options.sourceFor);
  sourceRef.current = options.sourceFor;
  const titleRef = useRef(options.title);
  titleRef.current = options.title;

  const start = useCallback((next: Photo[]) => {
    if (next.length === 0) {
      toastInfo("Chưa có ảnh nào được chọn.");
      return;
    }
    setPhotos(next);
    job.reset();
    setOpen(true);
  }, [job]);

  const close = useCallback(() => {
    setOpen(false);
    job.reset();
  }, [job]);

  const pickFolderFor = useCallback(
    async (target: Photo[]) => {
      if (target.length === 0) {
        toastInfo("Chưa có ảnh nào được chọn.");
        return;
      }
      try {
        setPhotos(target);
        const directory: DirectoryHandleLike | null = await chooseDestinationFolder();
        if (!directory) {
          toastInfo(
            "Bạn chưa chọn thư mục nào.",
            "Trình duyệt không cho phép tạo thư mục mới tự động — hãy chọn một thư mục có sẵn, hoặc dùng nút “Thư mục mới” trong hộp thoại hệ thống.",
          );
          return;
        }
        setOpen(true);
        await job.start(target, {
          title: titleRef.current,
          strategy: "folder",
          directory,
          sourceFor: (photo) => sourceRef.current(photo),
        });
      } catch (error) {
        toastError(error);
      }
    },
    [job],
  );

  const pickFolder = useCallback(() => pickFolderFor(photos), [pickFolderFor, photos]);

  const run = useCallback(
    async (strategy: DownloadStrategy) => {
      await job.start(photos, {
        title: titleRef.current,
        strategy,
        sourceFor: (photo) => sourceRef.current(photo),
      });
    },
    [job, photos],
  );

  const sourceFor = useCallback(
    (photo: Photo) => sourceRef.current(photo),
    [],
  );

  const downloadSingle = useCallback(
    async (photo: Photo) => {
      setPhotos([photo]);
      await job.start([photo], {
        title: titleRef.current,
        strategy: "individual",
        sourceFor: (candidate) => sourceRef.current(candidate),
      });
    },
    [job],
  );

  return {
    open,
    photos,
    job,
    canChooseFolder: canPickDirectory(),
    start,
    close,
    pickFolder,
    pickFolderFor,
    run,
    downloadSingle,
    sourceFor,
  };
}
