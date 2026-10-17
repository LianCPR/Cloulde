/**
 * Đọc metadata ảnh và sinh ảnh thu nhỏ.
 *
 * QUAN TRỌNG: mọi hàm ở đây chỉ ĐỌC tệp gốc. Ảnh thu nhỏ là một object riêng
 * biệt trong thư mục `thumbnails`; tệp gốc không bao giờ bị ghi đè, nén lại,
 * chuyển định dạng hay sửa metadata (EXIF/IPTC).
 */

export interface ImageMetadata {
  width: number | null;
  height: number | null;
  /** Trình duyệt có giải mã và hiển thị được ảnh này không. */
  decodable: boolean;
}

/** Đọc nhanh kích thước từ header cho các định dạng phổ biến, không cần giải mã. */
function readHeaderDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // PNG: 8 byte chữ ký, rồi chunk IHDR.
  if (
    bytes.length > 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // JPEG: quét các marker tới SOFn.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      // Các marker không có độ dài (chèn, khởi động lại) thì bỏ qua.
      if (
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        offset += 2;
        continue;
      }
      const length = view.getUint16(offset + 2);
      // SOF0..SOF15, trừ các marker DHT/JPG/DAC (0xc4, 0xc8, 0xcc).
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7),
        };
      }
      if (length <= 0) break;
      offset += 2 + length;
    }
  }

  // WebP (VP8X / VP8 / VP8L)
  if (
    bytes.length > 30 &&
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "RIFF" &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === "WEBP"
  ) {
    const format = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (format === "VP8X") {
      const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width: w, height: h };
    }
    if (format === "VP8 ") {
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (format === "VP8L") {
      const bits =
        bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
  }

  return null;
}

/**
 * Đọc kích thước ảnh theo hai bước: đọc header (nhanh, ít bộ nhớ) trước,
 * sau đó thử giải mã thật để biết trình duyệt có hiển thị được không.
 */
export async function readImageMetadata(file: Blob): Promise<ImageMetadata> {
  let width: number | null = null;
  let height: number | null = null;

  try {
    const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
    const header = readHeaderDimensions(head);
    if (header && header.width > 0 && header.height > 0) {
      width = header.width;
      height = header.height;
    }
  } catch {
    // Bỏ qua: header không đọc được thì chuyển sang bước giải mã.
  }

  // `createImageBitmap` tôn trọng hướng EXIF và cho biết khả năng giải mã.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      width = bitmap.width;
      height = bitmap.height;
      bitmap.close?.();
      return { width, height, decodable: true };
    } catch {
      // Ảnh HEIC/RAW trên trình duyệt không hỗ trợ sẽ rơi vào đây.
    }
  }

  // Thử với <img> như phương án dự phòng (Safari đôi khi xử lý HEIC được).
  if (typeof Image !== "undefined" && typeof URL !== "undefined") {
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("decode-failed"));
        element.decoding = "async";
        element.src = url;
      });
      if (!width || !height) {
        width = image.naturalWidth || width;
        height = image.naturalHeight || height;
      }
      return { width, height, decodable: true };
    } catch {
      return { width, height, decodable: false };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return { width, height, decodable: false };
}

export interface ThumbnailResult {
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
}

/**
 * Sinh ảnh thu nhỏ chỉ để hiển thị lưới. Không đụng tới tệp gốc.
 * Trả về `null` khi trình duyệt không giải mã được (RAW, HEIC, TIFF…).
 */
export async function generateThumbnail(
  file: Blob,
  maxEdge = 480,
  quality = 0.76,
): Promise<ThumbnailResult | null> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    return null;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    if (!blob) {
      const jpeg = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      return jpeg ? { blob: jpeg, width, height, mimeType: jpeg.type } : null;
    }
    return { blob, width, height, mimeType: blob.type || "image/webp" };
  } catch {
    return null;
  } finally {
    bitmap.close?.();
  }
}
