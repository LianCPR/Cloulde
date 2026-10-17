/**
 * Mô hình chi phí kho lưu trữ.
 *
 * Vì sao có tệp này: giá là con số duy nhất quyết định "chứa được bao nhiêu ảnh".
 * Thay vì hứa hẹn, tệp này tính từ ĐƠN GIÁ ĐÃ CẤU HÌNH và số byte thật, để bạn
 * tự chiếu trước khi triển khai.
 *
 * Chạy:
 *   npm run worker:cost                # kịch bản mặc định
 *   npm run worker:cost -- 500         # 500 GB ảnh gốc
 *   npm run worker:cost -- 500 3       # 500 GB, mỗi ảnh 3 GB đọc/tháng khi xem
 *
 * Đơn giá lấy từ cùng nguồn với Worker (`worker/.dev.vars` hoặc biến môi trường),
 * nên KHÔNG có hai nơi khai báo giá khác nhau.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Đọc các biến dạng KEY=VALUE từ .dev.vars nếu có (không in giá trị bí mật). */
function readDevVars(): Record<string, string> {
  try {
    const contents = readFileSync(join(here, "..", ".dev.vars"), "utf8");
    const map: Record<string, string> = {};
    for (const line of contents.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)\s*=\s*(.+)$/.exec(line.trim());
      if (match) map[match[1]] = match[2].trim();
    }
    return map;
  } catch {
    return {};
  }
}

const vars = readDevVars();
const pick = (key: string, fallback: number): number => {
  const raw = process.env[key] ?? vars[key];
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const GIB = 1024 ** 3;
const PRICE_PER_GB_MONTH = pick("PRICE_PER_GB_MONTH_USD", 0.015);
const PRICE_PER_MILLION_CLASS_A = pick("PRICE_PER_MILLION_CLASS_A_USD", 4.5);
const PRICE_PER_MILLION_CLASS_B = pick("PRICE_PER_MILLION_CLASS_B_USD", 0.36);
const FREE_GB = pick("PLAN_STORAGE_GB", 10);
const FREE_CLASS_A = pick("PLAN_CLASS_A_MILLIONS", 1) * 1_000_000;
const FREE_CLASS_B = pick("PLAN_CLASS_B_MILLIONS", 10) * 1_000_000;

const storageGb = Number(process.argv[2] ?? "500");
const thumbnailGb = Math.max(0, storageGb * 0.001); // ảnh thu nhỏ ~0,1% dung lượng gốc
const viewsPerMonth = Number(process.argv[3] ?? "2"); // số lần mỗi GB được đọc lại

const billableGb = Math.max(0, storageGb + thumbnailGb - FREE_GB);
const classA = 120 * 1000; // 1000 ảnh/tháng × ~120 thao tác Class A mỗi ảnh (chia phần)
const classBBytes = (storageGb + thumbnailGb) * GIB * viewsPerMonth;
const classB = viewsPerMonth * 1000 * 63 + 1000; // đọc lại từng phần khi xem/tải 1000 ảnh
const billableA = Math.max(0, classA - FREE_CLASS_A);
const billableB = Math.max(0, classB - FREE_CLASS_B);

const storageUsd = billableGb * PRICE_PER_GB_MONTH;
const classAUsd = (billableA / 1_000_000) * PRICE_PER_MILLION_CLASS_A;
const classBUsd = (billableB / 1_000_000) * PRICE_PER_MILLION_CLASS_B;
const workersUsd = 5; // gói Workers Paid — cần thiết khi vượt hạn mức Free

/** Giữ đủ chữ số thập phân để đơn giá nhỏ không bị làm tròn thành $0.00. */
const money = (value: number): string => (value < 1 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`);
const bytes = (value: number): string => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  let size = value;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index >= 3 ? 2 : 1)} ${units[index]}`;
};

console.log(`
Mô hình chi phí kho lưu trữ — Cloudflare R2 + Workers + D1
───────────────────────────────────────────────────────────
Giả định
  • Ảnh gốc đang lưu:              ${storageGb} GB (${bytes(storageGb * GIB)})
  • Ảnh thu nhỏ:                   ${thumbnailGb.toFixed(2)} GB (~0,1% dung lượng gốc)
  • Số lần mỗi GB được đọc/tháng:  ${viewsPerMonth}
  • Số ảnh tải lên mỗi tháng:      1.000 ảnh (mỗi ảnh ~120 thao tác Class A vì chia phần)

Đơn giá đang dùng (đọc từ worker/.dev.vars, không phải hằng số trong mã)
  • Lưu trữ:        $${PRICE_PER_GB_MONTH}/GB/tháng
  • Class A:        $${PRICE_PER_MILLION_CLASS_A}/triệu thao tác
  • Class B:        $${PRICE_PER_MILLION_CLASS_B}/triệu thao tác
  • Egress:         $0 (R2 không tính phí băng thông ra Internet)

Miễn phí mỗi tháng (theo ngưỡng đã cấu hình)
  • ${FREE_GB} GB lưu trữ · ${FREE_CLASS_A.toLocaleString("vi-VN")} Class A · ${FREE_CLASS_B.toLocaleString("vi-VN")} Class B

Ước tính mỗi tháng
  • Lưu trữ vượt ngưỡng:  ${billableGb.toFixed(1)} GB → ${money(storageUsd)}
  • Class A vượt ngưỡng:  ${billableA.toLocaleString("vi-VN")} → ${money(classAUsd)}
  • Class B vượt ngưỡng:  ${billableB.toLocaleString("vi-VN")} → ${money(classBUsd)}
  • Gói Workers Paid:     ${money(workersUsd)} (bắt buộc khi vượt hạn mức Free)
  ─────────────────────────────────────────
  TỔNG:                   ${money(storageUsd + classAUsd + classBUsd + workersUsd)}
                          ≈ ${money((storageUsd + classAUsd + classBUsd + workersUsd) / Math.max(1, storageGb))} mỗi GB đang lưu

CHI PHÍ BIÊN: mỗi GB ảnh gốc tăng thêm tốn ${money(PRICE_PER_GB_MONTH)}/tháng.
KHÔNG có hạn mức dung lượng hay số ảnh do ứng dụng đặt — con số trên chỉ là tiền
nhà cung cấp tính, không phải giới hạn kỹ thuật.

CHƯA tính trong đây (phải tự cấu hình và tự trả):
  • Sao lưu: bản sao thứ hai ra ổ ngoài/nhà cung cấp khác — R2 KHÔNG sao lưu hộ bạn.
  • D1: metadata (nhỏ — vài trăm byte mỗi ảnh) nằm trong gói Workers Paid.
  • Di chuyển dữ liệu ra khỏi R2 (egress) là miễn phí, nhưng thời gian thì không.
`);
