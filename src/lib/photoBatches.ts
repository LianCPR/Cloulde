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

/**
 * Không giới hạn số lượng ảnh hoặc tổng dung lượng mỗi đợt.
 * Toàn bộ danh sách ảnh không rỗng sẽ nằm trong một đợt duy nhất.
 */
export function planPhotoBatches(photos: Photo[]): PhotoBatch[] {
  if (photos.length === 0) return [];

  return [
    {
      index: 0,
      photos,
      bytes: photos.reduce(
        (total, photo) => total + Math.max(0, photo.fileSize || 0),
        0,
      ),
    },
  ];
}
