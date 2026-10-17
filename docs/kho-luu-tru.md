# Kho lưu trữ ảnh gốc trên Cloudflare R2

Tài liệu này nói về chế độ lưu trữ dành cho **ảnh gốc của nhiếp ảnh gia**: tệp
đơn lẻ tới gần 500 MB, thư viện hàng chục nghìn ảnh, không có hạn mức dung lượng
do ứng dụng đặt ra.

Kết luận ngắn: dùng **Cloudflare R2** làm nơi chứa ảnh gốc, **D1** chỉ chứa
metadata, và một **Worker** làm cửa duy nhất — nó giữ khoá, ký URL, ghép các
phần tải lên và tự xác minh SHA-256. Trình duyệt không bao giờ thấy khoá nào của
nhà cung cấp.

---

## 1. Vì sao phải chia nhỏ tệp khi tải lên

Đây là ràng buộc kỹ thuật đã kiểm chứng, không phải lựa chọn kiểu cách:

| Ràng buộc | Giá trị | Hệ quả |
| --- | --- | --- |
| Thân request của Cloudflare Worker | **100 MB** (Free/Pro) | Một request **không** mang được 500 MB. Stream cũng **không** vượt được trần này. |
| Kích thước phần nhỏ nhất của R2 | **5 MiB** | Phần phải ≥ 5 MiB (trừ phần cuối). |
| Số phần tối đa của R2 | **10.000** | Trần kích thước một tệp khi đi qua Worker. |
| Kích thước phần lớn nhất của R2 | **5 GiB** | Nhưng Worker chỉ nhận được 100 MB mỗi request. |
| Phần cuối khi ghép | phải **≤ kích thước phần chuẩn** | Nếu lớn hơn, R2 trả lỗi `completeMultipartUpload` (mã 10048) — đã gặp và đã xử lý. |
| Bộ nhớ của Worker | 128 MB | Băm SHA-256 phải chạy **theo luồng**, không nạp cả tệp. |

Vì vậy ứng dụng tự tính kế hoạch chia phần (`worker/src/config.ts`):

- Tệp ≤ 8 MiB: **1 phần** (không cần multipart).
- 500 MiB: **63 phần × 8 MiB** (phần cuối 4 MiB — nhỏ hơn nên hợp lệ).
- Kích thước phần được chọn trong khoảng 8–64 MiB, sao cho số phần ≤ 9.000 (chừa
  biên dưới trần cứng 10.000).

Nếu một tệp vượt khoảng 640 GB, Worker **báo lỗi rõ ràng** kèm con đường khắc
phục (thêm driver S3 presign để trình duyệt gửi thẳng lên R2), thay vì thất bại
khó hiểu.

---

## 2. Luồng tải lên một tệp 500 MB

```
Trình duyệt                         Worker (Cloudflare)              R2
────────────                        ───────────────────              ──
1. Băm SHA-256 tệp (theo luồng)
2. POST /api/uploads ─────────────►  tính số phần, tạo phiên ở D1
                                     chặn TRÙNG nội dung (409) ngay
   ◄──────── { session, partSize, partCount }
3. PUT /api/uploads/:id/parts/1 ───►  uploadPart → R2 (multipart) ──►  phần 1
   … (lặp cho từng phần còn thiếu) …
4. POST /api/uploads/:id/complete ►  ghép các phần ───────────────►  object
                                     so kích thước object với khai báo
                                     xoá object nếu lệch
                                     ghi metadata vào D1 (transcript)
   ◄──────── { photo, sizeVerified }
5. POST /api/photos/:id/thumbnail ►  ảnh thu nhỏ RIÊNG, không sửa ảnh gốc
6. Hàng đợi nền: đọc lại object, băm SHA-256, đối chiếu checksum
```

Điểm quan trọng:

- **Trạng thái phiên nằm ở D1, không ở trình duyệt.** Đóng tab, tắt máy, đổi
  mạng đều không mất tiến độ: lần sau client hỏi server “đã có phần nào rồi”.
- **Băm trước khi gửi.** Nhờ checksum, ảnh trùng bị chặn ở bước 2 — trước khi
  tốn bằng thông cho 500 MB.
- **Server tự băm lại.** Checksum của client chỉ là *khai báo*. Sau khi ghép,
  Worker đọc lại object rồi băm lần nữa; khác nhau thì ảnh bị đánh dấu
  `checksumMismatch` và hiển thị trên dashboard.
- **Huỷ không xoá tiến độ.** “Huỷ” để lại phiên để nối tiếp; “Xoá phiên” mới
  huỷ multipart trên R2. Phiên bỏ quá 7 ngày bị dọn tự động.
- **Không có gì bị viết lại.** Ảnh gốc đi từ đĩa lên thẳng object storage: không
  nén lại, không đổi định dạng, không sửa EXIF, không đổi kích thước.

---

## 3. Sơ đồ thành phần

| Thành phần | Vai trò | Ghi chú |
| --- | --- | --- |
| `worker/` | Toàn bộ backend: xác thực, metadata, lưu trữ, chia sẻ | Không có server Node, không tiến trình nền |
| D1 (`cloude-archive`) | `owners, albums, photos, upload_sessions, upload_parts, album_shares, jobs, stats, share_attempts` | **Chỉ metadata.** Không có byte ảnh nào trong cơ sở dữ liệu |
| R2 `cloude-originals` | Ảnh gốc, bất biến | Private bucket |
| R2 `cloude-thumbnails` | Ảnh thu nhỏ | Có thể xoá và tạo lại bất cứ lúc nào |
| Cron Trigger (tuỳ chọn) | Dọn phiên bỏ dở + xác minh checksum theo lô | Không cấu hình cũng chạy được bằng `POST /api/maintenance/run` |
| SPA (`src/`) | Giao diện, gọi `backend.multipart` | Chỉ gửi danh tính chủ kho |

Trong D1 **không có** cột hạn mức, không có bảng gói, không có giới hạn số ảnh.
`/api/usage` chỉ **báo cáo** số liệu thật và **cảnh báo** khi tới gần ngưỡng của
gói Cloudflare.

---

## 4. Chạy cục bộ (không tốn tiền, không cần tài khoản)

```bash
npm install

# 1. Nạp lược đồ D1 vào môi trường cục bộ (Miniflare)
npm run worker:db:init

# 2. Chạy Worker ở cổng 8787 (R2 + D1 đều là bản cục bộ, ghi vào worker/.wrangler/)
npm run worker:dev

# 3. Kiểm thử chấp nhận — bao gồm tệp THẬT 500 MB
npm run verify:archive

# 4. Giao diện: chạy Vite và trỏ vào Worker cục bộ
VITE_ARCHIVE_URL=http://127.0.0.1:8787 npm run dev
#   → mở http://localhost:5173/connect và dán token trong worker/.dev.vars
```

Cổng 8787 và 5173 đều nằm trong danh sách CORS cho phép của Worker
(`worker/src/index.ts`), nên chạy hai tiến trình tách nhau được.

> **Lưu ý khi chạy nhiều tiến trình:** chỉ nên có MỘT `wrangler dev` trên cổng
> 8787. Trên Windows hai tiến trình cùng bind một cổng vẫn “thành công”, và
> request sẽ rơi vào tiến trình cũ — dấu hiệu là 401 dù token đúng.

---

## 5. Triển khai thật

```bash
# 0. Đăng nhập Cloudflare
npx wrangler login

# 1. Tạo hai bucket R2 (tên phải khớp worker/wrangler.toml)
npx wrangler r2 bucket create cloude-originals
npx wrangler r2 bucket create cloude-thumbnails

# 2. Tạo cơ sở dữ liệu D1 — dán `database_id` trả về vào worker/wrangler.toml
npx wrangler d1 create cloude-archive

# 3. Nạp lược đồ lên D1 thật
npm run worker:db:init:remote

# 4. Đặt bí mật (KHÔNG bao giờ nằm trong wrangler.toml)
cd worker
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # token chủ kho
npx wrangler secret put ARCHIVE_TOKEN
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # khoá ký URL
npx wrangler secret put LINK_SECRET

# 5. (Tuỳ chọn) Cron Trigger: bỏ ghi chú [triggers] trong wrangler.toml

# 6. Triển khai Worker
cd .. && npm run worker:deploy
```

### Xác thực chủ kho — hai cách

Worker chấp nhận **một trong hai** (đặt cả hai cũng được, thứ tự ưu tiên là token
trước):

| Cách | Cấu hình | Đặc điểm |
| --- | --- | --- |
| **Token chủ kho** | `npx wrangler secret put ARCHIVE_TOKEN` | Nhanh để bắt đầu. Token được dán một lần ở `/connect` và lưu trong `localStorage` của trình duyệt. |
| **Cloudflare Access** (khuyến nghị) | `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` | Không có token nào trong trình duyệt. Worker xác minh chữ ký RS256 của JWT do Access cấp trước khi tin. |

Bật Cloudflare Access:

```bash
cd worker
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN   # ví dụ: myteam.cloudflareaccess.com
npx wrangler secret put CF_ACCESS_AUD           # Application Audience (AUD) Tag
```

Lấy `CF_ACCESS_AUD` trong Cloudflare Zero Trust → Access → Applications → ứng
dụng của bạn → Overview → **Application Audience (AUD) Tag**. Nhớ để ô token ở
`/connect` **trống** khi dùng cách này.

> **Vì sao phải xác minh chữ ký:** header `Cf-Access-Jwt-Assertion` do client gửi
> tới không tự nó đáng tin — ai cũng đặt được header. Worker vì vậy tải khoá công
> khai từ `https://<team-domain>/cdn-cgi/access/certs` và kiểm tra chữ ký RS256,
> cùng `aud` (đúng ứng dụng) và `exp` (còn hạn). Nhờ đó gọi thẳng vào Worker mà
> bỏ qua Access vẫn bị từ chối. Nếu không lấy được khoá công khai (mạng lỗi),
> request bị **từ chối** (fail closed) chứ không được cho qua.

### Gắn giao diện vào cùng Worker (khuyến nghị)

Cách gọn nhất là để **một Worker phục vụ cả API và trang web**, khi đó không có
CORS và `VITE_ARCHIVE_URL` để trống:

```toml
# worker/wrangler.toml
[assets]
directory = "../dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
```

```bash
VITE_BACKEND=archive npm run build   # tạo dist/
npm run worker:deploy                # Worker phục vụ API + SPA
```

Router trong `worker/src/index.ts` đã xử lý: `/api/...` và `/dl/...` do Worker,
mọi đường còn lại rơi xuống `env.ASSETS.fetch()`.

### Bảo vệ bằng Cloudflare Access (nên dùng)

Đặt Access trước Worker và **không dùng token** trong trình duyệt nữa: trình duyệt
chỉ gửi cookie do Access cấp. Ở màn hình `/connect`, để trống ô token.

Khi đó nên chặn cả đường `/dl/...` bằng Access (URL có chữ ký vẫn cần danh tính
chủ kho), trừ khi bạn chủ ý chia sẻ ra ngoài.

---

## 6. Chia sẻ bằng liên kết cho người ngoài

Yêu cầu: **chỉ cần có liên kết là xem và tải được**, người nhận không cần tài
khoản, không cần đăng nhập, không cần cấu hình gì. Đăng nhập chỉ dành cho chủ
kho (tải ảnh lên, tạo liên kết, đổi cài đặt).

Điều đó đặt ra ba ràng buộc bắt buộc — vi phạm một cái là mọi liên kết chia sẻ
hỏng với mọi khách, trong khi chủ kho vẫn thấy bình thường:

**1. Ba đường của khách phải truy cập được ẨN DANH:**

| Đường | Vì sao phải công khai |
| --- | --- |
| `/share/<token>` | Trang album cho khách (SPA) |
| `/api/shared/<token>/*` | Máy chủ kiểm tra chính token mới cho xem |
| `/dl/<ảnh>?scope=share:<id>&exp=…&sig=…` | URL ngắn hạn, chữ ký đã ràng buộc đúng một ảnh |

Nếu bạn đặt Cloudflare Access trước Worker, **phải loại trừ ba đường này** khỏi
ứng dụng Access (hoặc đặt một ứng dụng Access riêng chỉ cho `/api/*` còn lại).
Nếu không, khách sẽ bị chặn ở màn hình đăng nhập của Access và liên kết coi như
hỏng — đúng thứ mà yêu cầu ở trên cấm.

**2. Bao nhiêu lần chặn cũng phải nằm ở máy chủ.** Mọi quyết định cho xem hay
cho tải đều do Worker kiểm tra lại từ D1 ở MỖI request (`resolveShare`), nên thu
hồi liên kết có hiệu lực ngay — kể cả với URL đã được ký trước đó. Giao diện chỉ
hiển thị theo những gì máy chủ trả về.

**3. `VITE_ARCHIVE_URL` phải đúng, vì khách dùng chính nó.** Khách không có “kết
nối kho lưu trữ” nào trong trình duyệt, nên họ dùng thẳng giá trị này làm máy
chủ. Để trống khi một Worker phục vụ cả trang web lẫn API (trường hợp khuyến
nghị), hoặc điền đúng origin thật của Worker khi chạy tách origin. Điền một địa
chỉ không tồn tại sẽ làm trình duyệt khách báo lỗi phân giải tên miền — chủ kho
không thấy gì bất thường vì họ đã có kết nối riêng.

**Chủ album TẮT tải xuống thì sao?** Liên kết vẫn xem được: khách nhận ảnh thu
nhỏ (`/dl/<ảnh>:thumb`) nhưng mọi yêu cầu ẢNH GỐC bị từ chối 403. Với ảnh chưa
có bản thu nhỏ, yêu cầu xem trước trả 404 chứ KHÔNG trả ảnh gốc — nếu không thì
đường xem trước sẽ vô hiệu hoá chính lựa chọn “chỉ cho xem”.

Đổi lại: token chia sẻ dài 256-bit chỉ hiển thị **một lần**; cơ sở dữ liệu chỉ
lưu SHA-256 của nó, nên rò rỉ DB không lộ liên kết. Thu hồi bằng `DELETE
/api/shares/<id>` (nút thu hồi trong hộp thoại chia sẻ) có hiệu lực tức thì.

> **Hệ quả cần biết:** bảo vệ Worker bằng Access và cho người ngoài xem bằng liên
> kết là hai mục tiêu loại trừ nhau trên cùng một hostname. Nếu cần cả hai, hãy
> cho phần công khai một hostname riêng không đặt Access.

---

## 6. Bảo mật — những gì được và không được bảo vệ

| Hạng mục | Cách làm |
| --- | --- |
| Khoá truy cập R2 | **Không tồn tại ở phía trình duyệt.** Worker dùng binding `env.ORIGINALS` — không có access key/secret nào cả. |
| Danh tính chủ kho | Bearer token (so sánh theo thời gian hằng số) hoặc cookie Cloudflare Access. |
| URL ảnh | Có chữ ký HMAC-SHA256, gắn với phạm vi (`owner:<id>` hoặc `share:<id>`), hết hạn sau 30 phút. |
| Thu hồi chia sẻ | **Có hiệu lực ngay**: URL đã ký trước đó bị từ chối (410) vì trạng thái chia sẻ được kiểm tra lại mỗi lần đọc. |
| Mật khẩu chia sẻ | PBKDF2 (100.000 vòng, salt riêng từng liên kết), giới hạn 10 lần thử sai mỗi 15 phút. |
| Token chia sẻ | Chỉ lưu **hash SHA-256**; token thô hiển thị đúng một lần khi tạo. |
| Bucket | Riêng tư. Không có bucket công khai nào cho ảnh riêng tư. |
| Tải lên | Mỗi phần được kiểm tra thuộc đúng phiên **và đúng chủ sở hữu**; kích thước phần được đối chiếu. |
| Rò rỉ danh tính | Khách xem liên kết chia sẻ không thấy email/định danh chủ album. |

Điểm yếu **cần biết**: nếu bạn dùng token chủ kho thay vì Access, token nằm trong
`localStorage` của origin đó — bất kỳ script chạy trên cùng origin (XSS) đều đọc
được. Đó là lý do Access là lựa chọn mặc định nên dùng.

---

## 7. Chi phí thật

### Đơn giá dùng trong mô hình (kiểm tra tháng 10/2026)

| Khoản | Đơn giá | Miễn phí mỗi tháng |
| --- | --- | --- |
| Lưu trữ R2 | $0,015 / GB-tháng | 10 GB |
| Class A (ghi, tạo multipart…) | $4,50 / triệu thao tác | 1 triệu |
| Class B (đọc, liệt kê…) | $0,36 / triệu thao tác | 10 triệu |
| **Băng thông ra Internet (egress)** | **$0** | Không giới hạn |
| Workers Paid | $5 / tháng | 100.000 request/ngày ở gói Free |

> Giá công bố có thể thay đổi. Mọi con số trong ứng dụng đọc từ cấu hình
> (`PRICE_PER_*` trong `worker/wrangler.toml` hoặc `worker/.dev.vars`), nên khi
> nhà cung cấp đổi giá bạn sửa cấu hình, **không phải sửa mã**.

### Tự tính trước khi triển khai

```bash
npm run worker:cost -- 500      # 500 GB ảnh gốc
npm run worker:cost -- 2000 1   # 2 TB, mỗi GB được đọc lại 1 lần/tháng
```

Với 500 GB (kịch bản mặc định, 1.000 ảnh tải lên mỗi tháng):

```
Lưu trữ vượt ngưỡng: 490,5 GB → $7.36
Class A vượt ngưỡng: 0        → $0.00
Class B vượt ngưỡng: 0        → $0.00
Gói Workers Paid:              $5.00
──────────────────────────────────────
TỔNG:                          ≈ $12.36/tháng  (≈ $0,02 mỗi GB đang lưu)
```

Chi phí biên: **mỗi GB ảnh gốc tăng thêm tốn $0,015/tháng**. Không có bậc thang,
không có “gói” nào do ứng dụng đặt.

Một điều đáng nhớ: mỗi lần xác minh checksum đọc lại **toàn bộ** ảnh gốc, nên
hàng đợi xác minh chạy theo lô (`MAINTENANCE_BATCH`, mặc định 10 ảnh mỗi lần).
Xác minh 1.000 ảnh × 500 MB = 500 GB Class B (≈ $0,18) — rẻ, nhưng không miễn phí.

### Những khoản CHƯA tính

- **Sao lưu.** R2 **không** sao lưu hộ bạn. Xem mục 8.
- Thời gian của bạn để kiểm thử khôi phục.
- D1 (metadata) nằm trong gói Workers Paid; vài trăm byte mỗi ảnh, không đáng kể.
- Nếu gắn custom domain: chi phí tên miền.

---

## 8. Sao lưu & phục hồi

### Sự thật trước tiên

- **Mặc định: KHÔNG có sao lưu nào.** R2 bền (dữ liệu được nhân bản trong hạ tầng
  Cloudflare) nhưng **không** phải bản sao lưu: xoá nhầm, script lỗi, mất tài
  khoản đều xoá luôn ảnh. Không có tiến trình sao lưu nào chạy trừ khi bạn cấu
  hình nó.
- D1 đã bật `time travel` (khôi phục điểm thời gian) theo mặc định của Cloudflare,
  nhưng đó là lưới an toàn cho **metadata**, không phải cho ảnh.
- Ứng dụng **không bao giờ** tự xoá, nén hay hạ cấp ảnh gốc để tiết kiệm tiền.

### Bật sao lưu (làm một lần, rồi kiểm thử)

```bash
# Bật versioning trên bucket ảnh gốc để xoá/ghi đè có thể hoàn tác
npx wrangler r2 bucket versioning add cloude-originals

# Bản sao thứ hai ra ổ cứng ngoài (cần aws-cli hoặc rclone đã cấu hình theo
# hướng dẫn "R2 S3 API" của Cloudflare, dùng token R2 chỉ-đọc)
rclone sync r2:cloude-originals /duong/dan/o-cung-ngoai/anh-goc --checksum --progress

# Metadata (nhỏ, chạy được thường xuyên)
npx wrangler d1 export cloude-archive --remote --output backup/cloude-archive-$(date +%F).sql
```

### Kiểm thử khôi phục (bắt buộc — sao lưu chưa thử thì chưa tính là sao lưu)

```bash
# 1. Lấy một ảnh bất kỳ từ bản sao, đối chiếu SHA-256 với bản trong kho
shasum -a 256 /duong/dan/anh-goc/<khoá>            # macOS/Linux
# 2. So với checksum đã xác minh trong hệ thống: /api/photos/<id> → verifiedChecksum
# 3. Thử khôi phục metadata vào D1 tạm:
npx wrangler d1 execute cloude-archive-backup --local --file=backup/cloude-archive-2026-10-16.sql
```

Nếu hai checksum khớp nhau, bản sao đó thật sự dùng được. Nếu chưa làm bước này,
hãy coi như **chưa có sao lưu**.

---

## 9. Giới hạn thật (và những gì KHÔNG phải giới hạn)

**Là giới hạn thật của nền tảng — không vượt được bằng mã nguồn:**

| Giới hạn | Giá trị | Ý nghĩa |
| --- | --- | --- |
| Thân request mỗi lần | 100 MB | Lý do bắt buộc chia phần |
| Số phần mỗi tệp | 10.000 | Một tệp tối đa ≈ 640 GB khi đi qua Worker |
| Kích thước phần | 5 MiB – 5 GiB | Ứng dụng dùng 8–64 MiB |
| Dung lượng D1 | 10 GB | **Chỉ metadata** — khoảng vài chục triệu ảnh |
| Thời gian CPU mỗi request | 30 s (Workers Paid) | Băm theo luồng nên không chạm trần |
| Bộ nhớ Worker | 128 MB | Không bao giờ nạp cả ảnh gốc vào RAM |

**KHÔNG phải giới hạn của ứng dụng** (không có trong mã nguồn):

- Không có tổng dung lượng tối đa.
- Không có số ảnh tối đa.
- Không có hạn mức theo người dùng hay theo album.
- Không có gói, không có bậc thang, không có “hết dung lượng”.

Nếu bạn thấy một con số nào đó chặn mình, nó thuộc một trong ba loại: giới hạn
nền tảng ở bảng trên, ngưỡng **cảnh báo** lấy từ gói Cloudflare của bạn, hoặc
trạng thái thanh toán của tài khoản. Không loại nào là “thiết kế của ứng dụng”.

**Sức chứa thực tế phụ thuộc:** giới hạn nhà cung cấp, trạng thái tài khoản,
phương thức thanh toán và ngân sách của bạn. Ứng dụng không hứa “không giới hạn”
— chỉ hứa rằng **nó không tự đặt ra giới hạn nào**.

---

## 10. Kiểm thử chấp nhận

```bash
npm run worker:dev         # ở một cửa sổ khác
npm run verify:archive
```

Bộ kiểm thử chạy trên `workerd` cục bộ với **R2 và D1 thật của Miniflare**, đi
qua đúng HTTP API mà trình duyệt dùng:

| Hạng mục | Nội dung kiểm |
| --- | --- |
| Tệp lớn | 500 MB, chia 63 phần, ghép lại, **tải về băm SHA-256 và so với bản gốc** |
| Ngắt & nối tiếp | Gửi 2 phần rồi dừng; hoàn tất sớm bị từ chối kèm danh sách phần thiếu; nối tiếp rồi đối chiếu byte |
| Checksum | Đúng → đánh dấu đã xác minh. **Cố tình sai → bị phát hiện** và đánh dấu |
| Tên tệp trùng | Cùng tên khác nội dung → hai ảnh riêng, hai khoá riêng, tải về đúng nội dung của từng bản |
| Trùng nội dung | Cùng SHA-256 → chặn ngay khi tạo phiên (409), không gửi byte nào |
| Chia sẻ riêng tư | Thiếu mật khẩu 401 / sai 401 / đúng mở được; tắt tải xuống 403; **URL đã ký trước đó bị vô hiệu sau khi thu hồi (410)** |
| Phân trang | 120 ảnh, trang 25 mục, duyệt bằng con trỏ: không trùng, không sót, đủ tổng |
| Phục hồi | Huỷ phiên dọn cả multipart; gửi lại vào phiên đã huỷ bị từ chối; phần sai kích thước bị từ chối kèm số mong đợi |
| Tải theo khoảng | `Range: bytes=...` trả 206 với đúng byte |
| Rò rỉ | Phản hồi API không chứa token, không có `X-Amz-Signature`, không có khoá truy cập |
| Dashboard | Health **thật sự ghi/đọc/xoá** object thử; usage trả số đo được; nói rõ không đặt hạn mức |

Kết quả đo được trên máy phát triển (Windows, `workerd` cục bộ):

```
500 MB tải lên trong 36,6 giây (14 MB/s), 63 phần × 8 MiB
SHA-256 tải về KHỚP bản gốc
✓ 102 kiểm tra đạt, 0 thất bại
```

### Những gì CHƯA được kiểm chứng

Nói thẳng để bạn biết chỗ nào cần tự kiểm tra:

- **Chưa chạy trên R2 thật.** Toàn bộ kiểm thử dùng R2/D1 của Miniflare trong
  `workerd`. API và ngữ nghĩa multipart giống nhau, nhưng độ trễ, giới hạn tốc
  độ và hành vi ở quy mô thật thì chỉ đo được khi triển khai.
- **Chưa kiểm thử Cron Trigger thật.** Logic đã có và chạy được qua
  `POST /api/maintenance/run`; lịch cron phải tự bật và tự theo dõi.
- **Chưa kiểm thử Cloudflare Access.** Đường token đã kiểm thử đầy đủ.
- **Chưa đo tốc độ tải lên qua Internet thật.** 14 MB/s là con số trên máy cục
  bộ, không phải tốc độ đường truyền của bạn.
- **Chưa kiểm thử sao lưu/khôi phục** trong tài liệu này — đúng vì nó phụ thuộc
  cấu hình của bạn. Đó là việc phải tự làm và tự thử (mục 8).
