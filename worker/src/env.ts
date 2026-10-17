/**
 * Kiểu binding và biến môi trường của Worker.
 *
 * Nguyên tắc bảo mật: KHÔNG có khoá bí mật nào ở phía trình duyệt. Thông tin
 * xác thực R2 chỉ tồn tại dưới dạng binding của Worker (nếu dùng binding) hoặc
 * secret của Worker (nếu bật driver S3 presign).
 */

export interface Env {
  /** Bucket ẢNH GỐC — private, bất biến. */
  ORIGINALS: R2Bucket;
  /** Bucket ảnh thu nhỏ — private, có thể xoá và tạo lại. */
  THUMBS: R2Bucket;
  /** Metadata (KHÔNG chứa nhị phân ảnh). */
  DB: D1Database;

  /** Ảnh tĩnh của SPA (khi Worker phục vụ luôn frontend). */
  ASSETS?: Fetcher;

  /**
   * Bí mật: token truy cập của chủ kho.
   *
   * Một trong HAI cách xác thực chủ kho. Cách còn lại là Cloudflare Access
   * (CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD). Có thể đặt cả hai.
   */
  ARCHIVE_TOKEN?: string;
  /**
   * Tên miền tổ chức Cloudflare Access, ví dụ `myteam.cloudflareaccess.com`.
   * Khi đặt CÙNG với CF_ACCESS_AUD, Worker chấp nhận danh tính do Access cấp và
   * xác minh chữ ký RS256 của JWT trước khi tin — xem `lib/access.ts`.
   */
  CF_ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) Tag của ứng dụng Access. Bắt buộc cùng với team domain. */
  CF_ACCESS_AUD?: string;
  /** Bí mật: khoá ký HMAC cho URL tải xuống có thời hạn. */
  LINK_SECRET?: string;
  /** Bí mật: mật khẩu kết nối R2 S3 (chỉ khi bật driver presign). */
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;

  /** Ngưỡng CẢNH BÁO (không phải hạn mức) theo gói Cloudflare thật. */
  PLAN_STORAGE_GB?: string;
  PLAN_CLASS_A_MILLIONS?: string;
  PLAN_CLASS_B_MILLIONS?: string;
  /** Đơn giá dùng để ước tính chi phí hiển thị. */
  PRICE_PER_GB_MONTH_USD?: string;
  PRICE_PER_MILLION_CLASS_A_USD?: string;
  PRICE_PER_MILLION_CLASS_B_USD?: string;
  /** Bật driver S3 presign (tải trực tiếp trình duyệt → R2). */
  STORAGE_DRIVER?: string;

  /**
   * Danh sách origin được phép gọi API, cách nhau bằng dấu phẩy.
   *
   * Chỉ cần khi trang web nằm ở origin KHÁC Worker (SPA trên Vercel + API trên
   * Cloudflare). Khi một Worker phục vụ cả hai thì cùng origin, không dùng CORS.
   * Xem `ALLOWED_ORIGINS` trong wrangler.toml.
   */
  ALLOWED_ORIGINS?: string;
}
