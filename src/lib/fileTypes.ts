/**
 * Nhận dạng định dạng tệp ảnh, làm sạch tên tệp và sinh đường dẫn lưu trữ an toàn.
 *
 * Nguyên tắc: TÊN GỐC được giữ nguyên để hiển thị và để đặt tên khi tải xuống.
 * Đường dẫn object trong kho lưu trữ thì luôn được sinh mới, chỉ gồm ký tự ASCII
 * an toàn, nên không thể xảy ra path traversal hay ghi đè ngoài ý muốn.
 */

/** Định dạng ảnh chụp phổ biến mà trình duyệt hiển thị được. */
const BROWSER_PREVIEWABLE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
  "image/x-ms-bmp",
]);

/** Định dạng ảnh gốc được chấp nhận lưu trữ (kể cả loại không xem trước được). */
export const RAW_EXTENSIONS = [
  "dng",
  "cr2",
  "cr3",
  "nef",
  "nrw",
  "arw",
  "srf",
  "raf",
  "orf",
  "rw2",
  "pef",
  "srw",
  "tif",
  "tiff",
  "heic",
  "heif",
  "avif",
  "3fr",
  "x3f",
] as const;

const RAW_MIME_BY_EXTENSION: Record<string, string> = {
  dng: "image/x-adobe-dng",
  cr2: "image/x-canon-cr2",
  cr3: "image/x-canon-cr3",
  nef: "image/x-nikon-nef",
  nrw: "image/x-nikon-nrw",
  arw: "image/x-sony-arw",
  srf: "image/x-sony-srf",
  raf: "image/x-fuji-raf",
  orf: "image/x-olympus-orf",
  rw2: "image/x-panasonic-rw2",
  pef: "image/x-pentax-pef",
  srw: "image/x-samsung-srw",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  "3fr": "image/x-hasselblad-3fr",
  x3f: "image/x-sigma-x3f",
};

/**
 * `accept` cho <input type="file">.
 * Liệt kê rõ phần mở rộng RAW vì nhiều hệ điều hành không gán MIME cho chúng.
 */
export const PHOTO_ACCEPT_ATTRIBUTE = [
  "image/*",
  ...RAW_EXTENSIONS.map((ext) => `.${ext}`),
].join(",");

export function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

export function getBaseName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/** Suy ra MIME khi hệ điều hành trả về chuỗi rỗng (hay gặp với RAW). */
export function resolveMimeType(file: File): string {
  const declared = (file.type || "").toLowerCase().trim();
  if (declared && declared !== "application/octet-stream") return declared;
  const ext = getExtension(file.name);
  return RAW_MIME_BY_EXTENSION[ext] ?? (declared || "application/octet-stream");
}

/**
 * Làm sạch TÊN GỐC để an toàn khi hiển thị và khi ghi ra đĩa.
 * Giữ nguyên chữ có dấu tiếng Việt, khoảng trắng, dấu gạch — chỉ loại bỏ
 * thành phần đường dẫn và ký tự điều khiển.
 */
export function sanitizeOriginalFilename(rawName: string): string {
  const normalized = (rawName || "anh").normalize("NFC");
  // Bỏ mọi thành phần thư mục: "C:\\a\\b.jpg", "../../etc/passwd"
  const lastSegment = normalized.split(/[\\/]/).pop() ?? "anh";
  // eslint-disable-next-line no-control-regex
  const cleaned = lastSegment
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[:*?"<>|]/g, "-")
    .replace(/^\.+/, "")
    .trim();
  const safe = cleaned.length > 0 ? cleaned : "anh";
  // Giới hạn độ dài để không phá vỡ giới hạn tên tệp của hệ điều hành.
  if (safe.length <= 180) return safe;
  const ext = getExtension(safe);
  const base = getBaseName(safe).slice(0, 170);
  return ext ? `${base}.${ext}` : base;
}

/** Đoạn đường dẫn ASCII an toàn, không bao giờ chứa dấu chấm kép. */
function asciiSlug(value: string, maxLength = 60): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "anh";
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

/**
 * Sinh đường dẫn object cho ảnh gốc:
 *   originals/<ownerId>/<albumId>/<timestamp>-<slug>-<random>.<ext>
 * Nhờ phần random, hai tệp trùng tên không bao giờ ghi đè nhau.
 */
export function buildOriginalStoragePath(
  ownerId: string,
  albumId: string,
  filename: string,
): string {
  const ext = getExtension(filename);
  const base = asciiSlug(getBaseName(filename));
  const stamp = Date.now().toString(36);
  const suffix = ext ? `.${ext}` : "";
  return `${ownerId}/${albumId}/${stamp}-${base}-${randomId()}${suffix}`;
}

/** Đường dẫn ảnh thu nhỏ tương ứng (thư mục riêng, không lẫn với ảnh gốc). */
export function buildThumbnailStoragePath(originalPath: string): string {
  return `${originalPath.replace(/\.[^./]+$/, "")}.thumb.webp`;
}

/** Đảm bảo mọi đường dẫn nhận từ server không thể thoát khỏi thư mục gốc. */
export function assertSafeStoragePath(path: string): string {
  const trimmed = (path || "").replace(/^\/+/, "");
  if (
    !trimmed ||
    trimmed.includes("..") ||
    trimmed.includes("\\") ||
    trimmed.includes("\u0000") ||
    trimmed.startsWith("http")
  ) {
    throw new Error("Đường dẫn lưu trữ không hợp lệ.");
  }
  return trimmed;
}

/**
 * Trình duyệt có thể hiển thị trực tiếp định dạng này không?
 * Đây chỉ là phỏng đoán ban đầu theo MIME; nơi gọi nên xác nhận thêm bằng
 * khả năng giải mã thực tế (xem `readImageMetadata`).
 */
export function isMimeLikelyPreviewable(mimeType: string): boolean {
  return BROWSER_PREVIEWABLE_MIME.has((mimeType || "").toLowerCase());
}

/** Nhãn định dạng thân thiện để hiển thị thay cho ảnh không xem trước được. */
export function formatLabelFromMime(mimeType: string, filename: string): string {
  const ext = getExtension(filename);
  if (ext) return ext.toUpperCase();
  const sub = (mimeType || "").split("/")[1];
  return sub ? sub.toUpperCase() : "ẢNH";
}

/** Có phải ảnh RAW / TIFF / HEIC (nhóm cần xử lý đặc biệt)? */
export function isArchiveFormat(filename: string): boolean {
  return (RAW_EXTENSIONS as readonly string[]).includes(getExtension(filename));
}

/**
 * Chuẩn hoá tên tệp để so sánh trùng lặp: bỏ dấu, không phân biệt hoa thường.
 * Chỉ dùng để phát hiện và cảnh báo — không bao giờ tự ý xoá tệp trùng tên.
 */
export function normalizeFilenameKey(filename: string): string {
  return filename.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Tạo tên tệp không trùng: "IMG_1.jpg" → "IMG_1 (2).jpg". */
export function dedupeFilename(filename: string, taken: Set<string>): string {
  if (!taken.has(filename.toLowerCase())) return filename;
  const ext = getExtension(filename);
  const base = getBaseName(filename);
  let index = 2;
  for (;;) {
    const candidate = ext ? `${base} (${index}).${ext}` : `${base} (${index})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
    index += 1;
  }
}
