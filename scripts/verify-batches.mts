/**
 * Kiểm thử hàm chia đợt ảnh cho share sheet (`planPhotoBatches`).
 *
 * Vì sao cần: đây là phần dễ sai nhất của luồng lưu vào Thư viện ảnh trên iOS,
 * và cũng là phần KHÔNG thể kiểm thử trên máy tính — không có thiết bị iOS nào
 * ở đây để mở share sheet thật. Bù lại, logic chia đợt là hàm thuần, nên nếu
 * nó đúng thì phần còn lại chỉ là gọi API hệ thống.
 *
 * Ba tính chất phải luôn đúng, vì vi phạm chúng nghĩa là MẤT ẢNH của người dùng:
 *   1. Không ảnh nào bị bỏ sót.
 *   2. Không ảnh nào xuất hiện hai lần.
 *   3. Thứ tự ảnh được giữ nguyên.
 *
 * Chạy:  npm run verify:batches
 */
import type { Photo } from "../src/types/index.ts";
import {
  planPhotoBatches,
  PHOTO_BATCH_MAX_BYTES,
  PHOTO_BATCH_MAX_FILES,
} from "../src/lib/photoBatches.ts";

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
  return Array.from({ length: count }, (_, index) => photo(index, bytesEach));
}

/** Ba tính chất an toàn, kiểm tra trên mọi bộ dữ liệu thử. */
function checkInvariants(label: string, photos: Photo[]): void {
  const batches = planPhotoBatches(photos);
  const flattened = batches.flatMap((batch) => batch.photos);

  check(
    `${label}: không bỏ sót ảnh nào`,
    flattened.length === photos.length,
    `mong đợi ${photos.length}, nhận ${flattened.length}`,
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
    `${label}: byte của đợt khớp tổng ảnh trong đợt`,
    batches.every(
      (batch) => batch.bytes === batch.photos.reduce((sum, item) => sum + item.fileSize, 0),
    ),
  );
}

console.log("\nChia đợt ảnh cho share sheet\n");

console.log("Trường hợp cơ bản:");
check("danh sách rỗng → 0 đợt", planPhotoBatches([]).length === 0);
check("1 ảnh → 1 đợt", planPhotoBatches(makePhotos(1, 1024)).length === 1);
check("3 ảnh nhỏ → gộp 1 đợt", planPhotoBatches(makePhotos(3, 1024)).length === 1);

console.log("\nGiới hạn số tệp:");
{
  const exact = planPhotoBatches(makePhotos(PHOTO_BATCH_MAX_FILES, 1024));
  check(
    `đúng ${PHOTO_BATCH_MAX_FILES} ảnh → 1 đợt (không tách sớm)`,
    exact.length === 1,
    `nhận ${exact.length}`,
  );
  const over = planPhotoBatches(makePhotos(PHOTO_BATCH_MAX_FILES + 1, 1024));
  check(
    `${PHOTO_BATCH_MAX_FILES + 1} ảnh → 2 đợt`,
    over.length === 2 && over[0].photos.length === PHOTO_BATCH_MAX_FILES,
    `nhận ${over.length} đợt`,
  );
}

console.log("\nGiới hạn dung lượng:");
{
  // 4 ảnh × 40MB, trần 120MB → đợt 1 vừa đúng 3 ảnh (120MB), ảnh thứ 4 sang đợt 2.
  const chunk = 40 * 1024 * 1024;
  const batches = planPhotoBatches(makePhotos(4, chunk));
  check("ảnh lớn bị tách theo byte, không chỉ theo số tệp", batches.length === 2);
  check("đợt đầu dừng ở đúng trần 120MB", batches[0]?.bytes === 120 * 1024 * 1024);
  check(
    "không đợt nào vượt trần byte khi mọi ảnh đều nhỏ hơn trần",
    batches.every((batch) => batch.bytes <= PHOTO_BATCH_MAX_BYTES),
  );
}

console.log("\nẢnh đơn lẻ lớn hơn cả trần (RAW):");
{
  const huge = 200 * 1024 * 1024;
  const batches = planPhotoBatches([photo(0, huge), photo(1, 1024)]);
  check("ảnh khổng lồ vẫn được giữ, không bị bỏ", batches.flatMap((b) => b.photos).length === 2);
  check("ảnh khổng lồ nằm riêng một đợt", batches[0]?.photos.length === 1);
  check("đợt chứa ảnh khổng lồ phản ánh đúng dung lượng", batches[0]?.bytes === huge);
}

console.log("\nGhi đè tuỳ chọn:");
{
  const tiny = planPhotoBatches(makePhotos(10, 1024), { maxFiles: 2 });
  check("maxFiles = 2 → 5 đợt", tiny.length === 5, `nhận ${tiny.length}`);
  const clamped = planPhotoBatches(makePhotos(3, 1024), { maxFiles: 0, maxBytes: 0 });
  check("giá trị 0 được kẹp về 1 (không chia vô hạn)", clamped.length === 3);
}

console.log("\nDữ liệu thực tế:");
{
  const album = makePhotos(250, 5 * 1024 * 1024);
  const batches = planPhotoBatches(album);
  check("250 ảnh × 5MB → 32 đợt", batches.length === 32, `nhận ${batches.length}`);
  check(
    "không đợt nào vượt 120MB",
    batches.every((batch) => batch.bytes <= PHOTO_BATCH_MAX_BYTES),
  );
  checkInvariants("album 250 ảnh", album);
}

console.log("\nTính bất biến (không mất, không lặp, đúng thứ tự):");
checkInvariants("rỗng", []);
checkInvariants("một phần tử", makePhotos(1, 1024));
checkInvariants("lệch đúng một đợt", makePhotos(PHOTO_BATCH_MAX_FILES + 3, 1024));
checkInvariants("trộn kích thước", [photo(0, 1024), photo(1, 200 * 1024 * 1024), photo(2, 1024)]);
checkInvariants("fileSize 0 (metadata thiếu)", makePhotos(20, 0));

console.log(`\n${failed === 0 ? "✓" : "✗"} ${passed} kiểm tra đạt, ${failed} thất bại.\n`);
process.exit(failed === 0 ? 0 : 1);
