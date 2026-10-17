/** Định dạng hiển thị tiếng Việt. */

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/** 1536000 → "1,5 MB" (dấu phẩy thập phân theo chuẩn tiếng Việt). */
export function formatBytes(bytes: number, fractionDigits?: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  const digits =
    fractionDigits ?? (exponent === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2);
  return `${value.toLocaleString("vi-VN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${BYTE_UNITS[exponent]}`;
}

/** "1.234 ảnh" — dùng dấu chấm phân cách nghìn theo tiếng Việt. */
export function formatCount(value: number, noun?: string): string {
  const number = value.toLocaleString("vi-VN");
  return noun ? `${number} ${noun}` : number;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("vi-VN");
}

const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const relativeFormatter = new Intl.RelativeTimeFormat("vi-VN", {
  numeric: "auto",
});

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return dateFormatter.format(date);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFormatter.format(date);
}

/** "3 giờ trước", "2 ngày trước", … */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return relativeFormatter.format(diffSeconds, "second");
  if (abs < 3600) return relativeFormatter.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86400) return relativeFormatter.format(Math.round(diffSeconds / 3600), "hour");
  if (abs < 2592000)
    return relativeFormatter.format(Math.round(diffSeconds / 86400), "day");
  if (abs < 31536000)
    return relativeFormatter.format(Math.round(diffSeconds / 2592000), "month");
  return relativeFormatter.format(Math.round(diffSeconds / 31536000), "year");
}

/** Rút ngắn tên tệp dài nhưng vẫn giữ phần mở rộng. */
export function truncateMiddle(value: string, max = 34): string {
  if (value.length <= max) return value;
  const dot = value.lastIndexOf(".");
  const ext = dot > 0 && value.length - dot <= 8 ? value.slice(dot) : "";
  const head = Math.max(6, Math.floor((max - ext.length - 1) / 2));
  const tail = Math.max(4, max - ext.length - head - 1);
  return `${value.slice(0, head)}…${value.slice(value.length - ext.length - tail)}`;
}

/** Nhãn số nhiều tiếng Việt: 1 ảnh / 12 ảnh. */
export function photoCountLabel(count: number): string {
  return `${formatNumber(count)} ảnh`;
}
