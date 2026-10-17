# Đưa Cloudé lên web — checklist phát hành

Tài liệu này là danh sách việc **theo thứ tự**, làm từ trên xuống là xong. Chia
làm hai phần rõ ràng:

- **Phần A — việc cần tài khoản của bạn** (Cloudflare). Tôi không làm hộ được vì
  phải đăng nhập bằng tài khoản của bạn.
- **Phần B — kiểm tra sau khi deploy**, làm được ngay trên máy.

Trước khi bắt đầu, đọc mục **0** để chọn đúng đường triển khai. Chọn sai đường là
lý do phổ biến nhất khiến "chủ kho thấy bình thường nhưng khách mở liên kết thì hỏng".

---

## 0. Chọn đường triển khai (quan trọng nhất)

Có hai cách. Với yêu cầu *"chỉ cần có liên kết là xem và tải được, không cần đăng
nhập"*, hai cách này **không tương đương nhau**:

| | **Cách 1 — một Worker phục vụ cả trang web lẫn API** (khuyến nghị) | **Cách 2 — SPA trên Vercel, API trên Cloudflare** |
|---|---|---|
| CORS | **Không cần** (cùng một origin) | **Bắt buộc cấu hình** `ALLOWED_ORIGINS` |
| Liên kết chia sẻ của khách | Chạy được ngay | Chỉ chạy khi CORS đã đúng |
| Số nơi phải cấu hình | 1 | 2 (Vercel + Worker) + biến lúc build |
| Rủi ro chính | Không có | Quên tên miền trong `ALLOWED_ORIGINS` → **mọi request của khách bị chặn** |

**Khuyến nghị: Cách 1.** Một origin, không CORS, không có chỗ nào để lệch cấu hình
giữa hai nơi. Cách 2 vẫn làm được — xem mục 6.

---

## 1. Yêu cầu gói Cloudflare — đọc trước khi trả tiền cho sai gói

**Workers Paid (khoảng 5 USD/tháng) là cần thiết, không phải tuỳ chọn.**

Lý do cụ thể, không phải suy đoán: khi một ảnh tải lên xong, Worker **băm lại toàn
bộ ảnh gốc bằng SHA-256** để xác minh nội dung (`hashObjectStream`). Một tệp 500 MB
là khoảng vài giây CPU; gói **Free chỉ cho 10 ms CPU mỗi request**, nên việc xác
minh sẽ bị ngắt giữa chừng. Hàng đợi bảo trì còn nặng hơn: mặc định một lượt xử lý
10 ảnh (`MAINTENANCE_BATCH`), nhân với kích thước ảnh thật.

Nếu bạn muốn thử trước khi trả tiền, giảm nhịp hàng đợi:

```toml
# worker/wrangler.toml → [vars]
MAINTENANCE_BATCH = "1"
```

và chấp nhận rằng xác minh checksum sẽ chậm, có thể lỗi trên gói Free. Ảnh gốc vẫn
được lưu nguyên vẹn — chỉ bước xác minh bị ảnh hưởng.

**R2** có mức miễn phí 10 GB lưu trữ, nhưng tính năng multipart + D1 đi kèm gói
Workers. Chi phí thực tế cho vài trăm GB: chạy `npm run worker:cost -- 500` để xem
con số của chính bạn thay vì tin vào ước lượng.

---

## 2. Việc cần làm trên Cloudflare (Phần A)

Làm trong thư mục `worker/` trừ khi có ghi chú khác.

```bash
# 2.1 Đăng nhập (mở trình duyệt)
npx wrangler login
```

```bash
# 2.2 Tạo hai bucket R2 — TÊN PHẢI KHỚP worker/wrangler.toml
npx wrangler r2 bucket create cloude-originals
npx wrangler r2 bucket create cloude-thumbnails
```

```bash
# 2.3 Tạo cơ sở dữ liệu D1
npx wrangler d1 create cloude-archive
```

Lệnh này **in ra một `database_id`** (dạng UUID). Đây là bước hay bị bỏ sót nhất:

> **Mở `worker/wrangler.toml`, thay `database_id = "00000000-0000-0000-0000-000000000000"`
> bằng giá trị thật vừa in ra.** Nếu để nguyên giá trị giữ chỗ, deploy hoặc chạy
> sẽ hỏng ở tầng D1 với thông báo khó hiểu.

```bash
# 2.4 Nạp lược đồ lên D1 THẬT (không phải bản cục bộ)
cd .. && npm run worker:db:init:remote
```

```bash
# 2.5 Đặt hai bí mật. Mỗi lệnh sẽ hỏi giá trị — dán vào, KHÔNG ghi vào tệp nào.
cd worker

# a) Token chủ kho: chuỗi ngẫu nhiên bạn tự sinh và giữ kín. Đây là chìa khoá
#    duy nhất để tải ảnh lên và tạo liên kết chia sẻ.
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
npx wrangler secret put ARCHIVE_TOKEN     # dán giá trị vừa in

# b) Khoá ký URL tải xuống có thời hạn — một chuỗi khác, cũng ngẫu nhiên.
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
npx wrangler secret put LINK_SECRET       # dán giá trị vừa in
```

Hai giá trị này xuất hiện **một lần** trên màn hình. Hãy lưu vào trình quản lý mật
khẩu. Mất `ARCHIVE_TOKEN` thì phải đặt lại (và chuỗi chia sẻ cũ vẫn dùng được — xem
mục 7); mất `LINK_SECRET` thì mọi URL tải xuống đã phát hành trước đó hết hiệu lực,
không ảnh hưởng dữ liệu.

```bash
# 2.6 Deploy. Script này TỰ chạy `npm run build` trước, vì Worker cần thư mục
#     `dist/` để phục vụ trang web.
cd .. && npm run worker:deploy
```

Không cần set biến môi trường nào lúc build: tệp `.env.production` nằm trong
repo đã ép `vite build` chạy ở chế độ `archive` với `VITE_ARCHIVE_URL` để trống
(cùng origin). Nếu build không có tệp này, ứng dụng sẽ rơi vào chế độ demo
IndexedDB — xem mục 9.

Sau khi xong, Wrangler in ra địa chỉ, dạng:

```
https://cloude-archive.<tài-khoản-của-bạn>.workers.dev
```

Đó là **origin duy nhất** của ứng dụng: vừa là trang web, vừa là API.

### Tuỳ chọn: tên miền riêng

Vào Cloudflare → Workers & Pages → `cloude-archive` → Settings → Domains & Routes →
Add → Custom Domain. Sau khi thêm, dùng tên miền đó thay cho `*.workers.dev`.
**Không cần đổi gì trong mã nguồn** — vì `VITE_ARCHIVE_URL` để trống (cùng origin),
ứng dụng tự dùng origin mà trình duyệt đang mở.

### Việc phải làm ngay sau deploy: kết nối danh tính chủ kho

1. Mở `https://<origin>/connect`
2. Dán `ARCHIVE_TOKEN` vào ô token → Kiểm tra kết nối
3. Màn hình phải báo kiểm tra GHI–ĐỌC–XOÁ thành công trên cả hai bucket

Từ lúc này bạn mới tạo được album và liên kết chia sẻ. **Khách thì không cần làm
bước này** — họ chỉ mở liên kết.

> Chưa có album nào là chuyện bình thường: D1 thật vừa được tạo rỗng. Dữ liệu
> trong D1 cục bộ khi phát triển không tự chuyển lên.

---

## 3. Không dùng Cloudflare Access cho lần phát hành này

**Đây là quyết định có chủ ý, không phải thiếu sót.**

Nếu bạn đặt Cloudflare Access trước Worker, **mọi khách mở liên kết chia sẻ sẽ bị
chặn ở màn hình đăng nhập của Access** — đúng thứ mà yêu cầu "chỉ cần có liên kết"
cấm. Trang chia sẻ và các đường của khách (`/share/...`, `/api/shared/...`,
`/dl/...`) buộc phải truy cập được ẩn danh.

Đổi lại, cần biết rõ mình đang đánh đổi điều gì:

| Bề mặt | Ai vào được | Bảo vệ bằng gì |
|---|---|---|
| Trang web, `/share/...` | Công khai | Token 256-bit trong URL; `noindex` hai lớp |
| `/dl/...` | Công khai | Chữ ký HMAC, hết hạn 30 phút, ràng buộc một ảnh + một liên kết |
| `/api/shared/...` | Công khai | Chính token chia sẻ; mật khẩu (nếu đặt) bị chặn sau 10 lần sai |
| `/api/albums`, `/api/uploads`, mọi `/api/*` còn lại | **Không** | `ARCHIVE_TOKEN`, so sánh hằng thời gian |

Nói thẳng: `/api/*` của chủ kho **có thể bị gọi từ internet**. Nó từ chối mọi thứ
khi thiếu token 48 byte ngẫu nhiên, nhưng nó vẫn là một bề mặt công khai. Nếu bạn
muốn siết, hãy thêm Access **chỉ cho `/api/*` của chủ kho** (một Access Application
với đường dẫn `/api/*` và loại trừ `/api/shared/*`) — đừng chặn cả hostname.

---

## 4. Kiểm tra sau khi deploy (Phần B) — làm theo thứ tự này

Làm hết mục này trước khi gửi liên kết cho ai.

### 4.1 Máy chủ còn sống và đã xác thực

```bash
# Phải trả 401 khi thiếu token — nghĩa là API không mở công khai.
curl -s -o /dev/null -w "%{http_code}\n" https://<origin>/api/health
```

```bash
# Đổi <TOKEN> thành ARCHIVE_TOKEN. Phải trả 200 kèm driver r2-binding.
curl -s -H "authorization: Bearer <TOKEN>" https://<origin>/api/health
```

Trong JSON trả về, kiểm tra `storage.originalsWritable` và
`storage.thumbnailsWritable` đều `true` — đây là phép thử GHI/ĐỌC/XOÁ thật trên R2,
không phải ping suông.

### 4.2 Trang web tải được và không bị đánh chỉ mục

```bash
# Trang chủ: 200, content-type là HTML
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://<origin>/

# robots.txt phải có và KHÔNG được chặn /share/
curl -s https://<origin>/robots.txt | head -5
```

### 4.3 Đường của khách trả `noindex`

Đây là điều dễ bị bỏ qua nhất và cũng là rủi ro riêng tư lớn nhất: **token trong
URL chính là quyền truy cập album**, nên liên kết không bao giờ được lọt vào máy
tìm kiếm.

```bash
# Thay bằng một liên kết chia sẻ thật. Phải thấy: x-robots-tag: noindex...
curl -sI "https://<origin>/share/<TOKEN_CHIA_SE>" | grep -i "x-robots-tag"

# Thẻ meta trong HTML cũng phải có (do SPA đặt khi trang chạy)
curl -s "https://<origin>/share/<TOKEN_CHIA_SE>" | grep -o 'name="robots"[^>]*' | head -1
```

Lệnh thứ hai có thể không thấy gì vì SPA tạo thẻ bằng JavaScript — khi đó hãy kiểm
tra bằng mắt trong trình duyệt (DevTools → Elements → `<head>`), hoặc tin vào header
`X-Robots-Tag` ở lệnh thứ nhất (header là lớp đủ cho máy tìm kiếm).

### 4.4 Liên kết chia sẻ chạy trong trình duyệt SẠCH — bài kiểm tra quan trọng nhất

Đây là bài đã bắt được đúng lỗi khiến liên kết hỏng với mọi khách trong khi chủ kho
không thấy gì. Phải làm trong **cửa sổ ẩn danh (incognito)**, không dùng cửa sổ bạn
đang đăng nhập:

1. Mở `https://<origin>` ở cửa sổ thường → tạo album → tải lên **một ảnh JPEG thật**
   → tạo liên kết chia sẻ → sao chép liên kết
2. Mở **cửa sổ ẩn danh** → dán liên kết
3. Kiểm tra lần lượt:
   - Album hiện ra, **ảnh thu nhỏ hiển thị thật** (không phải ô nhấp nháy mãi)
   - **Không** có banner "Chưa kết nối kho lưu trữ"
   - **Không** thấy thanh bên hay điều hướng Tải ảnh / Cài đặt của chủ kho
   - Bấm "Tải ảnh đang xem" → chọn thư mục → tệp lưu xuống
   - Mở tệp đã lưu và **so với ảnh gốc**: phải giống hệt về byte

4. Kiểm tra nhanh bằng dòng lệnh rằng byte khớp (thay đường dẫn thật):

```bash
certutil -hashfile "duong\dan\anh-da-tai.jpg" SHA256
```

So với `checksum` hiển thị trong ứng dụng. Nếu khác, **dừng lại** — đừng gửi liên
kết cho ai.

### 4.5 Chủ album tắt tải xuống thì vẫn không lộ ảnh gốc

Tạo một liên kết **bỏ chọn "cho tải xuống"** rồi mở ở cửa sổ ẩn danh:

- Ảnh vẫn xem được (bản thu nhỏ), nhưng **không có** nút tải
- Thử tải trực tiếp vẫn phải bị từ chối:

```bash
# Phải trả 403 (download_disabled), không được trả ảnh
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'content-type: application/json' \
  -d '{"password":null,"photoId":"<ID_ANH>","variant":"original"}' \
  "https://<origin>/api/shared/<TOKEN_CHIA_SE>/link"
```

### 4.6 Thu hồi có hiệu lực ngay

Thu hồi liên kết trong hộp thoại chia sẻ, rồi **tải lại** liên kết cũ ở cửa sổ ẩn
danh → phải báo liên kết đã bị thu hồi, không hiện ảnh nào.

---

## 5. Sao lưu — làm trước khi có ảnh thật

Chưa có gì để sao lưu ở lần deploy đầu, nhưng thiết lập ngay từ đầu thì dễ hơn.

```bash
# Metadata (D1): xuất ra SQL
cd worker && npx wrangler d1 export cloude-archive --remote --output=./backup-metadata.sql
```

Ảnh gốc nằm trong R2. R2 không có bản sao tự động trên mọi gói — muốn an toàn thật
thì dùng `rclone` (hỗ trợ R2 qua S3 API) để đồng bộ `cloude-originals` sang một nơi
khác, hoặc bật Object Lifecycle để chuyển bản cũ sang lớp lưu trữ rẻ hơn.

**Nguyên tắc:** giữ ảnh gốc là bất biến. Không có thao tác nào trong ứng dụng ghi
đè ảnh gốc; chỉ ảnh thu nhỏ mới bị xoá và tạo lại.

---

## 6. Phương án 2 — SPA trên Vercel, API trên Cloudflare

Chỉ chọn cách này nếu bạn có lý do cụ thể muốn trang web nằm trên Vercel.

```bash
# B1. Trên Cloudflare: thêm tên miền Vercel vào danh sách cho phép.
#     Sửa worker/wrangler.toml → [vars]:
ALLOWED_ORIGINS = "https://ten-mien-vercel-cua-ban.vercel.app,http://localhost:5173"
```

```bash
# B2. Deploy lại Worker để biến mới có hiệu lực
npm run worker:deploy
```

```bash
# B3. Trên Vercel → Settings → Environment Variables, đặt CẢ HAI biến sau
#     (đây là biến lúc BUILD, sai ở đây là hỏng cả trang):
VITE_BACKEND=archive
VITE_ARCHIVE_URL=https://<origin-worker-cua-ban>
```

```bash
# B4. Deploy
vercel --prod
```

Ba cái bẫy của phương án này, theo đúng thứ tự hay gặp:

1. **Quên `VITE_BACKEND=archive`** → ứng dụng chạy chế độ demo IndexedDB. Trang vẫn
   mở được, vẫn cho tạo album, nhưng dữ liệu chỉ nằm trong trình duyệt của từng
   người và **không có gì được lưu thật**. Xem cách phát hiện ở mục 4.4 — banner
   "chế độ demo" sẽ hiện ở đầu trang.
2. **Quên tên miền trong `ALLOWED_ORIGINS`** → chủ kho vẫn thấy bình thường nếu
   origin đó đã có trong danh sách, nhưng trình duyệt của khách bị chặn ở CORS.
   Triệu chứng: console báo lỗi CORS, liên kết chia sẻ không mở được.
3. **Điền `VITE_ARCHIVE_URL` sai hoặc để trống** → để trống thì ứng dụng gọi
   `/api` trên chính tên miền Vercel, nơi không có API nào (rewrite SPA sẽ trả về
   `index.html`, nên lỗi hiện ra là "phản hồi không phải JSON"). Phải điền **đúng**
   origin Worker, có `https://`, không có dấu `/` ở cuối.

---

## 7. Vòng đời bí mật và liên kết

| Việc | Cách làm | Ảnh hưởng |
|---|---|---|
| Chia sẻ token cho người khác | **Đừng.** Token là toàn quyền. | — |
| Nghi token bị lộ | `npx wrangler secret put ARCHIVE_TOKEN` (đặt giá trị mới) | Phiên chủ kho trên mọi thiết bị mất hiệu lực; **liên kết chia sẻ đã gửi vẫn dùng được** vì chúng dựa trên hash trong D1, không dựa trên token |
| Nghi `LINK_SECRET` bị lộ | `npx wrangler secret put LINK_SECRET` | Mọi URL `/dl/...` đã phát hành hết hiệu lực ngay. Khách chỉ cần tải lại trang |
| Muốn chặn một album đã chia sẻ | Thu hồi liên kết trong hộp thoại chia sẻ | Hiệu lực tức thì, kể cả với URL đã ký trước đó |
| Muốn tạm dừng cả trang web | Cloudflare → Workers → `cloude-archive` → Pause deployment | Toàn bộ origin ngừng phục vụ; dữ liệu trong D1/R2 được giữ nguyên |
| Muốn xoá hẳn | `npx wrangler delete` rồi xoá bucket và D1 | **Không hoàn tác được** |

---

## 8. Những việc hệ thống chưa tự làm — biết trước khi hứa với người khác

Nói thẳng để bạn không hứa điều ứng dụng không làm được:

1. **Ảnh thu nhỏ tạo ở phía máy khách.** Máy khách phải tải ảnh gốc lên và tự tạo
   bản thu nhỏ. Với ảnh 500 MB, lần tải lên đầu tốn thời gian và băng thông của
   người tải lên.
2. **Không có tìm kiếm theo nội dung** — chỉ theo tên tệp và tên album.
3. **Không có ứng dụng di động.** Trên iOS, khách phải bấm từng đợt để lưu vào Thư
   viện ảnh; đây là giới hạn của nền tảng web, không phải lỗi.
4. **RAW chỉ xem trước được nếu tệp có ảnh nhúng bên trong.**
5. **Không có nhiều người dùng.** Một token chủ kho = một chủ sở hữu. Không có đăng
   ký, không có album chung nhiều thành viên. Ai có token là toàn quyền.
6. **Chữ trên trang lấy từ Google Fonts.** Mỗi lượt truy cập của khách (kể cả khách
   mở liên kết riêng tư) đều gọi `fonts.googleapis.com`, tức là Google thấy IP của
   khách. Muốn tránh, phải tự lưu font trong `public/fonts` và bỏ thẻ `<link>` tới
   Google — chưa làm.
7. **Chưa có CI.** Các bộ kiểm tra chạy bằng tay; chưa gắn vào pipeline.

---

## 9. Nếu có gì đó hỏng

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| Deploy báo lỗi quanh `D1` | Chưa thay `database_id` giữ chỗ trong `wrangler.toml` (mục 2.3) |
| Deploy báo không tìm thấy `../dist` | Chưa build. Dùng `npm run worker:deploy` (tự build) thay vì `wrangler deploy` trực tiếp |
| `/api/health` trả 401 dù token đúng | Token dán dư dấu cách hoặc dấu xuống dòng; hoặc secret chưa được đặt ở đúng Worker |
| Trang mở được nhưng trắng, console báo `Phản hồi không phải JSON hợp lệ` | Ứng dụng đang gọi `/api` ở sai origin — kiểm tra `VITE_ARCHIVE_URL` lúc build |
| Khách mở liên kết thấy "Không mở được liên kết này" | Liên kết đã thu hồi/hết hạn, **hoặc** khách bị chặn ở CORS (phương án 2), **hoặc** máy chủ không phản hồi |
| Chủ kho thấy bình thường, khách không mở được | Đây là dấu hiệu kinh điển của cấu hình lệch giữa hai origin. Xem mục 6 |
| Ảnh không lên, báo vượt thời gian CPU | Gói Workers Free. Xem mục 1 |
| Banner "chế độ demo cục bộ" hiện trên trang đã deploy | Build không qua `.env.production` (tệp bị xoá, hoặc biến môi trường ghi đè `VITE_BACKEND`) |
| Trang cũ (`wrangler dev`): `/` và asset mới build trả 404, nhưng favicon/robots.txt vẫn 200 | `wrangler dev` đang chạy từ TRƯỚC lần build cuối — nó phục vụ theo trạng thái asset lúc khởi động. Restart `wrangler dev` sau mỗi lần build lại. (Bản deploy thật không gặp: `wrangler deploy` luôn upload asset mới) |
