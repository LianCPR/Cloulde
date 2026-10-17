/**
 * Phát hiện khả năng của trình duyệt/thiết bị.
 *
 * Mục tiêu là đưa ra lựa chọn tải xuống TRUNG THỰC: chỉ đề xuất những gì
 * trình duyệt thực sự làm được, không hứa hẹn tính năng không tồn tại.
 */

export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function isIOS(): boolean {
  if (!isBrowser()) return false;
  const ua = navigator.userAgent;
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOS;
}

export function isAndroid(): boolean {
  if (!isBrowser()) return false;
  return /Android/i.test(navigator.userAgent);
}

/**
 * Máy tính để bàn — không phải iOS/Android. Đây là nơi File System Access API
 * phát huy tác dụng, và cũng là nơi cần màn hình hướng dẫn giải nén.
 */
export function isDesktop(): boolean {
  return isBrowser() && !isIOS() && !isAndroid();
}

export function isSafari(): boolean {
  if (!isBrowser()) return false;
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Android/.test(ua);
}

/**
 * File System Access API: cho phép người dùng chọn thư mục và ghi trực tiếp
 * từng ảnh gốc xuống đĩa. Hiện có trên Chrome/Edge (desktop) và Opera.
 * Safari và Firefox chưa hỗ trợ.
 */
export function supportsFileSystemAccess(): boolean {
  return isBrowser() && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

/**
 * Origin Private File System: cho phép ghi tệp ZIP hàng GB ra đĩa của trình
 * duyệt thay vì giữ trong RAM.
 */
export function supportsOpfs(): boolean {
  return (
    isBrowser() &&
    typeof navigator.storage?.getDirectory === "function" &&
    typeof FileSystemFileHandle !== "undefined" &&
    "createWritable" in FileSystemFileHandle.prototype
  );
}

/** Web Share API cấp 2: chia sẻ tệp qua share sheet của hệ điều hành. */
export function supportsShareFiles(): boolean {
  return isBrowser() && typeof navigator.canShare === "function";
}

export function isSecureContext(): boolean {
  return isBrowser() ? window.isSecureContext : false;
}

export function isStandaloneDisplay(): boolean {
  if (!isBrowser()) return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export interface DeviceCapabilities {
  ios: boolean;
  android: boolean;
  /** Máy tính để bàn (không iOS/Android). */
  desktop: boolean;
  safari: boolean;
  fileSystemAccess: boolean;
  opfs: boolean;
  shareFiles: boolean;
  secureContext: boolean;
  /** Chiến lược tải xuống nên đề xuất trước. */
  recommendedStrategy: "folder" | "zip" | "individual";
  /** Có cần hướng dẫn thêm để lưu vào Thư viện ảnh không? */
  needsPhotosGuidance: boolean;
}

export function detectCapabilities(): DeviceCapabilities {
  const ios = isIOS();
  const android = isAndroid();
  const fileSystemAccess = supportsFileSystemAccess();
  return {
    ios,
    android,
    desktop: isDesktop(),
    safari: isSafari(),
    fileSystemAccess,
    opfs: supportsOpfs(),
    shareFiles: supportsShareFiles(),
    secureContext: isSecureContext(),
    recommendedStrategy: fileSystemAccess ? "folder" : ios ? "individual" : "zip",
    // Trình duyệt không thể ghi trực tiếp vào Thư viện ảnh của iOS.
    needsPhotosGuidance: ios,
  };
}

/* ── Tuỳ chọn hành vi tải xuống (lưu cục bộ trên máy người dùng) ── */

export interface DownloadPreferences {
  /** Hỏi trước khi tải hàng loạt hay dùng lại lựa chọn gần nhất. */
  askBeforeBulkDownload: boolean;
  /** Tự động kiểm tra SHA-256 sau khi tải xong (chỉ với tệp ≤ 10MB). */
  verifyChecksums: boolean;
  /**
   * iOS: người dùng đã đồng ý lưu ảnh vào Thư viện ảnh chưa.
   * `null` = chưa từng hỏi, nên phải hỏi trước khi lưu hàng loạt.
   *
   * LƯU Ý TRUNG THỰC: đây là lựa chọn của NGƯỜI DÙNG trong ứng dụng, không phải
   * quyền của hệ điều hành. Trình duyệt web KHÔNG có API nào ghi thẳng vào Thư
   * viện ảnh — mọi thao tác lưu đều phải qua share sheet và do người dùng bấm
   * xác nhận. Cờ này chỉ quyết định luồng nào được đề xuất trước.
   */
  saveToPhotosLibrary: boolean | null;
}

const PREFERENCES_KEY = "cloude-download-preferences";

const DEFAULT_PREFERENCES: DownloadPreferences = {
  askBeforeBulkDownload: true,
  verifyChecksums: false,
  saveToPhotosLibrary: null,
};

export function readDownloadPreferences(): DownloadPreferences {
  if (!isBrowser()) return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<DownloadPreferences>;
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function writeDownloadPreferences(preferences: DownloadPreferences): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Chế độ riêng tư có thể chặn localStorage — bỏ qua an toàn.
  }
}
