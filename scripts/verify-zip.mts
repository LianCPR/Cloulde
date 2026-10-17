/**
 * Kiểm thử bộ ghi ZIP của Cloudé bằng một thư viện ZIP độc lập (JSZip).
 *
 * Mục tiêu: chứng minh rằng ảnh gốc được đóng gói NGUYÊN BYTE, tên tệp giữ
 * nguyên (kể cả tiếng Việt có dấu), và archive đọc được bằng phần mềm khác.
 *
 * Chạy:  npm run verify:zip
 */
import JSZip from "jszip";
import { writeZipStream, zipFilenameFor, type ZipEntryInput } from "../src/services/archive/zipWriter.ts";

function makeBinary(size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let value = seed;
  for (let i = 0; i < size; i += 1) {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    bytes[i] = value % 251;
  }
  return bytes;
}

const files: { name: string; bytes: Uint8Array; contentType: string }[] = [
  // Tệp nhỏ, tên có dấu tiếng Việt và khoảng trắng.
  { name: "Đà Lạt 01 — sương sớm.jpg", bytes: makeBinary(46_698, 7), contentType: "image/jpeg" },
  // Tệp "ảnh lớn" 8MB để kiểm tra ghi theo nhiều khối.
  { name: "Đồi thông chiều (bản gốc).jpg", bytes: makeBinary(8 * 1024 * 1024 + 12345, 99), contentType: "image/jpeg" },
  // Định dạng không nén được, giữ nguyên byte.
  { name: "Ảnh chụp thô RAW.DNG", bytes: makeBinary(2_056, 3), contentType: "image/x-adobe-dng" },
];

const entries: ZipEntryInput[] = files.map((file) => ({
  path: `Đà Lạt — sương sớm 2026/${file.name}`,
  size: file.bytes.byteLength,
  async stream() {
    // Cố tình trả về luồng theo từng khối 64KB, giống dữ liệu đến từ mạng.
    let offset = 0;
    const chunkSize = 64 * 1024;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= file.bytes.byteLength) {
          controller.close();
          return;
        }
        const end = Math.min(offset + chunkSize, file.bytes.byteLength);
        controller.enqueue(file.bytes.subarray(offset, end));
        offset = end;
      },
    });
  },
}));

const events: string[] = [];
const result = await writeZipStream(entries, {
  maxBytes: 64 * 1024 * 1024,
  maxFiles: 100,
  onProgress: (progress) => {
    if (progress.filesAdded > events.length && progress.filesAdded <= entries.length) {
      events.push(`${progress.filesAdded}/${progress.totalFiles} → ${progress.currentEntry}`);
    }
  },
});

const zipBytes = new Uint8Array(await result.blob.arrayBuffer());
console.log(`Đã tạo ZIP: ${zipBytes.byteLength} byte (bộ nhớ đệm: ${result.backing})`);
console.log("Sự kiện tiến độ:", events.join(" | "));

const archive = await JSZip.loadAsync(zipBytes);
const names = Object.keys(archive.files).filter((name) => !archive.files[name].dir);
console.log("Tệp trong ZIP:", names.length);
for (const name of names) console.log("  •", name);

let failures = 0;

// 1. Đủ tệp, đúng thư mục, đúng tên có dấu.
if (names.length !== files.length) {
  console.error(`✗ Số tệp không khớp: mong đợi ${files.length}, nhận ${names.length}`);
  failures += 1;
}

for (const file of files) {
  const expectedPath = `Đà Lạt — sương sớm 2026/${file.name}`;
  const entry = archive.file(expectedPath);
  if (!entry) {
    console.error(`✗ Thiếu tệp trong ZIP: ${expectedPath}`);
    failures += 1;
    continue;
  }
  const extracted = new Uint8Array(await entry.async("uint8array"));

  // 2. Kích thước và từng byte phải giống hệt bản gốc.
  if (extracted.byteLength !== file.bytes.byteLength) {
    console.error(
      `✗ ${file.name}: kích thước sai (${extracted.byteLength} vs ${file.bytes.byteLength})`,
    );
    failures += 1;
    continue;
  }
  let mismatch = -1;
  for (let i = 0; i < extracted.byteLength; i += 1) {
    if (extracted[i] !== file.bytes[i]) {
      mismatch = i;
      break;
    }
  }
  if (mismatch >= 0) {
    console.error(`✗ ${file.name}: byte thứ ${mismatch} khác bản gốc`);
    failures += 1;
    continue;
  }
  console.log(`✓ ${file.name}: ${file.bytes.byteLength} byte, giống hệt bản gốc`);
}

// 3. Không nén: tổng dung lượng ZIP phải xấp xỉ tổng dữ liệu + phần đầu mục.
const totalBytes = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
const overhead = zipBytes.byteLength - totalBytes;
if (overhead > 4096) {
  console.error(`✗ Phần đầu mục ZIP quá lớn (${overhead} byte) — có thể đã nén dữ liệu`);
  failures += 1;
} else {
  console.log(`✓ Phương thức STORE (không nén): phần đầu mục chỉ ${overhead} byte`);
}

// 4. Vượt giới hạn phải bị chặn kèm thông báo rõ ràng.
try {
  await writeZipStream(entries, { maxBytes: 1024, maxFiles: 100 });
  console.error("✗ Đã cho phép tạo ZIP vượt giới hạn dung lượng");
  failures += 1;
} catch (error) {
  console.log(`✓ Chặn ZIP vượt giới hạn: ${(error as Error).message.slice(0, 80)}…`);
}

try {
  await writeZipStream(entries, { maxBytes: 64 * 1024 * 1024, maxFiles: 2 });
  console.error("✗ Đã cho phép tạo ZIP vượt giới hạn số tệp");
  failures += 1;
} catch (error) {
  console.log(`✓ Chặn ZIP vượt giới hạn số tệp: ${(error as Error).message.slice(0, 80)}…`);
}

// 5. Luồng bị huỷ giữa chừng phải dừng ngay và không trả về tệp thiếu dữ liệu.
const controller = new AbortController();
controller.abort();
try {
  await writeZipStream(entries, {
    maxBytes: 64 * 1024 * 1024,
    maxFiles: 100,
    signal: controller.signal,
  });
  console.error("✗ ZIP vẫn hoàn tất dù đã bị huỷ");
  failures += 1;
} catch (error) {
  console.log(`✓ Huỷ giữa chừng: ${(error as Error).name}`);
}

console.log(`\nTên tệp ZIP đề xuất: ${zipFilenameFor("Đà Lạt — sương sớm 2026")}`);

if (failures > 0) {
  console.error(`\n✗ ${failures} kiểm tra thất bại.`);
  process.exit(1);
}
console.log("\n✓ Tất cả kiểm tra ZIP đều đạt: ảnh gốc được giữ nguyên byte.");
