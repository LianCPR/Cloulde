/**
 * Nguồn dữ liệu ảnh GỐC cho tầng tải xuống.
 *
 * Cung cấp hai cách đọc cùng một object:
 *  - `stream()`: đọc theo luồng, bộ nhớ không đổi — dùng cho album lớn, ZIP
 *    theo luồng và ghi trực tiếp vào thư mục người dùng chọn.
 *  - `blob()`: đọc toàn bộ (dùng khi cần kiểm tra checksum hoặc trình duyệt
 *    không hỗ trợ luồng).
 *
 * Cả hai đường đi đều trả về NGUYÊN BYTE của tệp đã lưu: không giải mã,
 * không vẽ lại qua canvas, không mã hoá lại.
 */
export interface OriginalSource {
  /** Kích thước tệp gốc theo byte (từ metadata). */
  size: number;
  stream: () => Promise<ReadableStream<Uint8Array>>;
  blob: () => Promise<Blob>;
}

export function sourceFromBlobFactory(
  factory: () => Promise<Blob>,
  size: number,
): OriginalSource {
  return {
    size,
    async stream() {
      const blob = await factory();
      return blob.stream();
    },
    blob: factory,
  };
}

/**
 * Tạo nguồn từ một `Response`. Khi máy chủ không trả về nội dung theo luồng
 * (hoặc CORS chặn stream), tự động lùi về đọc toàn bộ blob.
 */
export async function sourceFromResponse(
  response: Response,
  expectedSize: number,
): Promise<OriginalSource> {
  const body = response.body;
  const lengthHeader = Number(response.headers.get("content-length") ?? "0");
  const size = lengthHeader > 0 ? lengthHeader : expectedSize;

  if (body) {
    return {
      size,
      async stream() {
        return body;
      },
      async blob() {
        // `body` đã bị tiêu thụ nếu stream() được gọi trước; nơi gọi chỉ dùng
        // một trong hai đường đi cho mỗi phiên tải.
        return await new Response(body).blob();
      },
    };
  }

  const blob = await response.blob();
  return sourceFromBlobFactory(async () => blob, blob.size);
}

/** Đối tượng huỷ theo yêu cầu (dùng chung cho upload và download). */
export function createAbortScope(): {
  signal: AbortSignal;
  abort: () => void;
  dispose: () => void;
} {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    dispose: () => controller.abort(),
  };
}
