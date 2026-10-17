/**
 * Kiểu dữ liệu miền (domain types) dùng chung cho toàn ứng dụng.
 * Các kiểu này độc lập với nhà cung cấp lưu trữ: backend Supabase và backend
 * IndexedDB nội bộ đều phải trả về đúng những cấu trúc này.
 */

export type IsoDateString = string;

export interface Album {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  /** Album bìa là một tham chiếu metadata; ảnh gốc không hề bị sửa. */
  coverPhotoId: string | null;
  /** Đường dẫn ảnh bìa (nếu có) — lấy kèm để lưới album không cần N+1 truy vấn. */
  coverThumbnailPath: string | null;
  coverStoragePath: string | null;
  coverPreviewable: boolean;
  photoCount: number;
  totalBytes: number;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface Photo {
  id: string;
  albumId: string;
  ownerId: string;
  /** Tên tệp gốc do người dùng chọn — dùng khi tải xuống. */
  originalFilename: string;
  /** Đường dẫn object ảnh gốc trong kho lưu trữ (bất biến). */
  storagePath: string;
  /** Đường dẫn ảnh thu nhỏ (sinh thêm, có thể xoá/tạo lại). */
  thumbnailPath: string | null;
  mimeType: string;
  /** Kích thước tệp gốc theo byte. */
  fileSize: number;
  width: number | null;
  height: number | null;
  /** SHA-256 hex của tệp gốc, dùng kiểm tra toàn vẹn và phát hiện trùng lặp. */
  checksum: string | null;
  /** Trình duyệt có thể hiển thị trực tiếp định dạng này không. */
  previewable: boolean;
  createdAt: IsoDateString;
  /**
   * Trạng thái xác minh phía kho lưu trữ. Chỉ có ở backend lưu trữ thật
   * (R2/S3): server đọc lại object và tự băm SHA-256, không tin client.
   */
  verification?: PhotoVerification | null;
}

/**
 * Kết quả xác minh do SERVER thực hiện sau khi tải lên.
 *
 * `verifiedAt` là null khi ảnh còn nằm trong hàng đợi xác minh — nghĩa là chưa
 * có gì khẳng định tệp nguyên vẹn, KHÁC với "đã kiểm tra và thấy sai".
 */
export interface PhotoVerification {
  verifiedChecksum: string | null;
  verifiedAt: IsoDateString | null;
  /** Server đã đọc lại object và thấy khác checksum/kích thước đã khai báo. */
  mismatch: boolean;
}

export interface CreateAlbumInput {
  title: string;
  description?: string | null;
}

export interface UpdateAlbumInput {
  title?: string;
  description?: string | null;
  coverPhotoId?: string | null;
}

export type AlbumSort = "newest" | "oldest" | "title";
export type PhotoSort = "uploaded-desc" | "uploaded-asc" | "filename-asc";

export interface AlbumQuery {
  search?: string;
  sort?: AlbumSort;
  /** Phân trang theo con trỏ (cursor), không dùng OFFSET để tránh chậm. */
  cursor?: string | null;
  limit?: number;
}

export interface PhotoQuery {
  albumId: string;
  sort?: PhotoSort;
  cursor?: string | null;
  limit?: number;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

/* ── Chia sẻ ──────────────────────────────────────────────────── */

export interface AlbumShare {
  id: string;
  albumId: string;
  ownerId: string;
  /** Chỉ trả về một lần duy nhất lúc tạo; server chỉ lưu hash. */
  token: string | null;
  allowDownload: boolean;
  hasPassword: boolean;
  expiresAt: IsoDateString | null;
  revokedAt: IsoDateString | null;
  createdAt: IsoDateString;
  accessCount: number;
  lastAccessedAt: IsoDateString | null;
}

export interface CreateShareInput {
  albumId: string;
  allowDownload: boolean;
  password?: string | null;
  /** Số ngày hiệu lực; `null` = không hết hạn. */
  expiresInDays?: number | null;
}

export interface UpdateShareInput {
  allowDownload?: boolean;
  password?: string | null;
  /** `null` để gỡ mật khẩu. */
  removePassword?: boolean;
  expiresInDays?: number | null;
}

/** Kết quả kiểm tra quyền truy cập một liên kết chia sẻ (phía server). */
export interface ShareAccess {
  share: {
    id: string;
    albumId: string;
    allowDownload: boolean;
    hasPassword: boolean;
    expiresAt: IsoDateString | null;
  };
  album: {
    id: string;
    title: string;
    description: string | null;
    coverPhotoId: string | null;
    photoCount: number;
    totalBytes: number;
    createdAt: IsoDateString;
    updatedAt: IsoDateString;
    /** Tên hiển thị của chủ album (không lộ email đầy đủ). */
    ownerLabel: string;
  };
}

/* ── Người dùng ───────────────────────────────────────────────── */

export interface AccountUser {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: IsoDateString;
}

export interface StorageUsage {
  usedBytes: number;
  photoCount: number;
  albumCount: number;
  /** Hạn mức byte nếu nhà cung cấp công bố (Supabase Free: 1GB). */
  quotaBytes: number | null;
}

/* ── Tải lên ──────────────────────────────────────────────────── */

export type UploadStatus =
  | "pending"
  | "preparing"
  /** Đang băm SHA-256 cục bộ trước khi gửi byte nào. */
  | "hashing"
  | "uploading"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled"
  | "duplicate";

export interface UploadItem {
  /** Khoá cục bộ, ổn định trong suốt phiên tải lên. */
  id: string;
  file: File;
  filename: string;
  fileSize: number;
  status: UploadStatus;
  /** 0–1, chỉ số byte đã gửi. */
  progress: number;
  uploadedBytes: number;
  attempts: number;
  error: string | null;
  photo: Photo | null;
  /** URL xem trước cục bộ (object URL) — phải được thu hồi. */
  previewUrl: string | null;
  /** Trùng với ảnh đã có trong album (cùng checksum). */
  duplicateOf: string | null;
  /** Thông tin bổ sung khi tải lên nhiều phần (chỉ backend kho lưu trữ). */
  multipart: UploadMultipartState | null;
}

/**
 * Tiến độ nhiều phần — đây là dữ liệu THẬT lấy từ phiên trên server, không
 * phải ước lượng của trình duyệt. Nhờ vậy đóng tab rồi mở lại vẫn biết đã gửi
 * tới phần nào.
 */
export interface UploadMultipartState {
  sessionId: string | null;
  /** Số byte đã nằm trên kho lưu trữ (các phần đã hoàn tất). */
  uploadedBytes: number;
  partSize: number;
  totalParts: number;
  completedParts: number[];
  sessionResumed: boolean;
}

/** Phiên tải lên còn dở, đọc từ server. */
export interface ActiveUploadSession {
  id: string;
  albumId: string;
  originalFilename: string;
  mimeType: string;
  totalBytes: number;
  partSize: number;
  partCount: number;
  uploadedBytes: number;
  completedParts: number;
  missingParts: number[];
  createdAt: IsoDateString;
  expiresAt: IsoDateString;
}

/** Sức khoẻ thật của kho lưu trữ (đã ghi/đọc thử, không phải khai báo suông). */
export interface ArchiveHealth {
  ok: boolean;
  ownerId: string;
  storage: {
    driver: string;
    uploadMode: string;
    originalsWritable: boolean;
    thumbnailsWritable: boolean;
  };
  database: { ok: boolean };
  queue: { pendingJobs: number };
  uploads: { activeSessions: number };
  limits: {
    workerMaxRequestBytes: number;
    r2MaxParts: number;
    note: string;
  };
  details: string[];
}

/** Kết quả một lần chạy bảo trì: dọn phiên bỏ dở + xác minh checksum theo lô. */
export interface ArchiveMaintenanceResult {
  abortedStaleSessions: number;
  jobsProcessed: { id: number; kind: string; ok: boolean; detail?: string }[];
  pendingJobsRemaining: number;
  remainingActiveSessions: number;
}

/** Dung lượng thật + chi phí ước tính, kèm cảnh báo ngưỡng của nhà cung cấp. */
export interface ArchiveUsage {
  usedBytes: number;
  originalBytes: number;
  thumbnailBytes: number;
  photoCount: number;
  albumCount: number;
  month: string;
  operations: { classA: number; classB: number; bytesWritten: number; bytesRead: number };
  cost: {
    currency: string;
    storageUsd: number;
    classAUsd: number;
    classBUsd: number;
    totalUsd: number;
    marginalPerGbMonthUsd: number;
    note: string;
  };
  verification: { awaitingVerification: number; mismatches: number };
  thresholds: {
    warnStorageBytes: number | null;
    warnClassA: number | null;
    warnClassB: number | null;
    /** LUÔN false: ứng dụng không chặn tải lên theo dung lượng. */
    enforced: boolean;
  };
  warnings: { level: "info" | "warning"; message: string }[];
}

export interface UploadResult {
  photo: Photo;
  checksum: string;
}

/* ── Tải xuống ────────────────────────────────────────────────── */

export type DownloadStatus =
  | "idle"
  | "preparing"
  | "running"
  | "zipping"
  | "completed"
  | "failed"
  | "cancelled";

export interface DownloadProgress {
  status: DownloadStatus;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  currentFile: string | null;
  /** Byte đã xử lý (chỉ tính khi đo được). */
  processedBytes: number;
  totalBytes: number;
  /** 0–1 nếu xác định được tổng; ngược lại là null. */
  fraction: number | null;
  errors: { filename: string; message: string }[];
  message: string | null;
}

export type DownloadStrategy =
  | "folder" // File System Access API: ghi trực tiếp vào thư mục người dùng chọn
  | "zip" // Gói ZIP (ghi ra OPFS nếu có, nếu không thì dùng JSZip)
  | "individual" // Tải từng tệp rời
  | "share-sheet"; // Web Share API (iOS/Android hiện đại)
