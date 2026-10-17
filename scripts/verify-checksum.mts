/**
 * Kiểm thử hàm băm SHA-256 dùng để xác minh toàn vẹn ảnh gốc.
 *
 * So sánh kết quả của hai đường đi:
 *   1. Cài đặt SHA-256 chạy theo luồng của Cloudé (băm được tệp vài trăm MB mà
 *      không cần nạp toàn bộ vào bộ nhớ).
 *   2. Web Crypto của runtime (crypto.subtle.digest) — nguồn tham chiếu độc lập.
 *
 * Chạy:  npm run verify:checksum
 */
import { sha256Blob, sha256Text } from "../src/lib/checksum.ts";

const VECTORS: { label: string; input: string; expected: string }[] = [
  {
    label: "chuỗi rỗng",
    input: "",
    expected: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  },
  {
    label: '"abc"',
    input: "abc",
    expected: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  },
  {
    label: "448-bit (kiểm tra đệm khối)",
    input: "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    expected: "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  },
];

const MILLION_A =
  "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0";

let failures = 0;

for (const vector of VECTORS) {
  const actual = await sha256Text(vector.input);
  const pass = actual === vector.expected;
  if (!pass) failures += 1;
  console.log(`${pass ? "✓" : "✗"} ${vector.label}`);
  if (!pass) console.log(`   mong đợi ${vector.expected}\n   nhận được ${actual}`);
}

// 1 triệu ký tự "a" — vượt qua nhiều lần đệm khối.
const million = await sha256Blob(new Blob(["a".repeat(1_000_000)]));
if (million === MILLION_A) {
  console.log("✓ 1.000.000 ký tự 'a' (nhiều khối + đệm)");
} else {
  failures += 1;
  console.log(`✗ 1.000.000 ký tự 'a': ${million}`);
}

// So sánh đường đi theo luồng với Web Crypto trên tệp "ảnh" giả 12MB.
const size = 12 * 1024 * 1024 + 777;
const bytes = new Uint8Array(size);
let value = 42;
for (let i = 0; i < size; i += 1) {
  value = (value * 1103515245 + 12345) & 0x7fffffff;
  bytes[i] = value % 251;
}
const blob = new Blob([bytes]);
const streamed = await sha256Blob(blob, (fraction) => {
  if (fraction === 1) console.log("  (đã băm xong theo luồng)");
});
const reference = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");
const streamingPass = streamed === reference;
if (!streamingPass) failures += 1;
console.log(
  `${streamingPass ? "✓" : "✗"} Tệp 12MB: đường đi theo luồng khớp Web Crypto (${streamed.slice(0, 16)}…)`,
);

if (failures > 0) {
  console.error(`\n✗ ${failures} kiểm tra thất bại.`);
  process.exit(1);
}
console.log("\n✓ Tất cả kiểm tra checksum đều đạt.");
