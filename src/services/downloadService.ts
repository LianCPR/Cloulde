import type {
  DownloadProgress,
  DownloadStatus,
  DownloadStrategy,
  Photo,
} from "@/types";
import { DOWNLOAD_CONCURRENCY, ZIP_MAX_BYTES, ZIP_MAX_FILES, ZIP_WARN_BYTES } from "@/config/env";
import { dedupeFilename, sanitizeOriginalFilename } from "@/lib/fileTypes";
import { detectCapabilities, readDownloadPreferences } from "@/lib/capabilities";
import { sha256Blob } from "@/lib/checksum";
import { zipFilenameFor, writeZipStream, type ZipEntryInput } from "./archive/zipWriter";
import {
  canPickDirectory,
  pickDirectory,
  writeStreamToDirectory,
  type DirectoryHandleLike,
} from "./fsAccess";
import type { OriginalSource } from "./originalSource";

/**
 * Dịch vụ tải xuống — hoàn toàn độc lập với UI.
 *
 * Mọi đường đi đều hướng tới cùng một mục tiêu: người dùng nhận được ĐÚNG tệp
 * đã tải lên, nguyên byte, giữ nguyên tên, định dạng, độ phân giải và metadata
 * nhúng (EXIF/IPTC). Không có bước nào giải mã rồi mã hoá lại ảnh.
 *
 * Bốn chiến lược:
 *  1. `folder`  — File System Access API: ghi từng ảnh gốc vào thư mục người
 *                 dùng chọn, theo luồng, bộ nhớ không đổi. Tốt nhất trên desktop.
 *  2. `zip`     — Gói ZIP phương thức STORE do chính client tạo (ghi ra OPFS
 *                 nếu có). Không nén lại, không sửa byte.
 *  3. `individual` — Tải từng tệp rời. Bắt buộc trên iOS khi chỉ cần vài ảnh.
 *  4. `share-sheet` — Web Share API (chỉ khi trình duyệt hỗ trợ chia sẻ tệp).
 */

export interface DownloadSummary {
  status: Extract<DownloadStatus, "completed" | "failed" | "cancelled">;
  completed: number;
  failed: number;
  totalBytes: number;
  errors: { filename: string; message: string }[];
  /** Có bật kiểm tra SHA-256 không, và kết quả ra sao. */
  checksum: { checked: number; mismatched: number };
}

export interface DownloadRunOptions {
  /** Tên album hoặc nhóm ảnh — dùng đặt tên thư mục trong ZIP. */
  title: string;
  strategy: DownloadStrategy;
  /** Bắt buộc khi strategy là `folder`. */
  directory?: DirectoryHandleLike | null;
  /** Lấy nguồn byte gốc cho từng ảnh (chủ album hoặc khách có liên kết). */
  sourceFor: (photo: Photo) => Promise<OriginalSource>;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
  /** Bỏ qua cảnh báo kích thước khi người dùng đã xác nhận. */
  confirmedLargeArchive?: boolean;
}

const EMPTY_PROGRESS: DownloadProgress = {
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

/** Kích thước gói ZIP dự kiến, dùng để cảnh báo trước khi tạo. */
export function estimateArchive(photos: Photo[]): {
  fileCount: number;
  totalBytes: number;
  exceedsBrowserLimit: boolean;
  needsWarning: boolean;
  estimateText: string;
} {
  const totalBytes = photos.reduce((sum, photo) => sum + (photo.fileSize || 0), 0);
  const exceedsBrowserLimit =
    photos.length > ZIP_MAX_FILES || totalBytes > ZIP_MAX_BYTES;
  return {
    fileCount: photos.length,
    totalBytes,
    exceedsBrowserLimit,
    needsWarning: totalBytes > ZIP_WARN_BYTES || photos.length > 200,
    estimateText: `${photos.length} tệp · khoảng ${(totalBytes / 1024 ** 3).toFixed(2)} GB`,
  };
}

/**
 * Mở hộp thoại chọn thư mục đích.
 * Phải gọi trực tiếp trong sự kiện click của người dùng.
 */
/**
 * Mở hộp thoại chọn thư mục, mở sẵn tại Desktop (màn hình chính) cho dễ tìm.
 */
export async function chooseDestinationFolder(): Promise<DirectoryHandleLike | null> {
  return pickDirectory("desktop");
}

export { canPickDirectory };

function createProgressReporter(
  onProgress: ((progress: DownloadProgress) => void) | undefined,
  initial: Partial<DownloadProgress>,
) {
  let state: DownloadProgress = { ...EMPTY_PROGRESS, ...initial };
  return {
    get: () => state,
    update(patch: Partial<DownloadProgress>) {
      state = { ...state, ...patch };
      onProgress?.(state);
    },
  };
}

/* ── 1. Tải trực tiếp vào thư mục ─────────────────────────────── */

async function runFolderDownload(
  photos: Photo[],
  options: DownloadRunOptions,
): Promise<DownloadSummary> {
  const directory = options.directory;
  if (!directory) {
    throw new Error("Chưa chọn thư mục đích.");
  }

  const reporter = createProgressReporter(options.onProgress, {
    status: "running",
    totalFiles: photos.length,
    totalBytes: photos.reduce((sum, photo) => sum + (photo.fileSize || 0), 0),
  });

  const taken = new Set<string>();
  const errors: { filename: string; message: string }[] = [];
  const totalBytes = photos.reduce((sum, photo) => sum + (photo.fileSize || 0), 0);
  let completed = 0;
  let writtenBytes = 0;

  for (const photo of photos) {
    if (options.signal?.aborted) break;
    const filename = sanitizeOriginalFilename(photo.originalFilename);
    const baseBytes = writtenBytes;
    reporter.update({ status: "running", currentFile: filename });

    try {
      const source = await options.sourceFor(photo);
      const result = await writeStreamToDirectory(
        directory,
        filename,
        source,
        taken,
        (bytes) => {
          // Tiến độ byte thật cho tệp đang ghi (không phải tiến độ giả).
          const processed = baseBytes + bytes;
          reporter.update({
            processedBytes: processed,
            currentFile: `${filename} · ${(bytes / 1024 / 1024).toFixed(1)}MB`,
            fraction: totalBytes > 0 ? Math.min(1, processed / totalBytes) : null,
          });
        },
        options.signal,
      );
      completed += 1;
      writtenBytes = baseBytes + result.bytes;
      reporter.update({
        completedFiles: completed,
        processedBytes: writtenBytes,
        fraction: totalBytes > 0 ? Math.min(1, writtenBytes / totalBytes) : completed / photos.length,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") break;
      errors.push({
        filename,
        message: error instanceof Error ? error.message : "Lỗi không xác định",
      });
      reporter.update({ failedFiles: errors.length, errors });
    }
  }

  const cancelled = Boolean(options.signal?.aborted);
  const status: DownloadSummary["status"] = cancelled
    ? "cancelled"
    : errors.length > 0 && completed === 0
      ? "failed"
      : "completed";

  reporter.update({
    status,
    currentFile: null,
    completedFiles: completed,
    failedFiles: errors.length,
    processedBytes: writtenBytes,
    fraction: photos.length > 0 ? completed / photos.length : 1,
    message:
      status === "completed"
        ? `Đã lưu ${completed}/${photos.length} ảnh gốc vào thư mục bạn chọn.`
        : null,
  });

  return {
    status,
    completed,
    failed: errors.length,
    totalBytes: writtenBytes,
    errors,
    checksum: { checked: 0, mismatched: 0 },
  };
}

/* ── 2. Gói ZIP phương thức STORE ─────────────────────────────── */

async function runZipDownload(
  photos: Photo[],
  options: DownloadRunOptions,
): Promise<DownloadSummary> {
  const estimate = estimateArchive(photos);
  const reporter = createProgressReporter(options.onProgress, {
    status: "preparing",
    totalFiles: photos.length,
    totalBytes: estimate.totalBytes,
    message: `Đang chuẩn bị gói ZIP (${estimate.estimateText})…`,
  });

  // Đặt tên duy nhất bên trong ZIP để hai ảnh cùng tên không ghi đè nhau.
  const taken = new Set<string>();
  const folderPrefix = options.title.trim() ? `${options.title.trim()}/` : "";
  const entries: ZipEntryInput[] = photos.map((photo) => {
    const safe = dedupeFilename(sanitizeOriginalFilename(photo.originalFilename), taken);
    taken.add(safe.toLowerCase());
    return {
      path: `${folderPrefix}${safe}`,
      size: photo.fileSize || 0,
      async stream() {
        const source = await options.sourceFor(photo);
        return source.stream();
      },
    };
  });

  reporter.update({ status: "zipping", message: "Đang ghi gói ZIP…" });

  const result = await writeZipStream(entries, {
    maxBytes: ZIP_MAX_BYTES,
    maxFiles: ZIP_MAX_FILES,
    signal: options.signal,
    onProgress: (zipProgress) => {
      reporter.update({
        currentFile: zipProgress.currentEntry,
        completedFiles: zipProgress.filesAdded,
        processedBytes: zipProgress.bytesWritten,
        fraction:
          estimate.totalBytes > 0 ? Math.min(1, zipProgress.bytesWritten / estimate.totalBytes) : null,
      });
    },
  });

  // Ghi tệp ZIP ra ổ đĩa qua object URL của Blob (đọc trực tiếp từ đĩa với OPFS).
  await triggerBlobDownload(result.blob, zipFilenameFor(options.title));

  const cancelled = Boolean(options.signal?.aborted);
  reporter.update({
    status: cancelled ? "cancelled" : "completed",
    currentFile: null,
    completedFiles: photos.length,
    processedBytes: result.bytes,
    fraction: 1,
    message: `Đã tạo gói ZIP (${(result.bytes / 1024 / 1024).toFixed(1)}MB, bộ nhớ đệm: ${result.backing === "opfs" ? "trên đĩa" : "trong RAM"}).`,
  });

  return {
    status: cancelled ? "cancelled" : "completed",
    completed: photos.length,
    failed: 0,
    totalBytes: result.bytes,
    errors: [],
    checksum: { checked: 0, mismatched: 0 },
  };
}

/* ── 3. Tải từng tệp rời ──────────────────────────────────────── */

async function runIndividualDownload(
  photos: Photo[],
  options: DownloadRunOptions,
): Promise<DownloadSummary> {
  const reporter = createProgressReporter(options.onProgress, {
    status: "running",
    totalFiles: photos.length,
    totalBytes: photos.reduce((sum, photo) => sum + (photo.fileSize || 0), 0),
    message:
      photos.length > 1
        ? "Trình duyệt sẽ lần lượt tải từng ảnh. Hãy cho phép tải nhiều tệp nếu được hỏi."
        : null,
  });

  const errors: { filename: string; message: string }[] = [];
  let completed = 0;
  let totalBytes = 0;
  const checksum = { checked: 0, mismatched: 0 };
  const verify = readDownloadPreferences().verifyChecksums;

  for (const photo of photos) {
    if (options.signal?.aborted) break;
    const filename = sanitizeOriginalFilename(photo.originalFilename);
    reporter.update({ currentFile: filename });
    try {
      const source = await options.sourceFor(photo);
      const blob = await source.blob();

      // Kiểm tra toàn vẹn: so sánh SHA-256 của tệp nhận được với metadata.
      if (verify && photo.checksum && blob.size <= 10 * 1024 * 1024) {
        const digest = await sha256Blob(blob);
        checksum.checked += 1;
        if (digest !== photo.checksum) {
          checksum.mismatched += 1;
          throw new Error(
            "Tệp nhận được không khớp mã kiểm tra SHA-256 của ảnh gốc đã lưu.",
          );
        }
      }

      await triggerBlobDownload(blob, filename);
      completed += 1;
      totalBytes += blob.size;
      reporter.update({
        completedFiles: completed,
        processedBytes: reporter.get().processedBytes + blob.size,
        fraction: completed / photos.length,
      });
      // Khoảng nghỉ nhỏ để trình duyệt không chặn hàng loạt yêu cầu.
      if (photos.length > 1) await new Promise((resolve) => setTimeout(resolve, 350));
    } catch (error) {
      errors.push({
        filename,
        message: error instanceof Error ? error.message : "Lỗi không xác định",
      });
      reporter.update({ failedFiles: errors.length, errors });
    }
  }

  const cancelled = Boolean(options.signal?.aborted);
  const status: DownloadSummary["status"] = cancelled
    ? "cancelled"
    : errors.length > 0 && completed === 0
      ? "failed"
      : "completed";

  reporter.update({
    status,
    currentFile: null,
    completedFiles: completed,
    failedFiles: errors.length,
    fraction: photos.length > 0 ? completed / photos.length : 1,
    message:
      completed > 0
        ? `Đã gửi ${completed}/${photos.length} ảnh gốc tới trình duyệt. Kiểm tra thư mục Tải về (hoặc ứng dụng Tệp trên iOS).`
        : null,
  });

  return {
    status,
    completed,
    failed: errors.length,
    totalBytes,
    errors,
    checksum,
  };
}

/* ── 4. Share sheet của hệ điều hành ──────────────────────────── */

async function runShareSheetDownload(
  photos: Photo[],
  options: DownloadRunOptions,
): Promise<DownloadSummary> {
  const totalBytes = photos.reduce((sum, photo) => sum + (photo.fileSize || 0), 0);

  const reporter = createProgressReporter(options.onProgress, {
    status: "running",
    totalFiles: photos.length,
    totalBytes,
    message: "Đang chuẩn bị tệp để chia sẻ…",
  });

  const { files } = await prepareShareBatch(photos, options.sourceFor, options.signal);
  await shareFilesToDevice(files, options.title);

  reporter.update({
    status: "completed",
    completedFiles: photos.length,
    processedBytes: totalBytes,
    fraction: 1,
    message: "Đã mở share sheet. Chọn “Lưu ảnh” để đưa ảnh gốc vào Thư viện ảnh.",
  });

  return {
    status: "completed",
    completed: photos.length,
    failed: 0,
    totalBytes,
    errors: [],
    checksum: { checked: 0, mismatched: 0 },
  };
}

/* ── Điều phối ────────────────────────────────────────────────── */

/** Chạy một phiên tải xuống theo chiến lược đã chọn. */
export async function runDownload(
  photos: Photo[],
  options: DownloadRunOptions,
): Promise<DownloadSummary> {
  if (photos.length === 0) {
    throw new Error("Chưa có ảnh nào được chọn.");
  }

  switch (options.strategy) {
    case "folder":
      return runFolderDownload(photos, options);
    case "zip":
      return runZipDownload(photos, options);
    case "share-sheet":
      return runShareSheetDownload(photos, options);
    case "individual":
    default:
      return runIndividualDownload(photos, options);
  }
}

/** Tải một ảnh gốc duy nhất. */
export async function downloadOriginal(
  photo: Photo,
  options: Omit<DownloadRunOptions, "title" | "strategy"> & { title?: string },
): Promise<DownloadSummary> {
  return runDownload([photo], {
    ...options,
    title: options.title ?? "",
    strategy: "individual",
  });
}

/** Tải những ảnh đã chọn. */
export async function downloadSelectedPhotos(
  photos: Photo[],
  options: Omit<DownloadRunOptions, "strategy"> & { strategy?: DownloadStrategy },
): Promise<DownloadSummary> {
  return runDownload(photos, { ...options, strategy: options.strategy ?? "zip" });
}

/** Tải toàn bộ album. */
export async function downloadEntireAlbum(
  albumTitle: string,
  photos: Photo[],
  options: Omit<DownloadRunOptions, "title" | "strategy"> & {
    strategy?: DownloadStrategy;
  },
): Promise<DownloadSummary> {
  return runDownload(photos, {
    ...options,
    title: albumTitle,
    strategy: options.strategy ?? "zip",
  });
}

/**
 * Chọn chiến lược khả thi và tự động lùi về phương án an toàn khi cần.
 * `preferred` là mong muốn của người dùng; nếu trình duyệt không hỗ trợ thì
 * hàm này giải thích lý do và trả về chiến lược thay thế.
 */
export async function downloadWithFallback(
  photos: Photo[],
  options: Omit<DownloadRunOptions, "strategy"> & {
    preferred?: DownloadStrategy;
  },
): Promise<{ summary: DownloadSummary; usedStrategy: DownloadStrategy; note: string | null }> {
  const capabilities = detectCapabilities();
  const preferred = options.preferred ?? capabilities.recommendedStrategy;
  const estimate = estimateArchive(photos);

  const tryRun = async (strategy: DownloadStrategy) =>
    runDownload(photos, { ...options, strategy });

  if (preferred === "folder") {
    if (!capabilities.fileSystemAccess) {
      const fallback: DownloadStrategy = capabilities.ios ? "individual" : "zip";
      const summary = await tryRun(fallback);
      return {
        summary,
        usedStrategy: fallback,
        note: "Trình duyệt này không hỗ trợ chọn thư mục đích. Đã chuyển sang phương án thay thế.",
      };
    }
    const summary = await tryRun("folder");
    return { summary, usedStrategy: "folder", note: null };
  }

  if (preferred === "zip" && estimate.exceedsBrowserLimit) {
    // Không thể tạo ZIP vượt giới hạn trình duyệt — nói rõ và lùi về từng tệp.
    const summary = await tryRun("individual");
    return {
      summary,
      usedStrategy: "individual",
      note: `Ảnh vượt giới hạn tạo ZIP phía trình duyệt (${estimate.estimateText}). Đã chuyển sang tải từng ảnh gốc. Trên desktop, hãy dùng tuỳ chọn chọn thư mục đích.`,
    };
  }

  const summary = await tryRun(preferred);
  return { summary, usedStrategy: preferred, note: null };
}

/* ── 5. Lưu vào Thư viện ảnh trên iOS ─────────────────────────── */

/**
 * TRUNG THỰC VỀ GIỚI HẠN: trình duyệt web không có API nào ghi thẳng vào Thư
 * viện ảnh của iOS. PhotoKit là framework native, không dành cho trang web.
 * Con đường duy nhất là đưa tệp qua share sheet và để người dùng tự chọn
 * "Lưu vào Ảnh" — thậm chí mục đó còn không phải lúc nào cũng có mặt.
 *
 * Vì vậy hàm dưới đây chuẩn bị tệp theo TỪNG ĐỢT: giới hạn cả số tệp và số
 * byte, để bộ nhớ không tăng theo kích thước album.
 */
export interface PreparedShareBatch {
  files: File[];
  bytes: number;
}

/** Tải blob của MỘT đợt ảnh và đóng gói thành `File` sẵn sàng cho share sheet. */
export async function prepareShareBatch(
  photos: Photo[],
  sourceFor: (photo: Photo) => Promise<OriginalSource>,
  signal?: AbortSignal,
): Promise<PreparedShareBatch> {
  const files: File[] = [];
  let bytes = 0;
  for (const photo of photos) {
    if (signal?.aborted) throw new DOMException("Đã huỷ", "AbortError");
    const source = await sourceFor(photo);
    const blob = await source.blob();
    files.push(
      new File([blob], sanitizeOriginalFilename(photo.originalFilename), {
        type: photo.mimeType || "application/octet-stream",
      }),
    );
    bytes += blob.size;
  }
  return { files, bytes };
}

/** Thiết bị có thật sự chia sẻ được đúng tập tệp này không? */
export function canShareFiles(files: File[], title: string): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") {
    return false;
  }
  try {
    return navigator.canShare({ files, title });
  } catch {
    return false;
  }
}

/**
 * Mở share sheet của hệ điều hành cho một đợt tệp.
 *
 * Trả về `"dismissed"` khi người dùng tự đóng share sheet — đó là lựa chọn bình
 * thường, không phải lỗi, nên không ném ra ngoại lệ.
 *
 * PHẢI gọi trực tiếp trong một thao tác của người dùng: Safari yêu cầu
 * "transient user activation" cho `navigator.share`, nên mỗi đợt cần một lần
 * bấm riêng. Đó là lý do luồng iOS là một trình tự từng bước có chủ đích, chứ
 * không phải một vòng lặp tự động — vòng lặp sẽ hỏng ở đợt thứ hai.
 */
export async function shareFilesToDevice(
  files: File[],
  title: string,
): Promise<"shared" | "dismissed"> {
  if (!canShareFiles(files, title)) {
    throw new Error("Thiết bị này không hỗ trợ chia sẻ tệp qua share sheet.");
  }
  try {
    await navigator.share({ files, title });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "dismissed";
    throw error;
  }
}

/* ── Tiện ích trình duyệt ─────────────────────────────────────── */

/** Số tệp có thể tải đồng thời (dùng cho các luồng tải song song). */
export const downloadConcurrency = DOWNLOAD_CONCURRENCY;

/**
 * Tải một Blob xuống đĩa.
 * Object URL được thu hồi sau khi trình duyệt đã bắt đầu tải, tránh rò rỉ bộ nhớ.
 */
export async function triggerBlobDownload(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Chờ một nhịp để trình duyệt kịp bắt đầu tải tệp.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  URL.revokeObjectURL(url);
}

/**
 * Mở ảnh gốc bằng signed URL có Content-Disposition.
 * Đây là đường đi hiệu quả nhất trên iOS/Safari vì không cần nạp Blob vào RAM.
 */
export function openDirectDownload(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  anchor.download = "";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
