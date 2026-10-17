/** Lỗi miền có kiểu rõ ràng để tầng UI phản ứng đúng cách. */

export class AuthRequiredError extends Error {
  constructor(message = "Bạn cần đăng nhập để thực hiện thao tác này.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Không tìm thấy dữ liệu yêu cầu.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Bạn không có quyền truy cập nội dung này.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class LimitError extends Error {
  details: string | null;
  constructor(message: string, details: string | null = null) {
    super(message);
    this.name = "LimitError";
    this.details = details;
  }
}

export class ShareAccessError extends Error {
  reason: "invalid" | "expired" | "revoked" | "password-required" | "password-wrong" | "rate-limited";
  constructor(reason: ShareAccessError["reason"], message: string) {
    super(message);
    this.name = "ShareAccessError";
    this.reason = reason;
  }
}

/**
 * Lỗi vì KHÔNG liên lạc được với máy chủ (khác với "bị từ chối").
 *
 * Cần phân biệt vì hai tình huống này phải nói hai câu khác nhau cho người xem.
 * Với liên kết chia sẻ, lỗi kết nối thường chỉ là máy chủ đang tạm không phản
 * hồi — trong khi thông báo thô của tầng kho lưu trữ ("kiểm tra địa chỉ
 * Worker") là câu dành cho người cấu hình, không phải cho khách.
 */
export function isUnreachableError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "network") return true;
  const message = error instanceof Error ? error.message : "";
  return /failed to fetch|networkerror|load failed|không kết nối được/i.test(message);
}

/** Biến mọi lỗi thành thông báo tiếng Việt thân thiện để hiển thị. */
export function describeError(error: unknown): string {
  if (!error) return "Đã xảy ra lỗi không xác định.";
  if (error instanceof AuthRequiredError) return error.message;
  if (error instanceof NotFoundError) return error.message;
  if (error instanceof ForbiddenError) return error.message;
  if (error instanceof LimitError) return error.message;
  if (error instanceof ShareAccessError) return error.message;

  if (error instanceof DOMException && error.name === "AbortError") {
    return "Thao tác đã bị huỷ.";
  }

  if (error instanceof Error) {
    const message = error.message || "";
    // Lỗi mạng phổ biến khi mất kết nối hoặc bị chặn.
    if (/failed to fetch|networkerror|load failed/i.test(message)) {
      return "Không kết nối được tới máy chủ. Kiểm tra mạng rồi thử lại.";
    }
    if (/quota|exceeded the quota/i.test(message)) {
      return "Đã vượt hạn mức lưu trữ của nhà cung cấp. Hãy giải phóng dung lượng hoặc nâng gói.";
    }
    if (/payload too large|entity too large|exceeded.*size/i.test(message)) {
      return "Tệp vượt quá kích thước cho phép của kho lưu trữ.";
    }
    if (/duplicate key|already exists|23505/.test(message)) {
      return "Dữ liệu này đã tồn tại.";
    }
    if (/invalid login credentials/i.test(message)) {
      return "Email hoặc mật khẩu không đúng.";
    }
    if (/email not confirmed/i.test(message)) {
      return "Email chưa được xác nhận. Hãy kiểm tra hộp thư của bạn.";
    }
    if (/user already registered/i.test(message)) {
      return "Email này đã được đăng ký.";
    }
    if (/rate limit|too many requests/i.test(message)) {
      return "Bạn thao tác quá nhanh. Vui lòng chờ một lát rồi thử lại.";
    }
    return message;
  }

  return "Đã xảy ra lỗi không xác định.";
}
