
/**
 * Kiểm thử hàm chia đợt ảnh cho share sheet.
 *
 * Mục tiêu:
 * 1. Không bỏ sót ảnh.
 * 2. Không lặp ảnh.
 * 3. Giữ nguyên thứ tự.
 * 4. Danh sách không rỗng được gom vào một đợt duy nhất,
 *    không giới hạn số ảnh hoặc tổng dung lượng tại bước chia đợt.
 *
 * Chạy: npm run verify:batches
 */
import type { Photo } from "../src/types/index.ts";
import { planPhotoBatches } from "../src/lib/photoBatches.ts";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function photo(index: number, bytes: number): Photo {
  return {
    id: `p${index}`,
    albumId: "a1",
    ownerId: "u1",
    originalFilename: `Ảnh ${index}.jpg`,
    storagePath: `u1/a1/p${index}.jpg`,
    thumbnailPath: null,
    mimeType: "image/jpeg",
    fileSize: bytes,
    width: 4000,
    height: 3000,
    checksum: null,
    previewable: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function makePhotos(count: number, bytesEach: number): Photo[] {
  return Array.from({ length: count }, (_, index) =>
    photo(index, bytesEach),
  );
}

function checkInvariants(label: string, photos: Photo[]): void {
  const batches = planPhotoBatches(photos);
  const flattened = batches.flatMap((batch) => batch.photos);

  check(
    `${label}: không bỏ sót ảnh`,
    flattened.length === photos.length,
  );

  check(
    `${label}: không lặp ảnh`,
    new Set(flattened.map((item) => item.id)).size === flattened.length,
  );

  check(
    `${label}: giữ nguyên thứ tự`,
    flattened.every((item, index) => item.id === photos[index]?.id),
  );

  check(
    `${label}: không có đợt rỗng`,
    batches.every((batch) => batch.photos.length > 0),
  );

  check(
    `${label}: tổng byte chính xác`,
    batches.every(
      (batch) =>
        batch.bytes ===
        batch.photos.reduce(
          (sum, item) => sum + Math.max(0, item.fileSize || 0),
          0,
        ),
    ),
  );
}

console.log("\nKiểm thử chia đợt ảnh cho share sheet\n");

console.log("Trường hợp cơ bản:");
check("danh sách rỗng → 0 đợt", planPhotoBatches([]).length === 0);
check("1 ảnh → 1 đợt", planPhotoBatches(makePhotos(1, 1024)).length === 1);
check("3 ảnh → 1 đợt", planPhotoBatches(makePhotos(3, 1024)).length === 1);

console.log("\nKhông giới hạn số lượng ảnh:");
{
  const photos = makePhotos(250, 1024);
  const batches = planPhotoBatches(photos);

  check(
    "250 ảnh → 1 đợt",
    batches.length === 1,
    `nhận ${batches.length} đợt`,
  );

  check(
    "cả 250 ảnh nằm trong cùng đợt",
    batches[0]?.photos.length === 250,
  );
}

console.log("\nKhông giới hạn tổng dung lượng ở bước chia đợt:");
{
  const chunk = 40 * 1024 * 1024;
  const photos = makePhotos(4, chunk);
  const batches = planPhotoBatches(photos);

  check(
    "4 ảnh × 40 MiB → 1 đợt",
    batches.length === 1,
    `nhận ${batches.length} đợt`,
  );

  check(
    "tổng dung lượng đợt là 160 MiB",
    batches[0]?.bytes === 160 * 1024 * 1024,
  );
}

console.log("\nẢnh lớn:");
{
  const huge = 200 * 1024 * 1024;
  const batches = planPhotoBatches([
    photo(0, huge),
    photo(1, 1024),
  ]);

  check("ảnh lớn vẫn được giữ", batches[0]?.photos.length === 2);
  check(
    "tổng dung lượng được tính chính xác",
    batches[0]?.bytes === huge + 1024,
  );
}

console.log("\nDữ liệu album lớn:");
{
  const album = makePhotos(250, 5 * 1024 * 1024);
  const batches = planPhotoBatches(album);

  check(
    "250 ảnh × 5 MiB → 1 đợt",
    batches.length === 1,
    `nhận ${batches.length} đợt`,
  );

  check(
    "đợt chứa đủ 250 ảnh",
    batches[0]?.photos.length === 250,
  );

  checkInvariants("album 250 ảnh", album);
}

console.log("\nTính bất biến:");
checkInvariants("danh sách rỗng", []);
checkInvariants("một ảnh", makePhotos(1, 1024));
checkInvariants("nhiều ảnh", makePhotos(30, 1024));
checkInvariants(
  "ảnh kích thước hỗn hợp",
  [
    photo(0, 1024),
    photo(1, 200 * 1024 * 1024),
    photo(2, 1024),
  ],
);
checkInvariants("fileSize bằng 0", makePhotos(20, 0));

console.log(`\n${failed === 0 ? "✓" : "✗"} ${passed} kiểm tra đạt, ${failed} thất bại.\n`);
process.exit(failed === 0 ? 0 : 1);
