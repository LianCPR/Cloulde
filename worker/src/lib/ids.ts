/**
 * Sinh định danh và khoá lưu trữ.
 *
 * Hai bất biến được bảo vệ ở đây:
 *   1. Khoá lưu trữ là DUY NHẤT — hai tệp cùng tên không bao giờ ghi đè nhau.
 *   2. Đuôi tệp được giữ nguyên, để tệp tải về vẫn mở được bằng đúng ứng dụng.
 *
 * Tên tệp GỐC không bị thay đổi: nó được lưu nguyên văn trong cột
 * `original_filename` và dùng làm `Content-Disposition` khi tải về. Phần đã
 * được làm sạch dưới đây chỉ dùng cho khoá trên object storage.
 */

const MIB = 1024 * 1024;

export function newId(): string {
  return crypto.randomUUID();
}

/** Đuôi tệp (kể cả dấu chấm), đã hạ chữ thường. Rỗng nếu không có đuôi. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "";
  const ext = filename.slice(dot);
  return /^\.[A-Za-z0-9]{1,12}$/.test(ext) ? ext.toLowerCase() : "";
}

/**
 * Làm sạch tên tệp để dùng trong khoá lưu trữ: giữ chữ có dấu, bỏ ký tự có thể
 * gây rối cho đường dẫn (`/`, `\`, ký tự điều khiển), gộp khoảng trắng.
 */
export function slugForStorage(filename: string): string {
  const base = extensionOf(filename)
    ? filename.slice(0, filename.length - extensionOf(filename).length)
    : filename;
  const slug = base
    .normalize("NFC")
    // Giữ chữ và số Unicode (kể cả tiếng Việt có dấu), thay phần còn lại bằng '-'.
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase();
  return slug || "file";
}

export function contentTypeFor(filename: string, fallback = "application/octet-stream"): string {
  const ext = extensionOf(filename);
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".avif": "image/avif",
    ".dng": "image/x-adobe-dng",
    ".cr2": "image/x-canon-cr2",
    ".cr3": "image/x-canon-cr3",
    ".nef": "image/x-nikon-nef",
    ".arw": "image/x-sony-arw",
    ".raf": "image/x-fujifilm-raf",
    ".orf": "image/x-olympus-orf",
    ".rw2": "image/x-panasonic-rw2",
    ".psd": "image/vnd.adobe.photoshop",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
  };
  return map[ext] ?? fallback;
}

/**
 * Khoá cho ẢNH GỐC.
 *
 * Dạng: `originals/<owner>/<album>/<millis>-<slug>-<random><ext>`
 *
 * Phần ngẫu nhiên là thứ bảo đảm hai tệp cùng tên trong cùng album vẫn có khoá
 * khác nhau — không ghi đè, không mất ảnh.
 */
export function buildOriginalKey(
  ownerId: string,
  albumId: string,
  filename: string,
): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `originals/${ownerId}/${albumId}/${Date.now()}-${slugForStorage(filename)}-${random}${extensionOf(filename)}`;
}

/** Khoá cho ẢNH THU NHỎ, suy ra từ khoá ảnh gốc để luôn đi kèm nhau. */
export function buildThumbnailKey(originalKey: string): string {
  const withoutPrefix = originalKey.replace(/^originals\//, "");
  const dot = withoutPrefix.lastIndexOf(".");
  const base = dot > 0 ? withoutPrefix.slice(0, dot) : withoutPrefix;
  return `thumbnails/${base}.thumb.webp`;
}

/**
 * Tên tệp an toàn để đưa vào header `Content-Disposition`.
 *
 * Dùng cả dạng ASCII dự phòng và dạng `filename*` theo RFC 5987 để tên tiếng
 * Việt có dấu không bị hỏng khi tải về.
 */
export function contentDisposition(filename: string, inline = false): string {
  const disposition = inline ? "inline" : "attachment";
  const ascii = filename
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MIB) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * MIB) return `${(bytes / MIB).toFixed(1)} MB`;
  return `${(bytes / 1024 / MIB).toFixed(2)} GB`;
}
