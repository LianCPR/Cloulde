/**
 * Chia danh sách ảnh thành từng đợt để đưa qua share sheet của hệ điều hành.
 *
 * Vì sao phải chia đợt: đường cũ nạp TOÀN BỘ blob vào RAM rồi gọi
 * `navigator.share()` đúng một lần. Với album 200 ảnh × 30MB, trang sẽ bị hệ
 * điều hành thu hồi bộ nhớ ngay giữa chừng. Chia đợt giữ mức tiêu thụ bộ nhớ
 * không đổi: mỗi thời điểm chỉ có một đợt nằm trong RAM.
 *
 * Chia theo CẢ HAI giới hạn — số tệp và số byte — vì một đợt 8 ảnh RAW vẫn có
 * thể nặng hơn một đợt 8 ảnh JPEG rất nhiều.
 *
 * Hàm này THUẦN (pure, không phụ thuộc trình duyệt) nên kiểm thử được bằng
 * script độc lập: xem `npm run verify:batches`.
 */
import type { Photo } from "@/types";

export interface PhotoBatch {
  /** Thứ tự đợt, bắt đầu từ 0. */
  index: number;
  photos: Photo[];
  bytes: number;
}

/** Số tệp tối đa mỗi đợt — đủ nhỏ để giữ RAM thấp, đủ lớn để ít lần bấm. */
export const PHOTO_BATCH_MAX_FILES = 8;
/** Trần dung lượng mỗi đợt, tính theo kích thước gốc đã ghi trong metadata. */
export const PHOTO_BATCH_MAX_BYTES = 120 * 1024 * 1024;

export function planPhotoBatches(
  photos: Photo[],
  options?: { maxFiles?: number; maxBytes?: number },
): PhotoBatch[] {
  const maxFiles = Math.max(1, options?.maxFiles ?? PHOTO_BATCH_MAX_FILES);
  const maxBytes = Math.max(1, options?.maxBytes ?? PHOTO_BATCH_MAX_BYTES);

  const batches: PhotoBatch[] = [];
  let current: Photo[] = [];
  let bytes = 0;

  const flush = () => {
    if (current.length === 0) return;
    batches.push({ index: batches.length, photos: current, bytes });
    current = [];
    bytes = 0;
  };

  for (const photo of photos) {
    const size = Math.max(0, photo.fileSize || 0);
    const tooManyFiles = current.length >= maxFiles;
    // `current.length > 0` để một ảnh đơn lẻ lớn hơn trần vẫn nằm trọn trong đợt
    // riêng của nó, thay vì bị bỏ qua hoặc tách vô hạn.
    const tooManyBytes = current.length > 0 && bytes + size > maxBytes;
    if (tooManyFiles || tooManyBytes) flush();
    current.push(photo);
    bytes += size;
  }
  flush();

  return batches;
}
