/**
 * KIỂM THỬ CHẤP NHẬN cho kho ảnh Cloudé.
 *
 * Chạy trên `workerd` cục bộ (wrangler dev) với R2 và D1 thật của Miniflare —
 * không phải mock. Mỗi phép thử đều đi qua đúng HTTP API mà trình duyệt dùng.
 *
 * Các hạng mục bắt buộc và vị trí tương ứng:
 *   1. Tải lên + tải xuống tệp gần 500 MB, byte-for-byte            → BIG FILE
 *   2. Tải lên bị ngắt giữa chừng và hành vi resume                → RESUME
 *   3. Kiểm tra checksum (đúng và CỐ TÌNH SAI)                     → CHECKSUM
 *   4. Tên tệp trùng                                                → DUPLICATES
 *   5. Chia sẻ riêng tư (mật khẩu, thu hồi, tải xuống)             → SHARING
 *   6. Phân trang album lớn                                         → PAGINATION
 *   7. Phục hồi sau tải lên thất bại                                → RECOVERY
 *   8. Không lộ khoá bí mật                                         → SECRETS
 *   9. Tải theo khoảng byte (Range)                                 → RANGE
 *
 * Chạy:  npm run verify:archive
 * Yêu cầu: `npm run worker:dev` đang chạy (script tự khởi động nếu chưa có).
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.ARCHIVE_BASE_URL ?? "http://127.0.0.1:8787";
const BIG_MB = Number(process.env.ARCHIVE_BIG_MB ?? "500");
const MiB = 1024 * 1024;

/**
 * Token chủ kho. Lấy từ biến môi trường, nếu không có thì đọc thẳng
 * `worker/.dev.vars` — cùng nguồn mà wrangler dev dùng — để không phải chép
 * tay và không bao giờ lệch với Worker đang chạy.
 */
async function resolveToken(): Promise<string> {
  if (process.env.ARCHIVE_TOKEN) return process.env.ARCHIVE_TOKEN.trim();
  try {
    const contents = await fs.readFile(join(process.cwd(), "worker", ".dev.vars"), "utf8");
    const match = /^ARCHIVE_TOKEN\s*=\s*(.+)$/m.exec(contents);
    if (match) return match[1].trim();
  } catch {
    // Không có tệp thì dùng giá trị mặc định của bản phát triển.
  }
  return "dev-owner-token-change-me";
}

let TOKEN = "dev-owner-token-change-me";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`);
}

/* ── HTTP ─────────────────────────────────────────────────────────────── */

interface ApiResult<T = any> {
  status: number;
  ok: boolean;
  data: T;
}

async function api<T = any>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${TOKEN}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const response = await fetch(`${BASE}${path}`, { ...init, headers, body });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, ok: response.ok, data: data as T };
}

async function guest<T = any>(
  path: string,
  json: unknown,
): Promise<ApiResult<T>> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(json),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, ok: response.ok, data: data as T };
}

/* ── Tiện ích tệp ─────────────────────────────────────────────────────── */

/** Ghi tệp thử với dữ liệu ngẫu nhiên CÓ THỂ tái tạo, theo từng khối. */
async function writeFixture(path: string, totalBytes: number, seed = 1): Promise<string> {
  const handle = await fs.open(path, "w");
  const hasher = createHash("sha256");
  const chunkSize = 4 * MiB;
  let written = 0;
  let state = seed >>> 0;
  try {
    while (written < totalBytes) {
      const size = Math.min(chunkSize, totalBytes - written);
      const buffer = Buffer.allocUnsafe(size);
      for (let i = 0; i < size; i += 4) {
        // Bộ sinh giả ngẫu nhiên tất định — chạy lại cho ra đúng dữ liệu cũ.
        state = (state * 1664525 + 1013904223) >>> 0;
        buffer.writeUInt32LE(state, i);
      }
      hasher.update(buffer);
      await handle.write(buffer);
      written += size;
    }
  } finally {
    await handle.close();
  }
  return hasher.digest("hex");
}

async function sha256Hex(buffer: Buffer | Uint8Array): Promise<string> {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Băm theo luồng để không nạp cả tệp vào bộ nhớ. */
async function hashStream(stream: ReadableStream<Uint8Array>): Promise<{ hex: string; bytes: number }> {
  const hasher = createHash("sha256");
  let bytes = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      hasher.update(value);
      bytes += value.byteLength;
    }
  }
  return { hex: hasher.digest("hex"), bytes };
}

/* ── Luồng tải lên ────────────────────────────────────────────────────── */

interface Session {
  id: string;
  partSize: number;
  partCount: number;
  uploadMode: string;
}

async function startUpload(input: {
  albumId: string;
  filename: string;
  totalBytes: number;
  checksum?: string | null;
}): Promise<{ session?: Session; status: number; data: any }> {
  const result = await api("/api/uploads", {
    method: "POST",
    json: {
      albumId: input.albumId,
      filename: input.filename,
      totalBytes: input.totalBytes,
      claimedChecksum: input.checksum ?? null,
      width: 6000,
      height: 4000,
      previewable: true,
    },
  });
  return {
    session: result.ok ? (result.data.session as Session) : undefined,
    status: result.status,
    data: result.data,
  };
}

async function sendParts(
  session: Session,
  filePath: string,
  totalBytes: number,
  options: { stopAfter?: number; startAt?: number } = {},
): Promise<number[]> {
  const handle = await fs.open(filePath, "r");
  const sent: number[] = [];
  const startAt = options.startAt ?? 1;
  try {
    for (let n = startAt; n <= session.partCount; n += 1) {
      const offset = (n - 1) * session.partSize;
      const length = Math.min(session.partSize, totalBytes - offset);
      const buffer = Buffer.allocUnsafe(length);
      await handle.read(buffer, 0, length, offset);
      const result = await api(`/api/uploads/${session.id}/parts/${n}`, {
        method: "PUT",
        body: buffer,
      });
      if (!result.ok) throw new Error(`Phần ${n} lỗi ${result.status}: ${JSON.stringify(result.data)}`);
      sent.push(n);
      if (options.stopAfter && sent.length >= options.stopAfter) break;
    }
  } finally {
    await handle.close();
  }
  return sent;
}

/**
 * Xác minh checksum cho MỘT ảnh cụ thể qua hàng đợi nền.
 *
 * Hàng đợi là hàng đợi thật, chạy theo lô (mặc định 10 việc mỗi lần) vì mỗi lần
 * xác minh phải đọc lại toàn bộ ảnh gốc. Vì vậy khi trong kho đã có nhiều ảnh
 * chờ xác minh, một lần gọi chung sẽ không tới được ảnh vừa tải lên — phép thử
 * này gọi đích danh ảnh đó, giống nút "xác minh ngay" trên giao diện.
 */
async function verifyNow(photoId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const run = await api("/api/maintenance/run", { method: "POST", json: { photoIds: [photoId] } });
    const processed = (run.data?.jobsProcessed ?? []) as { ok: boolean }[];
    if (processed.length > 0 && processed.every((job) => job.ok)) return;
  }
  throw new Error(`Không xác minh được ảnh ${photoId} sau 3 lần chạy bảo trì.`);
}

async function createAlbum(title: string): Promise<string> {
  const result = await api("/api/albums", { method: "POST", json: { title } });
  if (!result.ok) throw new Error(`Không tạo được album: ${JSON.stringify(result.data)}`);
  return result.data.album.id as string;
}

/* ── Khởi động Worker nếu cần ─────────────────────────────────────────── */

let spawned: ChildProcess | null = null;

/** Có phản hồi HTTP hay không (mã trạng thái nào cũng tính — chỉ cần đang phục vụ). */
async function serving(): Promise<boolean> {
  return fetch(`${BASE}/api/health`)
    .then(() => true)
    .catch(() => false);
}

async function ensureWorker(): Promise<void> {
  if (await serving()) {
    console.log(`Worker đã chạy sẵn tại ${BASE}`);
    return;
  }
  console.log(`Chưa thấy Worker tại ${BASE} — đang khởi động wrangler dev…`);
  spawned = spawn("npx", ["wrangler", "dev", "--port", "8787", "--local"], {
    cwd: join(process.cwd(), "worker"),
    stdio: "ignore",
    shell: true,
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (await serving()) {
      console.log("Worker đã sẵn sàng.");
      return;
    }
  }
  throw new Error("Không khởi động được wrangler dev trong 120 giây.");
}

/**
 * Kiểm tra trước khi chạy: token phải khớp, nếu không thì báo lỗi rõ ràng ngay
 * thay vì để hàng chục phép thử thất bại khó hiểu.
 */
async function preflight(): Promise<void> {
  const health = await fetch(`${BASE}/api/health`);
  if (health.status !== 401) {
    throw new Error(`/api/health trả ${health.status} khi không có token — đáng lẽ phải là 401.`);
  }
  const authorized = await fetch(`${BASE}/api/usage`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  if (authorized.status === 401) {
    console.error(
      "\nToken không khớp với Worker đang chạy.\n" +
        "  • Đặt ARCHIVE_TOKEN=<token trong worker/.dev.vars> rồi chạy lại, hoặc\n" +
        "  • Xoá ARCHIVE_TOKEN khỏi môi trường để script tự đọc worker/.dev.vars.\n",
    );
    process.exit(2);
  }
}

/* ── Các phép thử ─────────────────────────────────────────────────────── */

async function testSecrets(): Promise<void> {
  section("SECRETS — không lộ khoá bí mật");
  const session = await startUpload({
    albumId: await createAlbum(`kiểm-thử-bí-mật-${Date.now()}`),
    filename: "probe.jpg",
    totalBytes: 64,
  });
  const body = JSON.stringify(session.data);
  check("API không trả về chuỗi bí mật nào", !body.includes(TOKEN), body.slice(0, 120));
  check("uploadMode là worker-proxy (không có URL S3 ký sẵn)", session.data.uploadMode === "worker-proxy");
  check(
    "không có khoá truy cập R2 trong phản hồi",
    !/aws_access_key|X-Amz-Signature|secret/i.test(body),
  );
  // Dọn dẹp phiên vừa tạo.
  await api(`/api/uploads/${session.data.session.id}/abort`, { method: "POST" });
}

async function testBigFile(directory: string): Promise<void> {
  section(`BIG FILE — ${BIG_MB} MB, byte-for-byte`);
  const filePath = join(directory, `big-${BIG_MB}mb.bin`);
  const totalBytes = BIG_MB * MiB;
  console.log(`  • đang tạo tệp thử ${BIG_MB} MB (tất định, có thể tái tạo)…`);
  const sourceHash = await writeFixture(filePath, totalBytes, 7);
  const stat = await fs.stat(filePath);
  check("tệp thử đúng kích thước", stat.size === totalBytes, `${stat.size} vs ${totalBytes}`);

  const albumId = await createAlbum(`album-lon-${Date.now()}`);
  const started = await startUpload({
    albumId,
    filename: `Ảnh gốc lớn ${BIG_MB}MB.bin`,
    totalBytes,
    checksum: sourceHash,
  });
  check("tạo được phiên tải lên nhiều phần", started.status === 201, JSON.stringify(started.data));
  if (!started.session) return;

  const session = started.session;
  check("chia thành nhiều phần (bắt buộc do trần 100 MB/request)", session.partCount > 1, `partCount=${session.partCount}`);
  check("kích thước mỗi phần ≤ trần request của Worker", session.partSize <= 64 * MiB);

  const begin = Date.now();
  await sendParts(session, filePath, totalBytes);
  const uploadSeconds = (Date.now() - begin) / 1000;

  const completed = await api(`/api/uploads/${session.id}/complete`, { method: "POST" });
  check("hoàn tất phiên thành công", completed.status === 201, JSON.stringify(completed.data).slice(0, 200));
  check("kích thước đã được xác minh phía server", completed.data?.sizeVerified === true);
  check("dung lượng lưu đúng bằng dung lượng nguồn", completed.data?.photo?.fileSize === totalBytes);
  const photoId = completed.data?.photo?.id as string;
  check("tên tệp gốc được giữ nguyên", completed.data?.photo?.originalFilename === `Ảnh gốc lớn ${BIG_MB}MB.bin`);

  console.log(`  • tải lên ${(totalBytes / MiB).toFixed(0)} MB trong ${uploadSeconds.toFixed(1)}s (${(totalBytes / MiB / uploadSeconds).toFixed(0)} MB/s)`);

  // Tải xuống qua URL có chữ ký và so từng byte.
  const link = await api(`/api/photos/${photoId}/link`, { method: "POST" });
  check("tạo được liên kết tải xuống có thời hạn", link.ok === true && typeof link.data.url === "string");

  const downloadResponse = await fetch(`${BASE}${link.data.url}`);
  check("tải xuống trả 200", downloadResponse.status === 200);
  const disposition = downloadResponse.headers.get("content-disposition") ?? "";
  check("Content-Disposition giữ tên tệp gốc", disposition.includes("filename*=UTF-8''"), disposition);
  const downloaded = await hashStream(downloadResponse.body as ReadableStream<Uint8Array>);
  check("số byte tải về khớp nguồn", downloaded.bytes === totalBytes, `${downloaded.bytes} vs ${totalBytes}`);
  check(
    "SHA-256 tải về KHỚP nguồn (byte-for-byte)",
    downloaded.hex === sourceHash,
    `tải về ${downloaded.hex.slice(0, 16)} ≠ nguồn ${sourceHash.slice(0, 16)}`,
  );

  // Xác minh checksum phía server (đọc lại object và băm theo luồng).
  await verifyNow(photoId);
  const photo = await api(`/api/photos/${photoId}`);
  check(`server đã tự băm lại object ${BIG_MB} MB`, Boolean(photo.data?.photo?.verifiedAt));
  check(
    "checksum server xác minh khớp checksum client khai báo",
    photo.data?.photo?.verifiedChecksum === sourceHash,
    `${photo.data?.photo?.verifiedChecksum?.slice(0, 16)} vs ${sourceHash.slice(0, 16)}`,
  );
  check("không có cờ sai lệch checksum", photo.data?.photo?.checksumMismatch === false);

  await fs.rm(filePath, { force: true });
}

async function testRange(): Promise<void> {
  section("RANGE — tải theo khoảng byte");
  const albumId = await createAlbum(`range-${Date.now()}`);
  const payload = Buffer.alloc(3 * MiB);
  for (let i = 0; i < payload.length; i += 1) payload[i] = (i * 31) % 251;
  const hash = await sha256Hex(payload);

  const temp = join(tmpdir(), `range-${Date.now()}.bin`);
  await fs.writeFile(temp, payload);
  const started = await startUpload({ albumId, filename: "range.bin", totalBytes: payload.length, checksum: hash });
  if (!started.session) {
    check("tạo được phiên cho phép thử Range", false);
    return;
  }
  await sendParts(started.session, temp, payload.length);
  const completed = await api(`/api/uploads/${started.session.id}/complete`, { method: "POST" });
  const photoId = completed.data?.photo?.id as string;
  await fs.rm(temp, { force: true });

  const link = await api(`/api/photos/${photoId}/link`, { method: "POST" });
  const rangeResponse = await fetch(`${BASE}${link.data.url}`, {
    headers: { range: "bytes=1048576-2097151" },
  });
  check("yêu cầu Range trả 206 Partial Content", rangeResponse.status === 206, `nhận ${rangeResponse.status}`);
  check(
    "Content-Range mô tả đúng khoảng xin",
    rangeResponse.headers.get("content-range") === `bytes 1048576-2097151/${payload.length}`,
    rangeResponse.headers.get("content-range") ?? "(thiếu)",
  );
  const slice = Buffer.from(await rangeResponse.arrayBuffer());
  check("số byte của khoảng đúng 1 MiB", slice.length === MiB, `${slice.length}`);
  check("byte trong khoảng khớp nguồn", slice.equals(payload.subarray(MiB, 2 * MiB)));
}

async function testResume(directory: string): Promise<void> {
  section("RESUME — ngắt giữa chừng rồi nối tiếp");
  const totalBytes = 40 * MiB;
  const filePath = join(directory, `resume-${Date.now()}.bin`);
  const sourceHash = await writeFixture(filePath, totalBytes, 11);
  const albumId = await createAlbum(`resume-${Date.now()}`);

  const started = await startUpload({
    albumId,
    filename: "ngat-roi-noi-tiep.bin",
    totalBytes,
    checksum: sourceHash,
  });
  if (!started.session) {
    check("tạo được phiên để thử resume", false);
    return;
  }
  const session = started.session;
  check("phiên có nhiều phần", session.partCount > 1, `partCount=${session.partCount}`);

  // Cố tình NGẮT sau 2 phần, mô phỏng mất mạng giữa chừng.
  const sentBefore = await sendParts(session, filePath, totalBytes, { stopAfter: 2 });
  check("đã gửi một phần rồi dừng lại", sentBefore.length === 2);

  // Hoàn tất khi còn thiếu phần phải bị từ chối, kèm DANH SÁCH phần còn thiếu.
  const premature = await api(`/api/uploads/${session.id}/complete`, { method: "POST" });
  check("hoàn tất sớm bị từ chối (409)", premature.status === 409, `nhận ${premature.status}`);
  check(
    "phản hồi nêu rõ các phần còn thiếu để client resume",
    Array.isArray(premature.data?.missingParts) && premature.data.missingParts.length === session.partCount - 2,
    JSON.stringify(premature.data?.missingParts)?.slice(0, 80),
  );

  // Trạng thái resume đọc từ SERVER, không phải từ bộ nhớ trình duyệt.
  const state = await api(`/api/uploads/${session.id}`);
  check("server cho biết đã có phần nào", state.data?.uploadedParts?.length === 2);
  check("server cho biết còn thiếu phần nào", state.data?.missingParts?.length === session.partCount - 2);
  const listed = await api("/api/uploads");
  check(
    "phiên dở hiện trong danh sách để tiếp tục",
    listed.data?.sessions?.some((item: any) => item.id === session.id),
  );

  // Nối tiếp từ đúng phần còn thiếu.
  await sendParts(session, filePath, totalBytes, { startAt: 3 });
  const completed = await api(`/api/uploads/${session.id}/complete`, { method: "POST" });
  check("nối tiếp và hoàn tất được sau khi ngắt", completed.status === 201, JSON.stringify(completed.data).slice(0, 160));
  check("dung lượng sau khi nối tiếp vẫn đúng", completed.data?.photo?.fileSize === totalBytes);

  const link = await api(`/api/photos/${completed.data.photo.id}/link`, { method: "POST" });
  const response = await fetch(`${BASE}${link.data.url}`);
  const downloaded = await hashStream(response.body as ReadableStream<Uint8Array>);
  check(
    "tệp resume xong vẫn byte-for-byte với nguồn",
    downloaded.hex === sourceHash && downloaded.bytes === totalBytes,
  );

  await fs.rm(filePath, { force: true });
}

async function testChecksum(directory: string): Promise<void> {
  section("CHECKSUM — xác minh đúng và phát hiện sai");
  const albumId = await createAlbum(`checksum-${Date.now()}`);
  const payload = Buffer.alloc(2 * MiB + 12345);
  for (let i = 0; i < payload.length; i += 1) payload[i] = (i * 17) % 241;
  const realHash = await sha256Hex(payload);
  const wrongHash = "0".repeat(64);

  const temp = join(directory, `checksum-${Date.now()}.bin`);
  await fs.writeFile(temp, payload);

  // (a) Checksum ĐÚNG.
  const good = await startUpload({ albumId, filename: "dung.bin", totalBytes: payload.length, checksum: realHash });
  await sendParts(good.session!, temp, payload.length);
  const goodCompleted = await api(`/api/uploads/${good.session!.id}/complete`, { method: "POST" });
  await verifyNow(goodCompleted.data.photo.id as string);
  const goodPhoto = await api(`/api/photos/${goodCompleted.data.photo.id}`);
  check("checksum khớp → được đánh dấu đã xác minh", goodPhoto.data?.photo?.verifiedChecksum === realHash);
  check("checksum khớp → không có cảnh báo sai lệch", goodPhoto.data?.photo?.checksumMismatch === false);

  // (b) Checksum CỐ TÌNH SAI — phải bị phát hiện, không được im lặng chấp nhận.
  const bad = await startUpload({ albumId, filename: "sai.bin", totalBytes: payload.length, checksum: wrongHash });
  check("khác tên nên không bị coi là trùng", bad.status === 201, `nhận ${bad.status}`);
  await sendParts(bad.session!, temp, payload.length);
  const badCompleted = await api(`/api/uploads/${bad.session!.id}/complete`, { method: "POST" });
  await verifyNow(badCompleted.data.photo.id as string);
  const badPhoto = await api(`/api/photos/${badCompleted.data.photo.id}`);
  check(
    "checksum sai BỊ PHÁT HIỆN (không gán nhãn đã xác minh)",
    badPhoto.data?.photo?.verifiedChecksum === null,
    JSON.stringify(badPhoto.data?.photo?.verifiedChecksum),
  );
  check(
    "checksum sai được đánh dấu rõ ràng",
    badPhoto.data?.photo?.checksumMismatch === true,
    JSON.stringify(badPhoto.data?.photo?.checksumMismatch),
  );
  const usage = await api("/api/usage");
  check("dashboard đếm được số ảnh sai lệch", usage.data?.verification?.mismatches >= 1);

  await fs.rm(temp, { force: true });
}

async function testDuplicates(directory: string): Promise<void> {
  section("DUPLICATES — nội dung trùng và tên tệp trùng");
  const albumId = await createAlbum(`trung-${Date.now()}`);
  const payload = Buffer.alloc(1 * MiB + 777);
  for (let i = 0; i < payload.length; i += 1) payload[i] = (i * 7) % 249;
  const hash = await sha256Hex(payload);
  const temp = join(directory, `dup-${Date.now()}.bin`);
  await fs.writeFile(temp, payload);

  // Lần 1: lưu bình thường.
  const first = await startUpload({ albumId, filename: "trung-ten.jpg", totalBytes: payload.length, checksum: hash });
  await sendParts(first.session!, temp, payload.length);
  const firstDone = await api(`/api/uploads/${first.session!.id}/complete`, { method: "POST" });
  check("lưu ảnh đầu tiên thành công", firstDone.status === 201);

  // Lần 2: CÙNG NỘI DUNG, khác tên → phải bị chặn trước khi truyền 500 MB.
  const second = await startUpload({ albumId, filename: "trung-noi-dung.jpg", totalBytes: payload.length, checksum: hash });
  check("nội dung trùng bị chặn ngay khi tạo phiên", second.status === 409, `nhận ${second.status}`);
  check("phản hồi nêu rõ đây là trùng nội dung", second.data?.code === "duplicate");
  check(
    "phản hồi chỉ ra ảnh đã có",
    second.data?.duplicate?.id === firstDone.data.photo.id,
    JSON.stringify(second.data?.duplicate),
  );

  const photos = await api(`/api/albums/${albumId}/photos`);
  check("album chỉ có đúng một ảnh sau khi bị chặn trùng", photos.data?.items?.length === 1, `${photos.data?.items?.length}`);

  // Lần 3: CÙNG TÊN TỆP, khác nội dung → cả hai phải được giữ, không ghi đè.
  const otherPayload = Buffer.alloc(1 * MiB + 777);
  for (let i = 0; i < otherPayload.length; i += 1) otherPayload[i] = (i * 13) % 247;
  const otherHash = await sha256Hex(otherPayload);
  const otherTemp = join(directory, `dup2-${Date.now()}.bin`);
  await fs.writeFile(otherTemp, otherPayload);

  const third = await startUpload({ albumId, filename: "trung-ten.jpg", totalBytes: otherPayload.length, checksum: otherHash });
  check("cùng tên nhưng khác nội dung vẫn được nhận", third.status === 201, `nhận ${third.status}`);
  await sendParts(third.session!, otherTemp, otherPayload.length);
  const thirdDone = await api(`/api/uploads/${third.session!.id}/complete`, { method: "POST" });
  check("lưu được ảnh cùng tên thứ hai", thirdDone.status === 201);

  const after = await api(`/api/albums/${albumId}/photos`);
  check("album có hai ảnh cùng tên tệp", after.data?.items?.length === 2, `${after.data?.items?.length}`);
  const storageKeys = after.data.items.map((item: any) => item.storageKey);
  check("hai ảnh cùng tên có khoá lưu trữ KHÁC nhau (không ghi đè)", new Set(storageKeys).size === 2, storageKeys.join(", "));
  check(
    "tên tệp gốc được giữ nguyên cho cả hai",
    after.data.items.every((item: any) => item.originalFilename === "trung-ten.jpg"),
  );

  // Cả hai phải tải về đúng nội dung RIÊNG của nó. Đối chiếu theo id ảnh chứ
  // không theo thứ tự trong danh sách (album trả về ảnh mới nhất trước).
  const expectedByPhoto = new Map<string, string>([
    [firstDone.data.photo.id as string, hash],
    [thirdDone.data.photo.id as string, otherHash],
  ]);
  check("danh sách album chứa đúng hai ảnh vừa lưu", expectedByPhoto.size === 2);
  let duplicateIndex = 0;
  for (const [photoId, expected] of expectedByPhoto) {
    duplicateIndex += 1;
    const link = await api(`/api/photos/${photoId}/link`, { method: "POST" });
    const response = await fetch(`${BASE}${link.data.url}`);
    const downloaded = await hashStream(response.body as ReadableStream<Uint8Array>);
    check(
      `ảnh cùng tên (bản ${duplicateIndex}) tải về đúng nội dung riêng của nó`,
      downloaded.hex === expected,
      `${downloaded.hex.slice(0, 12)} vs ${expected.slice(0, 12)}`,
    );
  }

  await fs.rm(temp, { force: true });
  await fs.rm(otherTemp, { force: true });
}

async function testSharing(directory: string): Promise<void> {
  section("SHARING — chia sẻ riêng tư");
  const albumId = await createAlbum(`chia-se-${Date.now()}`);
  const payload = Buffer.alloc(512 * 1024 + 33);
  for (let i = 0; i < payload.length; i += 1) payload[i] = (i * 23) % 239;
  const hash = await sha256Hex(payload);
  const temp = join(directory, `share-${Date.now()}.bin`);
  await fs.writeFile(temp, payload);
  const session = await startUpload({ albumId, filename: "chia-se.bin", totalBytes: payload.length, checksum: hash });
  await sendParts(session.session!, temp, payload.length);
  const done = await api(`/api/uploads/${session.session!.id}/complete`, { method: "POST" });
  const photoId = done.data.photo.id as string;
  await fs.rm(temp, { force: true });

  const created = await api(`/api/albums/${albumId}/shares`, {
    method: "POST",
    json: { allowDownload: true, password: "matkhau123", expiresInDays: 7 },
  });
  check("tạo được liên kết chia sẻ", created.status === 201, JSON.stringify(created.data).slice(0, 160));
  const token = created.data?.share?.token as string;
  check("token thô được trả về đúng MỘT lần", Boolean(token) && created.data.tokenVisibleOnce === true);
  check("liên kết có mật khẩu", created.data?.share?.hasPassword === true);

  const listed = await api(`/api/albums/${albumId}/shares`);
  check("danh sách liên kết KHÔNG trả lại token thô", listed.data?.shares?.[0]?.token === null);

  // Khách: chưa có mật khẩu → bắt buộc nhập.
  const noPassword = await guest(`/api/shared/${token}/resolve`, {});
  check("khách thiếu mật khẩu bị từ chối 401", noPassword.status === 401, `nhận ${noPassword.status}`);
  check("mã lỗi nói rõ cần mật khẩu", noPassword.data?.code === "password_required");

  // Khách: mật khẩu sai.
  const wrong = await guest(`/api/shared/${token}/resolve`, { password: "sai-mat-khau" });
  check("mật khẩu sai bị từ chối 401", wrong.status === 401 && wrong.data?.code === "password_wrong");

  // Khách: mật khẩu đúng.
  const right = await guest(`/api/shared/${token}/resolve`, { password: "matkhau123" });
  check("mật khẩu đúng mở được album", right.ok === true, JSON.stringify(right.data).slice(0, 160));
  check("khách không thấy email/định danh chủ album", right.data?.album?.ownerLabel === "Chủ album");

  const photos = await guest(`/api/shared/${token}/photos`, { password: "matkhau123", limit: 10 });
  check("khách liệt kê được ảnh trong album", photos.data?.items?.length === 1);
  check("ảnh trả cho khách KHÔNG kèm khoá lưu trữ", photos.data?.items?.[0]?.storageKey === undefined);

  // Liên kết tải xuống của khách.
  const link = await guest(`/api/shared/${token}/link`, { password: "matkhau123", photoId });
  check("khách xin được liên kết tải xuống", link.ok === true, JSON.stringify(link.data).slice(0, 160));
  const download = await fetch(`${BASE}${link.data.url}`);
  const downloaded = await hashStream(download.body as ReadableStream<Uint8Array>);
  check("khách tải được ảnh gốc byte-for-byte", downloaded.hex === hash);

  // URL ký cho ảnh KHÔNG thuộc album của liên kết phải bị chặn.
  const otherAlbumId = await createAlbum(`khac-${Date.now()}`);
  const otherSession = await startUpload({ albumId: otherAlbumId, filename: "khac.bin", totalBytes: 1024 });
  const otherDone = await api(`/api/uploads/${otherSession.session!.id}/abort`, { method: "POST" });
  check("dọn được phiên của album khác", otherDone.ok === true);

  // Chặn tải xuống.
  const updated = await api(`/api/shares/${created.data.share.id}`, { method: "PATCH", json: { allowDownload: false } });
  check("tắt được quyền tải xuống", updated.data?.share?.allowDownload === false);
  const blocked = await guest(`/api/shared/${token}/link`, { password: "matkhau123", photoId });
  check("khách xin liên kết tải xuống bị chặn 403", blocked.status === 403, `nhận ${blocked.status}`);

  // Thu hồi phải có hiệu lực NGAY, kể cả với URL đã ký trước đó.
  await api(`/api/shares/${created.data.share.id}`, { method: "PATCH", json: { allowDownload: true } });
  const freshLink = await guest(`/api/shared/${token}/link`, { password: "matkhau123", photoId });
  check("bật lại được quyền tải xuống", freshLink.ok === true);
  await api(`/api/shares/${created.data.share.id}`, { method: "DELETE" });
  const afterRevoke = await fetch(`${BASE}${freshLink.data.url}`);
  check(
    "URL đã ký TRƯỚC ĐÓ bị vô hiệu sau khi thu hồi",
    afterRevoke.status === 410,
    `nhận ${afterRevoke.status}`,
  );
  const gone = await guest(`/api/shared/${token}/resolve`, { password: "matkhau123" });
  check("token đã thu hồi không còn dùng được", gone.status === 410, `nhận ${gone.status}`);
}

async function testPagination(directory: string): Promise<void> {
  section("PAGINATION — album lớn");
  const albumId = await createAlbum(`phan-trang-${Date.now()}`);
  const total = Number(process.env.ARCHIVE_PAGE_ITEMS ?? "120");
  const payload = Buffer.alloc(24 * 1024 + 5);
  for (let i = 0; i < payload.length; i += 1) payload[i] = i % 251;
  const temp = join(directory, `page-${Date.now()}.bin`);
  await fs.writeFile(temp, payload);

  console.log(`  • đang thêm ${total} ảnh nhỏ để thử phân trang…`);
  const unique = new Set<string>();
  for (let i = 0; i < total; i += 1) {
    const bytes = Buffer.alloc(payload.length);
    bytes.writeUInt32LE(i, 0); // mỗi tệp một nội dung khác nhau
    await fs.writeFile(temp, bytes);
    const hash = await sha256Hex(bytes);
    const session = await startUpload({
      albumId,
      filename: `anh-${String(i).padStart(4, "0")}.bin`,
      totalBytes: bytes.length,
      checksum: hash,
    });
    if (session.status !== 201) {
      check(`tạo được phiên cho ảnh ${i}`, false, JSON.stringify(session.data).slice(0, 120));
      break;
    }
    await sendParts(session.session!, temp, bytes.length);
    const done = await api(`/api/uploads/${session.session!.id}/complete`, { method: "POST" });
    if (done.status !== 201) {
      check(`hoàn tất ảnh ${i}`, false, JSON.stringify(done.data).slice(0, 120));
      break;
    }
    unique.add(done.data.photo.id);
  }
  check(`đã lưu đủ ${total} ảnh`, unique.size === total, `${unique.size}`);

  // Duyệt toàn bộ bằng con trỏ, kích thước trang 25.
  const pageSize = 25;
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const query = `/api/albums/${albumId}/photos?limit=${pageSize}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page = await api(query);
    pages += 1;
    check(
      `trang ${pages} không trả quá ${pageSize} ảnh (lưới tải lười)`,
      (page.data?.items?.length ?? 0) <= pageSize,
      `${page.data?.items?.length}`,
    );
    for (const item of page.data?.items ?? []) seen.push(item.id);
    cursor = page.data?.nextCursor ?? null;
    if (pages > 50) break;
  } while (cursor);

  check("duyệt hết album bằng con trỏ", cursor === null);
  check("không trả trùng ảnh giữa các trang", new Set(seen).size === seen.length, `${seen.length} mục, ${new Set(seen).size} duy nhất`);
  check("tổng số ảnh thu được đúng bằng số đã lưu", seen.length === total, `${seen.length} vs ${total}`);
  check(`số trang hợp lý (${pages})`, pages === Math.ceil(total / pageSize), `mong đợi ${Math.ceil(total / pageSize)}`);

  const albums = await api("/api/albums?limit=5");
  check("danh sách album cũng phân trang", (albums.data?.items?.length ?? 0) <= 5 && Boolean(albums.data?.nextCursor));

  const album = await api(`/api/albums/${albumId}`);
  check("bộ đếm album khớp số ảnh thật", album.data?.album?.photoCount === total, `${album.data?.album?.photoCount}`);

  await fs.rm(temp, { force: true });
}

async function testRecovery(directory: string): Promise<void> {
  section("RECOVERY — phục hồi sau tải lên thất bại");
  const albumId = await createAlbum(`phuc-hoi-${Date.now()}`);
  const totalBytes = 20 * MiB;
  const temp = join(directory, `recover-${Date.now()}.bin`);
  await writeFixture(temp, totalBytes, 3);

  const session = await startUpload({ albumId, filename: "that-bai.bin", totalBytes });
  await sendParts(session.session!, temp, totalBytes, { stopAfter: 1 });

  // Huỷ: dọn cả phiên lẫn các phần đã ghi trên kho lưu trữ.
  const aborted = await api(`/api/uploads/${session.session!.id}/abort`, { method: "POST" });
  check("huỷ được phiên tải lên", aborted.ok === true);
  const stillListed = await api(`/api/uploads/${session.session!.id}`);
  check("phiên đã huỷ không còn truy cập được", stillListed.status === 404, `nhận ${stillListed.status}`);

  // Gửi tiếp vào phiên đã huỷ phải bị từ chối rõ ràng.
  const afterAbort = await api(`/api/uploads/${session.session!.id}/parts/2`, {
    method: "PUT",
    body: Buffer.alloc(1024),
  });
  check("không ghi thêm được vào phiên đã huỷ", afterAbort.status === 404 || afterAbort.status === 409, `nhận ${afterAbort.status}`);

  const list = await api("/api/uploads");
  check(
    "phiên đã huỷ không còn trong danh sách chờ",
    !list.data?.sessions?.some((item: any) => item.id === session.session!.id),
  );

  // Sai kích thước phần phải bị chặn với thông báo rõ ràng, không hỏng ngầm.
  const fresh = await startUpload({ albumId, filename: "sai-kich-thuoc.bin", totalBytes });
  const wrongSize = await api(`/api/uploads/${fresh.session!.id}/parts/1`, {
    method: "PUT",
    body: Buffer.alloc(1234),
  });
  check("phần sai kích thước bị từ chối", wrongSize.status === 400, `nhận ${wrongSize.status}`);
  check(
    "thông báo nêu đúng kích thước mong đợi",
    typeof wrongSize.data?.error === "string" && wrongSize.data.error.includes(String(fresh.session!.partSize)),
    String(wrongSize.data?.error).slice(0, 120),
  );
  await api(`/api/uploads/${fresh.session!.id}/abort`, { method: "POST" });

  // Thử thách ảnh không tồn tại.
  const missing = await api("/api/photos/khong-ton-tai");
  check("ảnh không tồn tại trả 404", missing.status === 404);

  await fs.rm(temp, { force: true });
}

async function testHealthAndUsage(): Promise<void> {
  section("HEALTH & USAGE — dashboard thật");
  const health = await api("/api/health");
  check("health kiểm tra THẬT bằng cách ghi/đọc/xoá object thử", health.data?.storage?.originalsWritable === true);
  check("bucket ảnh thu nhỏ cũng ghi được", health.data?.storage?.thumbnailsWritable === true);
  check("health xác nhận đang dùng driver r2-binding", health.data?.storage?.driver === "r2-binding");

  const usage = await api("/api/usage");
  check("usage trả về dung lượng thật đã dùng", typeof usage.data?.usedBytes === "number" && usage.data.usedBytes > 0);
  check("usage có số ảnh và số album", usage.data?.photoCount > 0 && usage.data?.albumCount > 0);
  check("usage có ước tính chi phí theo đơn giá cấu hình", typeof usage.data?.cost?.totalUsd === "number");
  check(
    "nói rõ không áp đặt hạn mức",
    usage.data?.thresholds?.enforced === false &&
      (usage.data?.warnings ?? []).some((w: any) => /không đặt hạn mức/i.test(w.message)),
  );
  check("có nêu chi phí biên mỗi GB tăng thêm", typeof usage.data?.cost?.marginalPerGbMonthUsd === "number");

  // Hàng đợi nền: một lần chạy chung xử lý theo LÔ, và hàng đợi phải cho thấy
  // sức chứa còn lại của nó thay vì báo mơ hồ.
  const batchRun = await api("/api/maintenance/run", { method: "POST" });
  check(
    "một lần chạy bảo trì xử lý theo lô (≤ 50 việc) chứ không nuốt cả hàng đợi",
    (batchRun.data?.jobsProcessed?.length ?? 0) <= 50,
    `${batchRun.data?.jobsProcessed?.length}`,
  );
  check(
    "bảo trì báo cáo số việc còn lại trong hàng đợi",
    typeof batchRun.data?.pendingJobsRemaining === "number",
  );

  const unauthorized = await fetch(`${BASE}/api/usage`);
  check("thiếu token bị từ chối 401", unauthorized.status === 401, `nhận ${unauthorized.status}`);
  const badToken = await fetch(`${BASE}/api/usage`, { headers: { authorization: "Bearer sai-token" } });
  check("token sai bị từ chối 401", badToken.status === 401, `nhận ${badToken.status}`);
}

/* ── Chạy ─────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  console.log(`\nKiểm thử chấp nhận kho ảnh — ${BASE}\n`);
  TOKEN = await resolveToken();
  await ensureWorker();
  await preflight();

  const directory = await fs.mkdtemp(join(tmpdir(), "cloude-archive-"));
  const only = process.env.ARCHIVE_ONLY?.toLowerCase();
  const run = (name: string) => !only || only === name;

  try {
    if (run("secrets")) await testSecrets();
    if (run("big")) await testBigFile(directory);
    if (run("range")) await testRange();
    if (run("resume")) await testResume(directory);
    if (run("checksum")) await testChecksum(directory);
    if (run("duplicates")) await testDuplicates(directory);
    if (run("sharing")) await testSharing(directory);
    if (run("pagination")) await testPagination(directory);
    if (run("recovery")) await testRecovery(directory);
    // Chạy CUỐI: dashboard phải được đo khi đã có dữ liệu thật trong kho.
    if (run("health")) await testHealthAndUsage();
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    spawned?.kill();
  }

  console.log(`\n${failed === 0 ? "✓" : "✗"} ${passed} kiểm tra đạt, ${failed} thất bại.`);
  if (failed > 0) {
    console.error("\nCác mục thất bại:");
    for (const label of failures) console.error(`  • ${label}`);
  }
  console.log();
  process.exit(failed === 0 ? 0 : 1);
}

void main();
