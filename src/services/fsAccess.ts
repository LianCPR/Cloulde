import { supportsFileSystemAccess } from "@/lib/capabilities";
import type { OriginalSource } from "./originalSource";

/**
 * Lớp bọc mỏng quanh File System Access API.
 *
 * Dùng kiểu cấu trúc (structural types) thay vì khai báo ambient để không xung
 * đột với `lib.dom` và để code chạy được cả khi trình duyệt không hỗ trợ API này.
 *
 * Điểm quan trọng: ghi theo LUỒNG. Ảnh 60MB được chuyển thẳng từ mạng xuống đĩa
 * theo từng khối 4MB, không bao giờ nằm trọn trong bộ nhớ.
 */

export interface WritableLike {
  write(chunk: unknown): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

export interface FileHandleLike {
  createWritable(options?: { keepExistingData?: boolean }): Promise<WritableLike>;
  getFile(): Promise<File>;
}

export interface DirectoryHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry?(name: string, options?: { recursive?: boolean }): Promise<void>;
}

interface PickerWindow {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: string;
  }) => Promise<DirectoryHandleLike>;
}

export function canPickDirectory(): boolean {
  return supportsFileSystemAccess();
}

/**
 * Thư mục quen thuộc mà `startIn` chấp nhận (theo chuẩn File System Access).
 * Đường dẫn thật do trình duyệt/hệ điều hành quyết định.
 */
export type WellKnownDirectory =
  | "desktop"
  | "documents"
  | "downloads"
  | "music"
  | "pictures"
  | "videos";

/**
 * Mở hộp thoại chọn thư mục của hệ điều hành.
 * PHẢI được gọi trực tiếp trong một thao tác của người dùng (click).
 * Trả về `null` nếu người dùng bấm huỷ hoặc trình duyệt không hỗ trợ.
 *
 * `startIn` mở sẵn tại Desktop (màn hình chính) — nơi dễ tìm thấy ảnh nhất sau
 * khi lưu. Lưu ý: khi `id` đã được dùng trước đó, Chrome ghi nhớ thư mục người
 * dùng chọn lần trước và ưu tiên nó hơn `startIn`; đó là hành vi mong muốn, vì
 * người quay lại nên được đưa về chính thư mục họ đã dùng.
 */
export async function pickDirectory(
  startIn: WellKnownDirectory = "desktop",
): Promise<DirectoryHandleLike | null> {
  const picker = (window as unknown as PickerWindow).showDirectoryPicker;
  if (typeof picker !== "function") return null;
  try {
    return await picker({ id: "cloude-downloads", mode: "readwrite", startIn });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

/** Tên tệp chưa tồn tại trong thư mục đích — không bao giờ ghi đè tệp cũ. */
export async function resolveFreeFilename(
  directory: DirectoryHandleLike,
  desiredName: string,
  taken: Set<string>,
): Promise<string> {
  const candidate = (name: string) =>
    !taken.has(name.toLowerCase()) && name.length > 0;

  let name = desiredName;
  if (candidate(name)) {
    // Kiểm tra thêm trên đĩa: tệp có thể đã tồn tại từ lần tải trước.
    try {
      await directory.getFileHandle(name, { create: false });
    } catch {
      taken.add(name.toLowerCase());
      return name;
    }
  }

  const dot = desiredName.lastIndexOf(".");
  const base = dot > 0 ? desiredName.slice(0, dot) : desiredName;
  const ext = dot > 0 ? desiredName.slice(dot) : "";
  for (let index = 2; index < 10_000; index += 1) {
    name = `${base} (${index})${ext}`;
    if (taken.has(name.toLowerCase())) continue;
    try {
      await directory.getFileHandle(name, { create: false });
    } catch {
      taken.add(name.toLowerCase());
      return name;
    }
  }
  throw new Error("Không tìm được tên tệp trống trong thư mục đích.");
}

export interface WriteStreamResult {
  filename: string;
  bytes: number;
}

/**
 * Ghi một ảnh GỐC vào thư mục đích theo luồng, báo tiến độ theo byte.
 * Không ghi đè: tên tệp được đổi thành "tên (2).ext" nếu đã tồn tại.
 */
export async function writeStreamToDirectory(
  directory: DirectoryHandleLike,
  filename: string,
  source: OriginalSource,
  taken: Set<string>,
  onBytes: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<WriteStreamResult> {
  const finalName = await resolveFreeFilename(directory, filename, taken);
  const handle = await directory.getFileHandle(finalName, { create: true });
  const writable = await handle.createWritable();
  let written = 0;

  try {
    const stream = await source.stream();
    const reader = stream.getReader();
    for (;;) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        throw new DOMException("Đã huỷ", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      await writable.write(value as unknown as BufferSource);
      written += value.byteLength;
      onBytes(written);
    }
    await writable.close();
  } catch (error) {
    await writable.abort?.(error).catch(() => undefined);
    // Không để lại tệp dở dang mang tên chính thức trong thư mục người dùng.
    await directory.removeEntry?.(finalName).catch(() => undefined);
    throw error;
  }

  return { filename: finalName, bytes: written };
}
