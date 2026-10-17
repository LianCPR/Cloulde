/**
 * Nơi lưu "kết nối kho lưu trữ" của chủ kho.
 *
 * ĐÂY LÀ ĐIỂM BẢO MẬT CẦN ĐỌC KỸ:
 *
 *  • Cách khuyến nghị (không có gì trong trình duyệt): đặt Worker sau
 *    Cloudflare Access. Khi đó trình duyệt chỉ gửi cookie do Access cấp, và
 *    trường `token` ở đây để trống. Không có khoá nào nằm trong JavaScript.
 *
 *  • Cách dự phòng: người dùng dán token chủ kho một lần. Token được lưu trong
 *    localStorage của CHÍNH origin này. Token KHÔNG nằm trong mã nguồn, không
 *    nằm trong bundle, và không bao giờ được gửi tới nơi nào khác ngoài Worker.
 *    Đổi lại: bất kỳ script nào chạy trên cùng origin (XSS) đều đọc được nó.
 *    Vì vậy Access là lựa chọn mặc định nên dùng cho môi trường thật.
 *
 * Không có bí mật nào của nhà cung cấp (R2 access key, secret) xuất hiện ở phía
 * trình duyệt — tầng lưu trữ chỉ nhận diện danh tính chủ kho.
 */

export interface ArchiveConnection {
  /** Gốc của Worker. Chuỗi rỗng = cùng origin (khuyến nghị khi đã triển khai). */
  baseUrl: string;
  /** Token chủ kho; `null` khi Cloudflare Access đứng trước Worker. */
  token: string | null;
  /** Nhãn do người dùng đặt, chỉ để hiển thị. */
  label: string | null;
  /** Thời điểm kết nối được xác minh thành công (ISO). */
  verifiedAt: string | null;
}

export const ARCHIVE_CONNECTION_KEY = "cloude-archive-connection";

export function readArchiveConnection(): ArchiveConnection | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ARCHIVE_CONNECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ArchiveConnection>;
    return {
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      token: typeof parsed.token === "string" && parsed.token ? parsed.token : null,
      label: typeof parsed.label === "string" && parsed.label ? parsed.label : null,
      verifiedAt: typeof parsed.verifiedAt === "string" ? parsed.verifiedAt : null,
    };
  } catch {
    return null;
  }
}

export function writeArchiveConnection(connection: ArchiveConnection): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ARCHIVE_CONNECTION_KEY, JSON.stringify(connection));
  } catch {
    // Chế độ riêng tư có thể chặn localStorage: ứng dụng vẫn chạy trong phiên này.
  }
}

export function clearArchiveConnection(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ARCHIVE_CONNECTION_KEY);
  } catch {
    // bỏ qua
  }
}

export function hasSavedArchiveConnection(): boolean {
  return readArchiveConnection() !== null;
}

/**
 * Chuẩn hoá địa chỉ Worker: bỏ dấu `/` cuối, chỉ nhận http/https.
 * Trả về chuỗi rỗng cho cùng origin.
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Địa chỉ kho lưu trữ không hợp lệ. Ví dụ: https://kho.example.com");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Địa chỉ phải bắt đầu bằng https:// hoặc http://");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
