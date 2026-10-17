/**
 * Bộ ghi ZIP chạy theo luồng, dùng phương thức STORE (không nén).
 *
 * Vì sao STORE: ảnh JPEG/PNG/HEIC/RAW đã được nén sẵn, nén lại chỉ tốn CPU và
 * có nguy cơ sai lệch. Phương thức STORE ghi NGUYÊN BYTE của tệp gốc vào ZIP —
 * đúng yêu cầu "không sửa đổi byte ảnh".
 *
 * Vì sao tự viết thay vì JSZip cho mọi trường hợp:
 *   - Có thể ghi trực tiếp ra tệp OPFS trên đĩa, nên album vài GB không bị nạp
 *     hết vào bộ nhớ (JSZip chỉ làm việc trong RAM).
 *   - JSZip vẫn được dùng làm phương án dự phòng khi trình duyệt không có OPFS.
 */

// Đường dẫn tương đối kèm phần mở rộng (không dùng alias @) để tệp này có thể
// được kiểm thử trực tiếp bằng Node trong scripts/verify-zip.mts.
import { supportsOpfs } from "../../lib/capabilities.ts";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array, seed = 0): number {
  let crc = (seed ^ -1) >>> 0;
  for (let i = 0; i < data.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

interface CentralEntry {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  dosTime: number;
  dosDate: number;
  flags: number;
}

function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

interface OpfsWritable {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

interface OpfsRoot {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<unknown>;
  removeEntry(name: string): Promise<void>;
}

/** Nơi nhận dữ liệu: tệp OPFS (ưu tiên) hoặc bộ nhớ (dự phòng). */
interface Sink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<Blob>;
  bytesWritten(): number;
}

async function createSink(): Promise<{ sink: Sink; backing: "opfs" | "memory" }> {
  if (supportsOpfs()) {
    try {
      const root = (await navigator.storage.getDirectory()) as unknown as OpfsRoot;
      const name = `cloude-archive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`;
      const handle = (await root.getFileHandle(name, { create: true })) as unknown as {
        createWritable: () => Promise<OpfsWritable>;
        getFile: () => Promise<File>;
      };
      const writable = await handle.createWritable();
      let written = 0;
      return {
        backing: "opfs",
        sink: {
          async write(chunk) {
            await writable.write(chunk);
            written += chunk.byteLength;
          },
          async close() {
            await writable.close();
            // File lấy từ OPFS được đọc trực tiếp từ đĩa khi tải xuống, nên
            // Blob trả về là tệp có thật trên đĩa chứ không phải vùng nhớ tạm.
            const file = await handle.getFile();
            await root.removeEntry(name).catch(() => undefined);
            return file;
          },
          bytesWritten: () => written,
        },
      };
    } catch {
      // Trình duyệt riêng tư hoặc thiếu quyền → rơi xuống bộ nhớ.
    }
  }

  const chunks: Uint8Array[] = [];
  let written = 0;
  return {
    backing: "memory",
    sink: {
      async write(chunk) {
        chunks.push(chunk);
        written += chunk.byteLength;
      },
      async close() {
        return new Blob(chunks as BlobPart[], { type: "application/zip" });
      },
      bytesWritten: () => written,
    },
  };
}

export interface ZipEntryInput {
  /** Tên hiển thị trong ZIP, ví dụ "Album/IMG_1234.HEIC". */
  path: string;
  /** Kích thước byte (đã biết trước). */
  size: number;
  /** Nguồn dữ liệu nguyên byte. */
  stream: () => Promise<ReadableStream<Uint8Array>>;
}

export interface ZipProgress {
  filesAdded: number;
  totalFiles: number;
  bytesWritten: number;
  currentEntry: string | null;
}

export interface ZipResult {
  blob: Blob;
  bytes: number;
  /** "opfs" hoặc "memory" — dùng để thông báo và chẩn đoán. */
  backing: "opfs" | "memory";
}

export interface ZipWriterOptions {
  maxBytes: number;
  maxFiles: number;
  onProgress?: (progress: ZipProgress) => void;
  signal?: AbortSignal;
}

/**
 * Ghi ZIP theo luồng. Không bao giờ nạp toàn bộ album vào bộ nhớ khi OPFS có sẵn.
 */
export async function writeZipStream(
  entries: ZipEntryInput[],
  options: ZipWriterOptions,
): Promise<ZipResult> {
  if (entries.length > options.maxFiles) {
    throw new Error(
      `Gói ZIP giới hạn ${options.maxFiles} tệp mỗi lần. Album này có ${entries.length} tệp.`,
    );
  }
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (totalBytes > options.maxBytes) {
    throw new Error(
      `Tổng dung lượng ${Math.round(totalBytes / 1024 / 1024)}MB vượt giới hạn ZIP phía trình duyệt. Hãy chọn tải theo thư mục hoặc chia nhỏ album.`,
    );
  }

  const { sink, backing } = await createSink();
  const central: CentralEntry[] = [];
  let offset = 0;
  let bytesWritten = 0;

  const push = async (chunk: Uint8Array) => {
    await sink.write(chunk);
    offset += chunk.byteLength;
    bytesWritten += chunk.byteLength;
  };

  const { dosTime, dosDate } = toDosDateTime(new Date());

  try {
    for (const entry of entries) {
      if (options.signal?.aborted) throw new DOMException("Đã huỷ", "AbortError");

      const nameBytes = new TextEncoder().encode(entry.path);
      // Cờ 0x0800: tên tệp mã hoá UTF-8 (cần cho tên có dấu tiếng Việt).
      const flags = 0x0800;

      const header = new Uint8Array(30 + nameBytes.length);
      const headerView = new DataView(header.buffer);
      headerView.setUint32(0, 0x04034b50, true); // local file header
      headerView.setUint16(4, 20, true); // version needed
      headerView.setUint16(6, flags, true);
      headerView.setUint16(8, 0, true); // method 0 = store
      headerView.setUint16(10, dosTime, true);
      headerView.setUint16(12, dosDate, true);
      // CRC và kích thước chưa biết tại thời điểm này; ta quay lại điền sau
      // bằng cách giữ vị trí, nhưng vì STORE nên ta biết chính xác độ dài.
      headerView.setUint32(14, 0, true);
      headerView.setUint32(18, entry.size, true);
      headerView.setUint32(22, entry.size, true);
      headerView.setUint16(26, nameBytes.length, true);
      headerView.setUint16(28, 0, true);
      header.set(nameBytes, 30);

      const entryOffset = offset;
      await push(header);

      // Ghi dữ liệu theo từng khối, tính CRC song song — bộ nhớ không đổi.
      const stream = await entry.stream();
      const reader = stream.getReader();
      let crc = crc32(new Uint8Array(0));
      let entryBytes = 0;
      for (;;) {
        if (options.signal?.aborted) {
          await reader.cancel().catch(() => undefined);
          throw new DOMException("Đã huỷ", "AbortError");
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        crc = crc32(value, crc);
        entryBytes += value.byteLength;
        await push(value);
        options.onProgress?.({
          filesAdded: central.length,
          totalFiles: entries.length,
          bytesWritten,
          currentEntry: entry.path,
        });
      }

      if (entryBytes !== entry.size) {
        throw new Error(
          `Kích thước tệp "${entry.path}" không khớp (mong đợi ${entry.size} byte, nhận ${entryBytes}). Gói ZIP đã bị huỷ để không tạo tệp thiếu dữ liệu.`,
        );
      }

      central.push({
        nameBytes,
        crc,
        size: entryBytes,
        offset: entryOffset,
        dosTime,
        dosDate,
        flags,
      });
      options.onProgress?.({
        filesAdded: central.length,
        totalFiles: entries.length,
        bytesWritten,
        currentEntry: entry.path,
      });
    }

    // Central directory
    const centralStart = offset;
    for (const entry of central) {
      const record = new Uint8Array(46 + entry.nameBytes.length);
      const view = new DataView(record.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true); // version made by
      view.setUint16(6, 20, true); // version needed
      view.setUint16(8, entry.flags, true);
      view.setUint16(10, 0, true); // store
      view.setUint16(12, entry.dosTime, true);
      view.setUint16(14, entry.dosDate, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.nameBytes.length, true);
      view.setUint16(30, 0, true); // extra
      view.setUint16(32, 0, true); // comment
      view.setUint16(34, 0, true); // disk
      view.setUint16(36, 0, true); // internal attrs
      view.setUint32(38, 0, true); // external attrs
      view.setUint32(42, entry.offset, true);
      record.set(entry.nameBytes, 46);
      await push(record);
    }
    const centralSize = offset - centralStart;

    // End of central directory
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(4, 0, true);
    eocdView.setUint16(6, 0, true);
    eocdView.setUint16(8, central.length, true);
    eocdView.setUint16(10, central.length, true);
    eocdView.setUint32(12, centralSize, true);
    eocdView.setUint32(16, centralStart, true);
    eocdView.setUint16(20, 0, true);
    await push(eocd);

    const blob = await sink.close();
    return { blob, bytes: sink.bytesWritten(), backing };
  } catch (error) {
    await sink.close().catch(() => undefined);
    throw error;
  }
}

/** Tên tệp ZIP an toàn từ tên album. */
export function zipFilenameFor(albumTitle: string): string {
  const base = (albumTitle || "cloude-album")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-zA-Z0-9 _-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base || "cloude-album"}-${stamp}.zip`;
}
