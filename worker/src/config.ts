/**
 * Cấu hình runtime của Worker.
 *
 * QUAN TRỌNG — TRIẾT LÝ CỦA TỆP NÀY:
 * Không có hạn mức dung lượng, không có hạn mức số ảnh, không có "gói" nào do
 * ứng dụng tự đặt. Mọi con số ở đây thuộc một trong hai loại:
 *
 *   1. NGƯỠNG CẢNH BÁO — lấy từ gói Cloudflare thật mà tài khoản đang dùng.
 *      Vượt ngưỡng chỉ sinh CẢNH BÁO để bạn kịp nâng gói, KHÔNG chặn tải lên.
 *   2. RÀNG BUỘC KỸ THUẬT của nhà cung cấp — ví dụ phần tối thiểu 5 MiB của
 *      multipart, hoặc trần thân request 100 MB của Worker. Đây là giới hạn
 *      thật của nền tảng, không phải lựa chọn của ứng dụng, và được kiểm tra
 *      để báo lỗi rõ ràng thay vì hỏng âm thầm.
 *
 * Sức chứa thực tế phụ thuộc: giới hạn nhà cung cấp, trạng thái tài khoản và
 * phương thức thanh toán. Không ở đâu trong mã nguồn được hứa "không giới hạn".
 */

const GIB = 1024 ** 3;

/** Ràng buộc của R2: mọi phần không phải phần cuối phải bằng nhau, và ≥ 5 MiB. */
export const R2_MIN_PART_BYTES = 5 * 1024 * 1024;
/**
 * Ràng buộc THỰC TẾ đã đo được: phần cuối phải ≤ kích thước phần chuẩn.
 * Nếu phần cuối lớn hơn, R2 trả lỗi `completeMultipartUpload` (mã 10048).
 * Vì vậy số phần luôn tính bằng phép chia LÀM TRÒN LÊN, để phần cuối ≤ phần chuẩn.
 */
export const R2_MAX_PARTS = 10_000;

/** Trần thân request của Cloudflare Worker (gói Free/Pro) — không vượt được. */
export const WORKER_MAX_REQUEST_BYTES = 100 * 1024 * 1024;

/** Kích thước phần: đủ lớn để ít request, đủ nhỏ để resume mượt, dưới trần request. */
export const PART_BYTES_MIN = 8 * 1024 * 1024;
export const PART_BYTES_MAX = 64 * 1024 * 1024;
/** Chừa biên an toàn dưới R2_MAX_PARTS để không chạm trần cứng. */
export const PART_TARGET_MAX_PARTS = 9_000;

/**
 * Số ảnh được xác minh checksum mỗi lần chạy bảo trì.
 *
 * Đây KHÔNG phải hạn mức lưu trữ — chỉ là kích thước lô của hàng đợi nền. Mỗi
 * lần xác minh đọc lại toàn bộ ảnh gốc (một Class B read trên mỗi ảnh), nên lô
 * được giới hạn để chi phí đọc không tăng vọt sau một đợt tải lên lớn. Hàng đợi
 * không mất việc: phần còn lại được xử lý ở lần chạy kế tiếp.
 */
export const MAINTENANCE_DEFAULT_BATCH = 10;
export const MAINTENANCE_MAX_BATCH = 50;

export interface StoragePlan {
  partSize: number;
  partCount: number;
}

/**
 * Tính kích thước mỗi phần cho một tệp.
 *
 * Bảo đảm hai quy tắc của R2:
 *   • mọi phần không phải phần cuối đều ĐÚNG BẰNG `partSize`;
 *   • phần cuối ≤ `partSize` (nhờ phép chia làm tròn lên).
 */
export function planStorage(totalBytes: number): StoragePlan {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    throw new Error("Kích thước tệp không hợp lệ.");
  }
  const neededPerPart = Math.ceil(totalBytes / PART_TARGET_MAX_PARTS);
  const roundedToMiB = Math.ceil(neededPerPart / (1024 * 1024)) * 1024 * 1024;
  const partSize = Math.min(PART_BYTES_MAX, Math.max(PART_BYTES_MIN, roundedToMiB));
  const partCount = Math.max(1, Math.ceil(totalBytes / partSize));

  if (partCount > R2_MAX_PARTS) {
    // Báo lỗi rõ ràng và nêu con đường khắc phục, thay vì thất bại khó hiểu.
    const ceiling = PART_BYTES_MAX * (R2_MAX_PARTS - 1);
    throw new Error(
      `Tệp vượt sức chứa của một phiên multipart qua Worker. ` +
        `Tối đa khoảng ${(ceiling / GIB).toFixed(0)} GB mỗi tệp với các phần ${PART_BYTES_MAX / 1024 / 1024} MB. ` +
        `Cần driver S3 presign (tải trực tiếp trình duyệt → R2) để vượt qua.`,
    );
  }

  return { partSize, partCount };
}

/** Số byte của một phần cụ thể — phần cuối luôn ≤ partSize. */
export function partByteSize(totalBytes: number, partSize: number, partNumber: number): number {
  const partCount = Math.max(1, Math.ceil(totalBytes / partSize));
  if (partNumber < 1 || partNumber > partCount) {
    throw new Error(`Số thứ tự phần không hợp lệ: ${partNumber}/${partCount}.`);
  }
  if (partNumber === partCount) {
    return totalBytes - (partCount - 1) * partSize;
  }
  return partSize;
}

export interface CostEstimate {
  storageUsd: number;
  classAUsd: number;
  classBUsd: number;
  totalUsd: number;
  /** Chi phí/tháng cho mỗi GB tăng thêm — để người dùng tự chiếu. */
  marginalPerGbMonthUsd: number;
}

export interface RuntimeConfig {
  /** Ngưỡng cảnh báo (byte), lấy từ gói thật. `null` = chưa cấu hình. */
  warnStorageBytes: number | null;
  warnClassA: number | null;
  warnClassB: number | null;
  pricePerGbMonth: number;
  pricePerMillionClassA: number;
  pricePerMillionClassB: number;
  /** Thời hạn URL tải xuống có chữ ký (giây). */
  linkTtlSeconds: number;
  /** Thời hạn phiên tải lên trước khi bị coi là bỏ dở (giây). */
  sessionTtlSeconds: number;
  /** Số ảnh xác minh checksum mỗi lần chạy bảo trì. */
  maintenanceBatch: number;
  /** Driver lưu trữ đang dùng. */
  driver: "r2-binding" | "s3-presign";
}

function numberOrNull(raw: string | undefined, multiplier = 1): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * multiplier : null;
}

export function readConfig(env: {
  PLAN_STORAGE_GB?: string;
  PLAN_CLASS_A_MILLIONS?: string;
  PLAN_CLASS_B_MILLIONS?: string;
  PRICE_PER_GB_MONTH_USD?: string;
  PRICE_PER_MILLION_CLASS_A_USD?: string;
  PRICE_PER_MILLION_CLASS_B_USD?: string;
  MAINTENANCE_BATCH?: string;
  STORAGE_DRIVER?: string;
}): RuntimeConfig {
  const requestedBatch = Number(env.MAINTENANCE_BATCH);
  return {
    warnStorageBytes: numberOrNull(env.PLAN_STORAGE_GB, GIB),
    warnClassA: numberOrNull(env.PLAN_CLASS_A_MILLIONS, 1_000_000),
    warnClassB: numberOrNull(env.PLAN_CLASS_B_MILLIONS, 1_000_000),
    // Giá mặc định là giá R2 Standard đã công bố, nhưng luôn đọc được từ cấu hình
    // để không phải sửa mã khi nhà cung cấp đổi giá.
    pricePerGbMonth: numberOrNull(env.PRICE_PER_GB_MONTH_USD) ?? 0.015,
    pricePerMillionClassA: numberOrNull(env.PRICE_PER_MILLION_CLASS_A_USD) ?? 4.5,
    pricePerMillionClassB: numberOrNull(env.PRICE_PER_MILLION_CLASS_B_USD) ?? 0.36,
    linkTtlSeconds: 60 * 30,
    sessionTtlSeconds: 7 * 24 * 60 * 60,
    maintenanceBatch:
      Number.isFinite(requestedBatch) && requestedBatch > 0
        ? Math.min(MAINTENANCE_MAX_BATCH, Math.floor(requestedBatch))
        : MAINTENANCE_DEFAULT_BATCH,
    // Chỉ driver này được cài đặt và kiểm thử. Không khai báo một driver chưa
    // tồn tại chỉ để danh sách trông đầy đủ.
    driver: "r2-binding",
  };
}

export function estimateCost(
  config: RuntimeConfig,
  usedBytes: number,
  classA: number,
  classB: number,
): CostEstimate {
  const gb = usedBytes / GIB;
  const storageUsd = gb * config.pricePerGbMonth;
  const classAUsd = (classA / 1_000_000) * config.pricePerMillionClassA;
  const classBUsd = (classB / 1_000_000) * config.pricePerMillionClassB;
  return {
    storageUsd,
    classAUsd,
    classBUsd,
    totalUsd: storageUsd + classAUsd + classBUsd,
    marginalPerGbMonthUsd: config.pricePerGbMonth,
  };
}
