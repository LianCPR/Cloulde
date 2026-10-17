# Cloudé

Nền tảng web lưu trữ và chia sẻ **ảnh gốc chất lượng cao**, dành cho nhiếp ảnh gia và người dùng cá nhân.

Điểm cốt lõi: **ảnh gốc không bao giờ bị thay đổi**. Hệ thống không nén lại, không
đổi định dạng, không ghi đè màu sắc — mọi byte bạn tải lên là đúng những byte bạn tải
về, đã được kiểm chứng bằng SHA-256 và một thư viện ZIP độc lập (xem
[Kết quả kiểm thử](#kết-quả-kiểm-thử-thực-tế)).

---

## Mục lục

1. [Tính năng](#tính-năng)
2. [Kiến trúc](#kiến-trúc)
3. [Cấu trúc thư mục](#cấu-trúc-thư-mục)
4. [Yêu cầu hệ thống](#yêu-cầu-hệ-thống)
5. [Chạy nhanh (chế độ demo)](#chạy-nhanh-chế-độ-demo)
6. [Kho lưu trữ ảnh gốc lớn (Cloudflare R2)](#kho-lưu-trữ-ảnh-gốc-lớn-cloudflare-r2)
7. [Thiết lập Supabase](#thiết-lập-supabase)
8. [Biến môi trường](#biến-môi-trường)
9. [Triển khai lên web](#triển-khai-lên-web)
10. [Nguyên tắc "ảnh gốc bất biến"](#nguyên-tắc-ảnh-gốc-bất-biến)
11. [Chiến lược tải xuống theo thiết bị](#chiến-lược-tải-xuống-theo-thiết-bị)
12. [Bảo mật](#bảo-mật)
13. [Chi phí & hạn mức](#chi-phí--hạn-mức)
14. [Sao lưu & phục hồi](#sao-lưu--phục-hồi)
15. [Kết quả kiểm thử thực tế](#kết-quả-kiểm-thử-thực-tế)
16. [Khắc phục sự cố](#khắc-phục-sự-cố)
17. [Giới hạn còn lại](#giới-hạn-còn-lại)
18. [Lộ trình mở rộng](#lộ-trình-mở-rộng)

---

## Tính năng

### Lưu trữ ảnh gốc
- Tải lên **mọi định dạng ảnh**: JPEG, PNG, WebP, HEIC/HEIF, TIFF, AVIF, GIF, BMP,
  SVG, PSD và **RAW** của mọi hãng (CR2/CR3, NEF, ARW, DNG, ORF, RAF, RW2, PEF, SRW, RWL).
- Ảnh gốc được lưu **nguyên byte**, không chuyển mã. Metadata EXIF/ICC/XMP và
  profile màu được giữ nguyên.
- **Chống trùng lặp theo nội dung**: khoá `(owner_id, sha256)` ngăn cùng một tệp
  được tính dung lượng hai lần.
- Thanh tiến trình theo từng tệp, tạm dừng/tiếp tục, thử lại khi lỗi mạng.
  Hàng đợi sống sót qua việc tải lại trang.
- Kéo–thả, chọn nhiều tệp, dán từ clipboard.

### Xem & tổ chức
- Lưới ảnh có ảnh thu nhỏ, cuộn vô hạn theo con trỏ (cursor) — không dùng OFFSET nên
  vẫn nhanh khi album có hàng chục nghìn ảnh.
- Trình xem toàn màn hình: điều hướng bàn phím (←/→/Esc), thông tin chi tiết,
  nút tải ảnh gốc, xoá.
- Album: tạo, đổi tên, đặt bìa, thêm/bớt ảnh. Bìa tự động chọn ảnh **xem trước được**
  (ưu tiên JPEG/PNG/WebP/HEIC, không chọn RAW) để tránh bìa trắng.
- Tìm kiếm và sắp xếp phía máy khách, có chỉ mục.

### Tải xuống
- **Ba chiến lược, chọn theo thiết bị**:
  1. **Ghi thẳng vào thư mục** (File System Access API — Chrome/Edge desktop):
     từng ảnh gốc ghi trực tiếp xuống đĩa, không tốn RAM.
  2. **ZIP luồng (streaming)** ghi ra **OPFS** — tạo được gói hàng GB mà không
     giữ trong bộ nhớ. Định dạng **STORE (không nén)** vì ảnh đã nén sẵn; nhờ vậy
     dữ liệu trong ZIP **giống hệt** bản gốc (kiểm chứng byte-for-byte).
  3. **Lưu vào Thư viện ảnh (iOS)** — hỏi trước một lần, sau đó đưa ảnh qua
     **bảng chia sẻ** theo từng đợt (tối đa 8 ảnh hoặc 120MB mỗi đợt) để bạn chọn
     *Lưu vào Ảnh*. **Tải từng ảnh** vẫn là phương án dự phòng.
- **Màn hình hướng dẫn trước khi lưu trên máy tính**: ưu tiên ghi thẳng vào
  **Desktop** (hộp thoại chọn thư mục mở sẵn tại đó); nếu chọn ZIP thì có hướng
  dẫn giải nén riêng cho Windows và macOS.
- Tên ZIP sinh tự động, giữ dấu tiếng Việt, cấu trúc thư mục theo album.
- Cảnh báo khi gói vượt ngưỡng cấu hình; huỷ giữa chừng giải phóng tài nguyên.
- Tuỳ chọn kiểm tra SHA-256 sau khi tải (với tệp ≤ 10 MB).

### Chia sẻ
- Liên kết công khai cho album, có **thời hạn**, **mật khẩu tuỳ chọn**,
  **giới hạn số lần xem** và **quyền tải xuống** bật/tắt.
- **Mã token chỉ hiển thị một lần**; cơ sở dữ liệu **chỉ lưu SHA-256 của token** —
  rò rỉ DB không lộ liên kết.
- Khách không có tài khoản vẫn xem và tải được album được chia sẻ.
- Trang chia sẻ **yêu cầu quyền riêng tư**: `noindex`, không lộ thông tin chủ sở hữu.

### Tài khoản & vận hành
- Đăng ký, đăng nhập, quên/đặt lại mật khẩu, đăng xuất.
- Ma trận trạng thái rõ ràng: đang tải / rỗng / lỗi / hết phiên — không màn hình trắng.
- Thông báo toast, vùng `aria-live` cho trình đọc màn hình.
- **Cảnh báo dung lượng**: thanh tiến trình hiển thị mức dùng so với hạn mức
  (mặc định 100 GB hoặc giá trị bạn cấu hình).
- Điều hướng bàn phím đầy đủ, tiêu điểm được quản lý trong hộp thoại, nút đủ 44×44 px
  trên thiết bị di động.
- Song ngữ giao diện tiếng Việt, font **LHanoienne** cho tiêu đề và dấu tiếng Việt
  (có fallback sang Playfair Display cho vài glyph hiếm).

---

## Kiến trúc

```
Trình duyệt (React SPA)
        │
        ├─ Cổng dịch vụ (src/services/ports.ts)
        │     ├─ LocalBackend    → IndexedDB  (demo/offline, không cần khoá)
        │     ├─ SupabaseBackend → Postgres + Storage + Auth
        │     └─ ArchiveBackend  → Worker Cloudflare + R2 + D1  (ảnh gốc tới ~500 MB)
        │
        ├─ Supabase Edge Function `share` (Deno)
        │     → xác thực token chia sẻ, phát signed URL có thời hạn
        │
        └─ Worker Cloudflare (worker/)
              → giữ khoá R2, ghép các phần tải lên, ký URL có thời hạn,
                tự băm lại SHA-256 và chỉ lưu METADATA vào D1
```

### Chọn chế độ lưu trữ

| Chế độ | Khi nào dùng | Trần một tệp | Ảnh gốc ở đâu |
| --- | --- | --- | --- |
| `local` | Thử giao diện, không cần khoá | Hạn mức IndexedDB | Trong trình duyệt |
| `supabase` | Thư viện nhỏ, muốn dùng Auth sẵn có | 50 MB (gói Free) | Supabase Storage |
| `archive` | **Nhiếp ảnh gia, ảnh gốc tới hàng trăm MB** | ~640 GB (giới hạn R2) | Cloudflare R2 |

Chế độ `archive` được mô tả đầy đủ trong **[docs/kho-luu-tru.md](docs/kho-luu-tru.md)**
— kiến trúc, triển khai, bảo mật, chi phí, sao lưu và những gì **chưa** được
kiểm chứng.

**Cổng dịch vụ (service ports)** là quyết định kiến trúc trung tâm. Toàn bộ UI nói
chuyện với các interface trong `src/services/ports.ts`, không bao giờ gọi Supabase
trực tiếp. Nhờ vậy:

- Ứng dụng **luôn chạy được** — thiếu khoá Supabase thì tự chuyển sang backend
  IndexedDB và hiển thị hướng dẫn, không bao giờ lỗi trắng trang.
- Có thể chạy kiểm thử toàn bộ luồng tải lên/tải xuống/chia sẻ **không cần tài khoản
  cloud**, nên có thể kiểm chứng thật trong hội thoại này.
- Thay nhà cung cấp lưu trữ chỉ cần viết thêm một adapter.

**Hàng đợi tải lên** dùng trạng thái máy rõ ràng (`queued → hashing → uploading →
verifying → done/failed`), lưu vào IndexedDB để tiếp tục sau khi tải lại trang.

**Luồng tải xuống** sinh việc (job) có thể huỷ, có tiến trình theo byte và theo tệp,
và luôn thoái lui an toàn về chiến lược đơn giản hơn nếu API trình duyệt không có.

---

## Cấu trúc thư mục

```
src/
├─ app/                # Định tuyến (react-router)
├─ components/
│  ├─ albums/          # Lưới album, thẻ album, hộp thoại tạo/sửa
│  ├─ downloads/       # Hộp thoại tải xuống, thanh tiến trình
│  ├─ layout/          # AppShell, header, sidebar, điều hướng di động, AuthCard
│  ├─ photos/          # Lưới ảnh, thẻ, trình xem, thanh chọn
│  ├─ sharing/         # Hộp thoại tạo liên kết chia sẻ
│  ├─ system/          # ErrorBoundary, thông báo backend
│  └─ ui/              # Nút, hộp thoại, trường nhập, toast, skeleton, empty state, nền mây
├─ config/env.ts       # Đọc & chuẩn hoá biến môi trường
├─ context/            # AuthContext
├─ hooks/              # usePhotoFeed, useUploadQueue, useDownloadJob, useSelection, useMediaSrc, useNoIndex…
├─ lib/                # cn, format, fileTypes, checksum (SHA-256), imageMeta, search, capabilities, secret
├─ pages/              # Home, Album, Upload, SharedAlbum, Login/Signup/Reset, Settings, NotFound
├─ services/
│  ├─ archive/               # Backend kho lưu trữ: client, adapter, quy ước đường dẫn,
│  │                         #   và bộ ghi ZIP luồng (zipWriter.ts)
│  ├─ local/                 # Backend IndexedDB
│  ├─ supabase/              # Backend Supabase + tus resumable upload
│  ├─ ports.ts               # Interface backend
│  ├─ backend.ts             # Chọn backend theo cấu hình
│  ├─ uploadService.ts, downloadService.ts, photoService.ts, albumService.ts, shareService.ts
│  └─ cursor.ts              # Con trỏ phân trang (không OFFSET)
└─ types/index.ts

supabase/
├─ migrations/0001_init.sql      # Bảng, khoá, RLS, hàm bìa album
├─ migrations/0002_storage.sql   # Bucket + chính sách storage
├─ migrations/0003_share.sql     # Bảng chia sẻ + hàm truy cập ẩn danh
├─ migrations/0004_profiles.sql  # Hồ sơ + hạn mức
├─ functions/share/index.ts      # Edge function xác thực token chia sẻ
└─ seed.sql                      # Dữ liệu mẫu (tuỳ chọn)

scripts/
├─ verify-zip.mts       # Kiểm tra ZIP bằng JSZip (thư viện độc lập)
├─ verify-checksum.mts  # Kiểm tra SHA-256 theo vectơ chuẩn NIST
└─ verify-archive.mts   # Kiểm thử chấp nhận kho lưu trữ (gồm tệp 500 MB thật)

worker/                  # Backend kho lưu trữ: Worker Cloudflare (R2 + D1)
├─ src/index.ts          # Router + Cron Trigger
├─ src/config.ts         # Chia phần, đơn giá, ngưỡng CẢNH BÁO (không phải hạn mức)
├─ src/db/schema.sql     # D1 — CHỈ metadata, không có byte ảnh nào
├─ src/routes/           # uploads, albums/ảnh, chia sẻ, usage/health
├─ src/storage/          # Driver R2 qua binding (thay được bằng S3 presign)
├─ src/lib/              # Băm theo luồng, HMAC vé tải xuống, PBKDF2, HTTP
└─ scripts/cost-model.mts # Mô hình chi phí đọc từ cấu hình thật

docs/
├─ kho-luu-tru.md        # Triển khai, bảo mật, chi phí, sao lưu, giới hạn, kiểm thử
└─ trien-khai.md        # Checklist phát hành: việc trên Cloudflare + kiểm tra sau deploy
```

---

## Yêu cầu hệ thống

- **Node.js ≥ 20.19** (khuyến nghị 22 LTS). Các script kiểm tra dùng
  `node --experimental-strip-types`.
- npm ≥ 10 (dự án dùng `package-lock.json`).
- Trình duyệt hiện đại có IndexedDB. Để có đầy đủ tính năng: Chrome/Edge 122+.

---

## Chạy nhanh (chế độ demo)

Không cần tài khoản cloud. Ứng dụng chạy với backend IndexedDB cục bộ.

```bash
npm install
npm run dev
# mở http://localhost:5173
```

Đăng ký một tài khoản bất kỳ — **dữ liệu chỉ nằm trong trình duyệt của bạn**, không
được gửi đi đâu. Đây là chế độ để thử giao diện và luồng nghiệp vụ.

```bash
npm run typecheck       # kiểm tra kiểu
npm run build           # build production (tsc -b && vite build)
npm run verify:zip      # kiểm tra bộ ghi ZIP bằng thư viện độc lập
npm run verify:checksum # kiểm tra SHA-256 theo vectơ chuẩn
npm run preview         # xem trước bản build
```

---

## Kho lưu trữ ảnh gốc lớn (Cloudflare R2)

Dành cho ảnh gốc **tới gần 500 MB mỗi tệp**, hàng chục nghìn ảnh, và **không có
hạn mức dung lượng nào do ứng dụng đặt ra**. Toàn bộ chi tiết ở
[docs/kho-luu-tru.md](docs/kho-luu-tru.md); đây là điểm vào nhanh:

```bash
npm install
npm run worker:db:init    # nạp lược đồ D1 cục bộ (Miniflare)
npm run worker:dev        # Worker + R2 + D1 ở cổng 8787
npm run verify:archive    # kiểm thử chấp nhận, gồm tệp THẬT 500 MB
VITE_ARCHIVE_URL=http://127.0.0.1:8787 npm run dev   # giao diện → http://localhost:5173/connect
npm run worker:cost -- 500   # chi phí thật cho 500 GB
```

Điều bắt buộc phải hiểu trước khi dùng:

- **Vì sao có chia phần:** Cloudflare giới hạn thân request ở **100 MB** và
  *không* vượt được bằng cách stream. 500 MB vì thế bắt buộc là nhiều request —
  đổi lại có resume và chỉ gửi lại phần bị lỗi.
- **Trình duyệt không giữ khoá nhà cung cấp nào.** Worker dùng binding R2; không
  có access key/secret trong JavaScript, bundle hay localStorage.
- **Không có hạn mức dung lượng hay số ảnh.** Trần thực tế là gói Cloudflare,
  trạng thái tài khoản và ngân sách của bạn. `/usage` chỉ báo cáo và cảnh báo.
- **R2 không sao lưu hộ bạn.** Mặc định **không có** sao lưu nào; quy trình sao
  lưu và khôi phục (kèm cách kiểm thử) nằm ở mục 8 của tài liệu.
- **Chưa chạy trên R2 thật** trong hội thoại này: kiểm thử dùng R2/D1 của
  Miniflare, cùng API nhưng khác quy mô. Danh sách việc còn phải tự kiểm tra nằm
  ở cuối tài liệu.

---

## Thiết lập Supabase

Ứng dụng **không bắt buộc** phải có Supabase — thiếu khoá thì nó tự chuyển sang
backend IndexedDB và vẫn chạy đầy đủ. Phần này để dựng backend thật.

Có hai đường. Cả hai dùng chung một bộ migration, nên đổi qua lại chỉ là đổi hai
biến môi trường.

| | Đường A — project trên cloud | Đường B — Supabase chạy local |
|---|---|---|
| Cần tài khoản Supabase | có | không |
| Cần Docker Desktop | không | có, phải đang chạy |
| Dùng cho | production | phát triển, kiểm thử RLS & Edge Function |
| Nạp lược đồ | dán `supabase/setup.sql` hoặc `npm run supabase:push` | `npm run supabase:reset` |
| Chi phí | theo gói Supabase | miễn phí, chỉ tốn ổ đĩa |

Đường B chạy được **toàn bộ** RLS và Edge Function ngay trên máy, nên đây là cách
trung thực nhất để kiểm chứng hành vi bảo mật trước khi trả tiền cho hạ tầng thật.

> Supabase CLI đã nằm trong `devDependencies` của dự án, nên **không cần**
> `npm install -g supabase`. Dùng `npm run supabase:<lệnh>`, hoặc `npx supabase <lệnh>`
> cho những lệnh chưa có script (ví dụ `npx supabase db dump`).

### 1. Tạo project

**Đường A:** tạo project mới tại <https://supabase.com/dashboard> — chọn region gần
người dùng nhất, đặt mật khẩu cơ sở dữ liệu mạnh và **lưu lại**. Sau đó lấy
`Project ref` tại Project Settings → General → Reference ID (dạng `abcdefghijklmno`).

**Đường B:** bật Docker Desktop rồi chạy:

```bash
npm run supabase:start   # lần đầu tải image, mất vài phút
npm run supabase:status  # in ra API URL và anon key để điền vào .env.local
```

### 2. Nạp lược đồ

**Đường A, cách nhanh nhất (không cần cài gì):** mở Supabase → SQL Editor →
New query, dán **toàn bộ** nội dung [`supabase/setup.sql`](supabase/setup.sql) rồi bấm Run.
Tệp này đã gộp sẵn 4 migration theo đúng thứ tự và bao trong một transaction.

**Đường A, cách lặp lại được (khuyến nghị khi làm việc lâu dài):**

```bash
npm run supabase:login                              # mở trình duyệt để đăng nhập
npm run supabase:link -- --project-ref <project-ref>
npm run supabase:push
```

**Đường B:**

```bash
npm run supabase:reset   # áp dụng migration rồi nạp seed.sql
```

Bốn migration lần lượt tạo bảng, chỉ mục, chính sách RLS, bucket và hàm trợ giúp.
Mọi câu lệnh đều **idempotent** (`if not exists` / `or replace` / `drop policy if exists`),
nên chạy lại nhiều lần vẫn an toàn.

`supabase/setup.sql` là tệp **sinh tự động** từ `supabase/migrations/`. Đừng sửa tay:
sửa migration rồi chạy `npm run supabase:setup-sql`. `npm run verify:supabase` sẽ báo
lỗi (exit 1) nếu tệp bị lệch so với migration.

### 3. Xác nhận bucket đã tồn tại

`0002_storage.sql` tạo ba bucket **riêng tư**:

| Bucket | Nội dung | Ghi chú |
|---|---|---|
| `photo-originals` | ảnh gốc, không bao giờ ghi đè | khoá theo `<owner_id>/…` |
| `photo-thumbnails` | ảnh thu nhỏ do trình duyệt tạo | có thể tái tạo bất cứ lúc nào |
| `photo-archives` | gói ZIP dài hạn (tuỳ chọn) | xem [Chi phí](#chi-phí--hạn-mức) |

Tất cả bucket đều **private**. Truy cập chỉ qua signed URL có thời hạn (5 phút cho
tải xuống, 1 giờ cho xem trước), nên không có URL công khai nào bị rò rỉ.

### 4. Bật xác thực email/mật khẩu

Authentication → Providers → Email: bật, và thêm URL ứng dụng của bạn vào
**Redirect URLs** (ví dụ `https://<tên-miền>/dat-lai-mat-khau`).

### 5. Triển khai Edge Function `share`

```bash
npm run supabase:deploy
```

Chế độ `verify_jwt = false` đã được ghim sẵn trong [`supabase/config.toml`](supabase/config.toml),
nên lệnh trên **không cần** cờ `--no-verify-jwt` — và cũng không thể quên cờ đó,
vốn là cách dễ nhất để làm hỏng toàn bộ luồng chia sẻ cho khách.

Việc này là **có chủ đích**: khách chưa đăng nhập cần truy cập album được
chia sẻ. Hàm tự xác thực bằng chính token chia sẻ (băm SHA-256 rồi so khớp), kiểm tra
mật khẩu, thời hạn, số lần xem và chỉ phát signed URL sau khi tất cả điều kiện đạt.
Nó chạy bằng `service_role` nhưng **không bao giờ** trả về dữ liệu ngoài phạm vi
album được chia sẻ.

Đặt biến môi trường cho hàm (Supabase tự cung cấp `SUPABASE_URL` và
`SUPABASE_SERVICE_ROLE_KEY` trong môi trường Edge Function).

### 6. Cấu hình ứng dụng

`.env.local` đã có sẵn trong dự án (và đã được `.gitignore` bỏ qua). Hiện **mọi
dòng trong đó đều bị chú thích**, nên ứng dụng đang chạy chế độ demo. Mở tệp, bỏ
dấu `#` ở hai dòng rồi điền giá trị thật:

```bash
# Đường A (cloud) — Project Settings → API
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>

# Đường B (local) — lấy từ `npm run supabase:status`
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key>
```

Sau đó chạy `npm run dev` (hoặc `npm run build`).

`VITE_SUPABASE_ANON_KEY` là khoá công khai — an toàn khi nằm trong bundle frontend vì
mọi quyền đều do **Row Level Security** quyết định. **Không bao giờ** đặt
`service_role` key trong biến `VITE_*`.

---

## Biến môi trường

Tất cả biến frontend phải có tiền tố `VITE_`. Xem [`.env.example`](.env.example).

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `VITE_SUPABASE_URL` | — | URL project Supabase |
| `VITE_SUPABASE_ANON_KEY` | — | khoá công khai (an toàn khi công bố) |
| `VITE_BACKEND` | tự phát hiện | ép `archive`, `supabase` hoặc `local`. Khi triển khai kho R2 **phải đặt `archive`**. |
| `VITE_ARCHIVE_URL` | cùng origin | origin của Worker kho lưu trữ. **Để trống khi một Worker phục vụ cả trang web lẫn API** (khuyến nghị). Chỉ điền khi SPA nằm ở origin khác — điền sai thì liên kết chia sẻ hỏng với **mọi** khách trong khi chủ kho vẫn thấy bình thường. |
| `VITE_ORIGINALS_BUCKET` | `photo-originals` | bucket ảnh gốc |
| `VITE_THUMBNAILS_BUCKET` | `photo-thumbnails` | bucket ảnh thu nhỏ |
| `VITE_ARCHIVES_BUCKET` | `photo-archives` | bucket ZIP dài hạn |
| `VITE_MAX_UPLOAD_BYTES` | `52428800` (50 MB) | giới hạn một tệp tải lên |
| `VITE_UPLOAD_CONCURRENCY` | `3` | số tệp tải lên song song (1–8) |
| `VITE_DOWNLOAD_CONCURRENCY` | `4` | số tệp tải về song song (1–8) |
| `VITE_ZIP_WARN_BYTES` | `1073741824` (1 GB) | ngưỡng cảnh báo gói ZIP |
| `VITE_ZIP_MAX_BYTES` | `4294967296` (4 GB) | chặn cứng kích thước ZIP |
| `VITE_ZIP_MAX_FILES` | `2000` | chặn cứng số tệp trong ZIP |
| `VITE_SHARE_FUNCTION` | `share` | tên Edge Function chia sẻ |

> **Lưu ý về 50 MB**: đây là giới hạn tệp tối đa của gói Supabase **Free**. Nếu
> dùng gói Pro/Team, hãy nâng `VITE_MAX_UPLOAD_BYTES` (và giới hạn tương ứng trong
> Dashboard → Storage → Settings). Ảnh RAW thường 20–80 MB nên gói Free sẽ chặn
> nhiều tệp RAW — xem [Chi phí](#chi-phí--hạn-mức).

---

## Triển khai lên web

> **Checklist phát hành đầy đủ ở [docs/trien-khai.md](docs/trien-khai.md)** — gồm
> từng lệnh trên Cloudflare, điều kiện về gói (Workers Paid là cần thiết, xem lý do
> CPU trong tài liệu đó), các kiểm tra **sau** khi deploy, và cách khắc phục khi
> "chủ kho thấy bình thường nhưng khách mở liên kết thì hỏng".

Hai đường triển khai:

| | Một Worker phục vụ cả trang web lẫn API (khuyến nghị) | SPA trên Vercel, API trên Cloudflare |
|---|---|---|
| CORS | Không cần | **Bắt buộc** đặt `ALLOWED_ORIGINS` |
| Liên kết chia sẻ của khách | Chạy ngay | Chỉ chạy khi CORS đã đúng |
| Cấu hình | `npm run worker:deploy` | Vercel + Worker + biến lúc build |

Đường khuyến nghị: một origin, không CORS, và **không có nơi nào để cấu hình lệch
nhau** — đó chính là kiểu lỗi khiến liên kết chia sẻ hỏng với mọi khách mà chủ kho
không hề thấy. `[assets]` trong `worker/wrangler.toml` đã bật sẵn cho đường này.

### Phương án Vercel

Repo đã kèm [`vercel.json`](vercel.json) với rewrite SPA (mọi đường dẫn trỏ về
`index.html`).

```bash
npm i -g vercel
vercel            # bản xem trước
vercel --prod     # production
```

Đặt biến môi trường trong Vercel → Settings → Environment Variables
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), rồi triển khai lại.

Sau khi triển khai, thêm miền thật vào **Supabase → Authentication → URL
Configuration → Redirect URLs** để luồng đặt lại mật khẩu hoạt động. Giao diện
đăng nhập dùng `emailRedirectTo = <origin>/`, còn đặt lại mật khẩu dùng
`<origin>/reset-password` — cần thêm **cả hai**.

> Supabase CLI nằm ở `devDependencies`, và Vercel cài `devDependencies` khi build.
> Không sao cả (gói CLI không có script `postinstall`), nhưng nếu muốn build nhẹ
> hơn thì đặt biến `NPM_FLAGS=--omit=dev` trong Vercel — ứng dụng không cần CLI
> lúc build.

---

## Nguyên tắc "ảnh gốc bất biến"

Đây là quy tắc không thể vi phạm trong mã nguồn:

1. **Không chuyển mã khi tải lên.** `uploadService` gửi đúng `File`/`Blob` mà trình
   duyệt đọc được từ đĩa. Không vẽ lại qua `<canvas>`, không đổi đuôi tệp, không ghi
   lại metadata.
2. **Tên trong storage là duy nhất.** Đường dẫn dùng UUID + tên gốc đã chuẩn hoá, nên
   hai tệp cùng tên không bao giờ ghi đè nhau.
3. **Ảnh thu nhỏ là dữ liệu phái sinh.** Chúng nằm ở bucket riêng và có thể xoá/tạo
   lại bất cứ lúc nào mà không ảnh hưởng tới ảnh gốc.
4. **Kiểm chứng bằng băm.** Mỗi tệp có `sha256` lưu trong cột `photos.sha256`.
   `scripts/verify-checksum.mts` chứng minh hàm băm khớp vectơ chuẩn NIST.
5. **ZIP không nén.** Bộ ghi ZIP dùng phương thức STORE. `scripts/verify-zip.mts`
   mở lại gói bằng JSZip và so từng byte với bản gốc.

Quy tắc 4 và 5 được **chạy trong quá trình kiểm thử**, không chỉ là tài liệu.

---

## Chiến lược tải xuống theo thiết bị

Trình duyệt không thể ghi trực tiếp vào Thư viện ảnh. Thay vì hứa hẹn điều không làm
được, ứng dụng **phát hiện khả năng thật** của thiết bị và đề xuất chiến lược tốt nhất:

| Nền tảng | Chiến lược đề xuất | Cơ chế |
|---|---|---|
| Chrome/Edge desktop | **Ghi thẳng vào thư mục** | File System Access API, từng ảnh ghi xuống đĩa; hộp thoại mở sẵn tại **Desktop** |
| Firefox / Safari desktop | **ZIP luồng** | ghi ra OPFS, không tốn RAM; kèm hướng dẫn giải nén ra Desktop |
| Android (Chrome) | **ZIP luồng** | ghi ra OPFS; sau đó lưu vào Google Photos |
| **iOS / iPadOS** | **Lưu vào Thư viện ảnh theo từng đợt** | hỏi trước một lần, rồi mỗi đợt một lần mở share sheet |
| Không chia sẻ được tệp | **Tải từng ảnh** | thoái lui an toàn, có thông báo |

### Vì sao iOS phải bấm từng đợt

Trình duyệt web **không có API nào** ghi thẳng vào Thư viện ảnh. PhotoKit là framework
native, không dành cho trang web — nên không tồn tại hộp thoại xin quyền nào để ứng
dụng gọi. Cách duy nhất là đưa tệp qua **bảng chia sẻ** rồi để người dùng chọn
*Lưu vào Ảnh*; ngay cả mục đó cũng không phải lúc nào cũng có mặt.

Hai hệ quả được thiết kế trực tiếp vào luồng:

1. **Mỗi đợt cần một lần bấm riêng.** Safari yêu cầu *transient user activation* cho
   `navigator.share`. Sau một lần `await` dài (đang tải ảnh từ mạng), quyền đó hết
   hiệu lực và lệnh share tiếp theo bị từ chối — một vòng lặp tự động vì thế hỏng
   ngay ở đợt thứ hai.
2. **Đợt hiện tại được tải trước.** Tệp đã nằm sẵn trong bộ nhớ lúc người dùng bấm,
   nên share sheet mở ra tức thì và không kịp mất quyền kích hoạt.

Đợt được chia theo cả **số tệp** (8) và **dung lượng** (120MB), nên bộ nhớ không tăng
theo kích thước album. Logic chia đợt là hàm thuần, kiểm thử bằng
`npm run verify:batches` — 45 kiểm tra, gồm cả ba bất biến *không mất ảnh, không lặp
ảnh, giữ nguyên thứ tự*.

---

## Bảo mật

| Lớp | Biện pháp |
|---|---|
| Cơ sở dữ liệu | **RLS bật trên mọi bảng**. Mỗi chính sách ràng buộc `owner_id = auth.uid()`. |
| Storage | Chính sách theo `bucket_id` + tiền tố `owner_id`. Không bucket nào công khai. |
| Đường dẫn | `assertSafeStoragePath` chặn `..`, đường dẫn tuyệt đối và ký tự điều khiển. |
| Liên kết chia sẻ | Chỉ lưu **SHA-256 của token**. So khớp bằng so sánh hằng thời gian. |
| Mật khẩu chia sẻ | Băm **PBKDF2-SHA256** với muối riêng từng liên kết; không lưu bản rõ. |
| Signed URL | Hết hạn 5 phút (tải xuống) / 1 giờ (xem trước), phạm vi một tệp. |
| Edge Function | Kiểm tra thời hạn, số lần xem, quyền tải xuống **trước khi** phát URL. |
| Phiên | `supabase-js` quản lý token; không lưu token trong `localStorage` thủ công. |
| Bí mật | `service_role` chỉ tồn tại trong Edge Function; không bao giờ vào bundle `VITE_*`. |
| XSS | React tự thoát; không dùng `dangerouslySetInnerHTML`. |
| Riêng tư | Trang chia sẻ gửi `X-Robots-Tag: noindex, nofollow, noarchive` **và** thẻ `<meta name="robots">` do trang tự đặt. `robots.txt` chặn khu vực chủ kho nhưng **cố ý cho thu thập `/share/`** — chặn ở đó sẽ khiến máy tìm kiếm không đọc được thẻ `noindex`, đúng thứ cần tránh vì token trong URL chính là quyền truy cập album. Không tiết lộ danh tính chủ sở hữu. |

**Đã kiểm chứng bằng thử nghiệm phủ định** (xem bảng bên dưới): token sai bị từ chối,
mật khẩu sai bị từ chối, liên kết hết hạn bị từ chối, và bản ghi trong DB **không**
chứa token dạng rõ.

---

## Chi phí & hạn mức

### Bảng giá Supabase (kiểm tra tháng 10/2026)

| | Free | Pro | Team |
|---|---|---|---|
| Storage bao gồm | 1 GB | 100 GB | 100 GB |
| Storage vượt | — (bị chặn) | ~$0.0213/GB/tháng | ~$0.0213/GB/tháng |
| Egress bao gồm | 5 GB | 250 GB | 250 GB |
| Egress vượt | — | ~$0.09/GB | ~$0.09/GB |
| Cached egress bao gồm | 5 GB | 250 GB | 250 GB |
| Cached egress vượt | — | ~$0.03/GB | ~$0.03/GB |
| **Tệp tối đa** | **50 MB** | tới 500 GB | tới 500 GB |
| Project tạm dừng | sau 1 tuần không hoạt động | không | không |

> Giá có thể thay đổi. Hãy xác nhận lại trên trang giá của Supabase trước khi cam kết.

### Con số thực tế cho nhiếp ảnh gia

Giả sử một buổi chụp cho ra 800 ảnh JPEG ~18 MB và 120 tệp RAW ~45 MB:

- **Chỉ JPEG**: 800 × 18 MB ≈ **14,4 GB/buổi chụp**.
- **JPEG + RAW**: ≈ 14,4 + 5,4 = **~20 GB/buổi chụp**.

Suy ra:

| Nhu cầu | Gói phù hợp | Ước tính chi phí/tháng |
|---|---|---|
| < 50 GB, ảnh JPEG ≤ 50 MB, dùng cá nhân | Free | $0 |
| 50 GB – 1 TB, RAW lớn | **Pro ($25)** | $25 + storage vượt |
| Nhiều album công khai, tải nhiều | Pro/Team | cộng egress vượt 250 GB |

**Điểm cần cân nhắc:** với egress ~$0,09/GB, nếu một album 20 GB được tải 50
lần/tháng, chi phí egress khoảng **$90/tháng**. Để giảm:

1. Bật **Smart CDN / cached egress** cho ảnh xem trước (rẻ hơn 3×).
2. **Không** tạo ZIP cho lượt xem nhỏ — tải từng ảnh tiết kiệm egress.
3. Đặt hạn mức `album.max_downloads` cho liên kết chia sẻ công khai.
4. Với album lưu trữ ít truy cập, dùng **Supabase Storage lifecycle policy** để
   chuyển bucket `photo-archives` sang lớp lạnh (rẻ hơn) — hoặc chuyển sang
   Cloudflare R2 nếu egress trở thành chi phí lớn nhất (R2 miễn phí egress).

**Về giới hạn 50 MB:** đây là lý do thực tế quan trọng nhất để nâng lên Pro nếu bạn
chụp RAW. Gói Free **được dùng tốt** cho JPEG đã xuất và ảnh điện thoại, nhưng sẽ từ
chối hầu hết tệp RAW.

### Hạn mức phía trình duyệt

- ZIP: mặc định cảnh báo ở 1 GB, chặn cứng ở 4 GB hoặc 2000 tệp.
- Ghi ra OPFS cần dung lượng đĩa trống tương ứng kích thước gói.
- Ứng dụng hiển thị cảnh báo trước khi bắt đầu gói lớn, để người dùng chọn thư mục
  hoặc ZIP.

---

## Sao lưu & phục hồi

### Sao lưu cơ sở dữ liệu

```bash
# Sao lưu logic, an toàn để chạy định kỳ
supabase db dump --data-only -f backup-$(date +%F).sql

# Lược đồ có thể tái tạo hoàn toàn từ supabase/migrations/ (đã vào git)
```

Gói Supabase **Pro trở lên** có sao lưu tự động hằng ngày với khôi phục theo thời
điểm (PITR) — hãy dựa vào đó cho dữ liệu quan trọng, và **cũng** chạy `db dump` định
kỳ để có bản sao độc lập với nhà cung cấp.

### Sao lưu ảnh gốc

Cơ sở dữ liệu **không** chứa ảnh. Ảnh nằm trong Supabase Storage, nên:

```bash
# Đồng bộ toàn bộ bucket ảnh gốc về đĩa ngoài (chạy hằng tuần)
supabase storage cp -r ss:///photo-originals ./backup-originals
```

Bật **Object Versioning** (nếu gói hỗ trợ) trên `photo-originals` để chống xoá nhầm.
Vì ảnh gốc là bất biến, một bản sao định kỳ là đủ — không có ghi đè để hoà giải.

### Phục hồi

1. Tạo project Supabase mới, `supabase link`, `supabase db push` để dựng lược đồ.
2. `supabase db push` rồi nạp bản `backup-*.sql` để khôi phục dữ liệu.
3. `supabase storage cp -r ./backup-originals ss:///photo-originals` để khôi phục ảnh.
4. Đối chiếu: đếm `photos` khớp số đối tượng trong bucket; chạy kiểm tra SHA-256
   ngẫu nhiên 100 tệp để xác nhận toàn vẹn.
5. Ảnh thu nhỏ **không cần** phục hồi — chúng tái tạo được từ ảnh gốc.

**Mục tiêu phục hồi gợi ý:** RPO 24 giờ (sao lưu hằng ngày), RTO vài giờ.

---

## Kết quả kiểm thử thực tế

Các kiểm tra sau **đã được chạy thật** trong quá trình phát triển, không phải mô tả.

### Kiểm tra tự động (chạy lại được bằng lệnh trong repo)

| Lệnh | Nội dung | Kết quả |
|---|---|---|
| `npm run typecheck` | `tsc -b`, chế độ strict, không có `any` ngầm | ✅ sạch |
| `npm run build` | build production (2581 module) | ✅ thành công |
| `npm run verify:zip` | mở ZIP bằng **JSZip** (độc lập), so từng byte | ✅ 3/3 khớp |
| `npm run verify:checksum` | SHA-256 với 5 vectơ (rỗng, "abc", 448-bit, 1 triệu ký tự, tệp 12 MB) | ✅ 5/5 khớp |
| `npm run verify:worker` | `tsc` cho Worker Cloudflare, chế độ strict | ✅ sạch |
| `npm run verify:archive` | Chấp nhận kho lưu trữ trên `workerd` thật (Miniflare R2 + D1) | ✅ **102/102** |

Chi tiết `verify:archive` — chạy trên R2 và D1 cục bộ, qua đúng HTTP API của trình duyệt:

```
── BIG FILE — 500 MB, byte-for-byte ──────────────────────
  ✓ chia thành nhiều phần (bắt buộc do trần 100 MB/request)
  • tải lên 500 MB trong 36.6s (14 MB/s)   [63 phần × 8 MiB]
  ✓ SHA-256 tải về KHỚP nguồn (byte-for-byte)
  ✓ server đã tự băm lại object 500 MB

── RESUME ────  hoàn tất sớm bị từ chối (409) kèm danh sách phần thiếu
              nối tiếp và hoàn tất được sau khi ngắt · vẫn byte-for-byte
── CHECKSUM ──  ✓ đúng → xác minh · ✗ CỐ TÌNH SAI → BỊ PHÁT HIỆN
── DUPLICATES ─  trùng nội dung chặn ngay khi tạo phiên (409)
                cùng tên khác nội dung → hai ảnh riêng, tải về đúng nội dung từng bản
── SHARING ────  URL đã ký TRƯỚC ĐÓ bị vô hiệu sau khi thu hồi (410)
── PAGINATION ─  120 ảnh / trang 25 · không trùng · không sót

✓ 102 kiểm tra đạt, 0 thất bại.
```

Chi tiết `verify:zip`:

```
Tệp trong ZIP: 3
  • Đà Lạt — sương sớm 2026/Đà Lạt 01 — sương sớm.jpg
  • Đà Lạt — sương sớm 2026/Đồi thông chiều (bản gốc).jpg
  • Đà Lạt — sương sớm 2026/Ảnh chụp thô RAW.DNG
✓ 46698 byte, giống hệt bản gốc
✓ 8400953 byte, giống hệt bản gốc
✓ 2056 byte, giống hệt bản gốc
✓ STORE (không nén): phần đầu mục chỉ 652 byte
✓ Chặn ZIP vượt giới hạn dung lượng
✓ Chặn ZIP vượt giới hạn số tệp
✓ Huỷ giữa chừng: AbortError
```

### Kiểm tra trong trình duyệt (thủ công, end-to-end)

| # | Kịch bản | Kết quả |
|---|---|---|
| 1 | Tải trang, không có màn hình trắng, font tiếng Việt đúng | ✅ |
| 2 | Font LHanoienne bao phủ 376 glyph tiếng Việt; vài glyph hiếm rơi về Playfair | ✅ (đúng thiết kế) |
| 3 | Đăng ký → xác nhận → đăng nhập | ✅ |
| 4 | Tải lên JPEG + PNG + RAW `.DNG` cùng lúc, có tên tiếng Việt | ✅ |
| 5 | **Byte ảnh gốc trong storage trùng khớp SHA-256 đã ghi** | ✅ |
| 6 | Tên tệp có dấu được giữ nguyên (không bị mojibake) | ✅ |
| 7 | Phiên đăng nhập tồn tại qua tải lại trang (kiểm tra IndexedDB) | ✅ |
| 8 | Tạo liên kết chia sẻ; DB chỉ lưu hash, token hiện một lần | ✅ |
| 9 | Khách ẩn danh mở liên kết, xem được album | ✅ |
| 10 | Khách tải ZIP về, ghi ra OPFS, mở lại kiểm tra byte | ✅ |
| 11 | Liên kết có **mật khẩu**: sai bị từ chối, đúng mới xem được | ✅ |
| 12 | Liên kết **hết hạn / token sai** bị từ chối | ✅ |
| 13 | Phát hiện lỗi thật: bìa album trỏ vào tệp RAW không xem trước được → **đã sửa** quy tắc chọn bìa ở cả hai backend + SQL | ✅ đã sửa |
| 14 | Vùng chạm nút trên thẻ ảnh 32px → **đã mở rộng** ≥ 44px | ✅ đã sửa |
| 15 | Bố cục di động (390×844): điều hướng dưới, lưới một cột | ✅ |
| 16 | Không có lỗi console khiếm khuyết ở các luồng chính | ✅ |
| 17 | Kho lưu trữ: bàn giao diện `/connect` → kiểm tra GHI–ĐỌC–XOÁ thật → kết nối được | ✅ |
| 18 | Kho lưu trữ: tải lên qua giao diện, theo dõi tiến độ **theo phần** đọc từ server | ✅ |
| 19 | Kho lưu trữ: tải lại trang giữa chừng → bảng “phiên còn dở” hiện đúng tiến độ từ server | ✅ |
| 20 | Kho lưu trữ: dashboard đọc số đo thật (dung lượng, chi phí ước tính, hàng đợi xác minh) | ✅ |

Các bước 17–20 chạy trên `workerd` cục bộ với R2 của Miniflare — **chưa chạy trên
R2 thật**. Danh sách việc còn phải tự kiểm tra ở cuối
[docs/kho-luu-tru.md](docs/kho-luu-tru.md).

**Sửa lỗi thật trong quá trình kiểm thử:** bìa album được gán tự động cho tệp RAW
(không xem trước được) do thứ tự tải lên đồng thời. Quy tắc chọn bìa đã được siết
chặt để ưu tiên định dạng xem trước được, áp dụng ở `localBackend`, `supabaseBackend`
và trong hàm SQL `set_album_cover`.

### Chưa kiểm chứng trong hội thoại này

Trung thực mà nói, những phần sau **cần project Supabase thật** nên chưa chạy end-to-end:

- Luồng tải lên/tải xuống chống lại Supabase Storage thật (chỉ mới kiểm qua backend
  IndexedDB và các script kiểm tra độc lập).
- Edge Function `share` chạy trên hạ tầng Supabase (đã đọc và rà soát logic, chưa
  gọi live).
- Chính sách RLS thực thi phía máy chủ (đã rà soát SQL, chưa chạy thử nghiệm phủ định
  trên DB thật).
- Sao lưu/phục hồi theo quy trình ở trên.

Đây là **giới hạn của môi trường**, không phải lỗi đã biết. Hãy chạy mục
[Thiết lập Supabase](#thiết-lập-supabase) rồi lặp lại bảng kiểm tra. **Đường B**
(Supabase chạy local) chạy được cả ba hạng mục này ngay trên máy, không cần tài
khoản cloud — đó là cách nhanh nhất để đóng khoảng trống này.

---

## Khắc phục sự cố

| Triệu chứng | Nguyên nhân & cách xử lý |
|---|---|
| Thấy thông báo "đang chạy chế độ demo" | Thiếu `VITE_SUPABASE_URL`/`ANON_KEY`. Điền vào `.env.local` và **khởi động lại** dev server (Vite chỉ đọc biến lúc khởi động). |
| "Tệp vượt quá giới hạn 50 MB" | Giới hạn gói Free. Nâng gói Pro/Team rồi tăng `VITE_MAX_UPLOAD_BYTES` và giới hạn tệp trong Dashboard → Storage. |
| Tải lên lỗi 403 | Chính sách RLS hoặc storage chưa được nạp. Chạy `supabase db push` và kiểm tra `owner_id` khớp `auth.uid()`. |
| Liên kết chia sẻ báo 404 | Token đã bị thu hồi, hết hạn, hoặc Edge Function `share` chưa được triển khai. |
| Luồng đặt lại mật khẩu trỏ sai | Miền chưa có trong **Supabase → Authentication → URL Configuration → Redirect URLs**. |
| ZIP không tạo được | Trình duyệt không hỗ trợ OPFS hoặc hết dung lượng đĩa. Ứng dụng tự thoái lui sang tải từng ảnh; hoặc chọn chiến lược "ghi vào thư mục". |
| Bìa album trắng | Album chỉ chứa RAW. Đặt bìa thủ công cho một ảnh JPEG/PNG/WebP. |
| Trang chia sẻ bị đánh chỉ mục | Xác nhận thẻ `noindex` có trong HTML; kiểm tra không có proxy nào gỡ thẻ meta. |

---

## Giới hạn còn lại

Nói thẳng để bạn quyết định:

1. **Ảnh thu nhỏ tạo ở phía máy khách.** Với album lớn, lần xem đầu sẽ tải nhiều dữ
   liệu và tốn thời gian. Giải pháp: chuyển việc tạo ảnh thu nhỏ vào một Edge
   Function/hàng đợi phía máy chủ (xem lộ trình).
2. **Không có tìm kiếm theo nội dung.** Tìm kiếm chỉ theo tên tệp và tên album.
3. **Không có ứng dụng di động gốc.** iOS bị giới hạn ở "tải từng ảnh" vì Safari
   không cho web ghi vào Thư viện ảnh. Đây là giới hạn của nền tảng, không thể vượt
   qua bằng web thuần.
4. **Chưa có xử lý RAW phía máy chủ.** RAW xem trước được nhờ ảnh nhúng bên trong tệp
   (nếu có); nếu không, thẻ RAW chỉ hiển thị biểu tượng định dạng.
5. **Gói ZIP dài hạn chưa có worker hàng đợi** — `photo-archives` đã có bucket nhưng
   việc tạo ZIP quy mô lớn vẫn chạy ở phía trình duyệt.
6. **Chưa có tính năng cộng tác** (album chung, bình luận, nhiều thành viên).
7. **Chưa có kiểm thử tự động trong CI.** Hiện có script kiểm tra nhưng chưa gắn vào
   pipeline.

---

## Lộ trình mở rộng

Theo thứ tự ưu tiên nếu bạn muốn đưa lên quy mô hàng chục nghìn người dùng:

1. **Pipeline ảnh thu nhỏ phía máy chủ** — Edge Function + hàng đợi. Đây là thay đổi
   mang lại lợi ích lớn nhất về tốc độ và chi phí egress.
2. **Xử lý RAW bằng thuật toán giải mã** (ví dụ LibRaw biên dịch WASM) để tạo bản xem
   trước cho mọi tệp RAW.
3. **Tìm kiếm theo nội dung** — trích EXIF (khẩu độ, tiêu cự, ISO, GPS) vào cột có chỉ
   mục, thêm tìm kiếm toàn văn của Postgres.
4. **Chuyển sang Cloudflare R2 cho ảnh gốc** nếu egress vượt ~$50/tháng — R2 miễn phí
   egress, chỉ khác một adapter nhờ lớp cổng dịch vụ.
5. **Upload song song đa phần (multipart)** cho tệp RAW > 500 MB.
6. **Lớp lưu trữ lạnh** cho album cũ qua lifecycle policy.
7. **Kiểm thử tự động + CI** chạy `typecheck`, `build`, `verify:zip`,
   `verify:checksum` trên mỗi lần đẩy mã.
8. **Ứng dụng di động** dùng cùng lớp cổng dịch vụ, để iOS tải được thẳng vào Thư viện
   ảnh — điều duy nhất web thuần không làm được.

---

## Giấy phép

Mã riêng tư. Font **LHanoienne** và hình ảnh mẫu thuộc bản quyền của chủ sở hữu
tương ứng — hãy kiểm tra giấy phép trước khi phân phối lại.
