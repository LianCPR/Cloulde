/**
 * Nhà máy tạo driver lưu trữ.
 *
 * Đây là điểm duy nhất trong Worker biết R2 tồn tại. Muốn thêm một nhà cung
 * cấp tương thích S3 khác, chỉ cần:
 *   1. Viết một lớp cài `StorageDriver` (xem `./types.ts`).
 *   2. Trả về nó từ hàm dưới đây khi cấu hình chọn driver đó.
 * Toàn bộ route, API và lược đồ D1 giữ nguyên, không phải sửa một dòng nào.
 *
 * TRUNG THỰC VỀ PHẠM VI: hiện chỉ driver `r2-binding` được cài đặt và kiểm thử.
 * Driver `s3-presign` (tải trực tiếp trình duyệt → bucket) CHƯA được cài, nên
 * cấu hình nói rõ điều đó thay vì trả về một đối tượng giả. Xem README.
 */

import type { Env } from "../env";
import type { StorageDriver } from "./types";
import { R2BindingDriver } from "./r2Binding";

export interface StorageBundle {
  /** Bucket ảnh gốc (bất biến). */
  originals: StorageDriver;
  /** Bucket ảnh thu nhỏ (có thể xoá và tạo lại). */
  thumbs: StorageDriver;
  readonly kind: StorageDriver["kind"];
  readonly uploadMode: StorageDriver["uploadMode"];
}

export function createStorage(env: Env): StorageBundle {
  const originals = new R2BindingDriver(env.ORIGINALS);
  const thumbs = new R2BindingDriver(env.THUMBS);
  return {
    originals,
    thumbs,
    kind: originals.kind,
    uploadMode: originals.uploadMode,
  };
}

export type { StorageDriver } from "./types";
