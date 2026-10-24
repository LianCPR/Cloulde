# Pulse — Khảo sát ứng dụng sức khỏe

Website khảo sát + backend Supabase + trang quản trị để xem câu trả lời.
Toàn bộ 35 câu hỏi và cấu trúc khảo sát được giữ nguyên. Giao diện đã được tinh gọn
(control bo góc đồng nhất, giảm hiệu ứng trang trí), thêm bước nhập tên/MXH,
footer liên hệ và cấu hình endpoint.

## Trạng thái triển khai (2026-10-24)

- **Project:** `cloude` — ref `lgbygyoiszechuxtknty`, region `ap-south-1`.
  Tài khoản đã chạm giới hạn 2 project free nên khảo sát dùng chung project này,
  với bảng/function riêng và RLS đóng; không sửa bảng nào của Cloudé.
- **Migration đã áp dụng:** bảng `survey_responses`, `survey_rate_limits`,
  hàm rate limit, hàm dọn dữ liệu, index, RLS và job pg_cron dọn dữ liệu 6 tháng.
- **Edge Function đã deploy:**
  - `submit-survey` (công khai, `verify_jwt = false`)
  - `admin-responses` (yêu cầu header `x-admin-key`, `verify_jwt = false`)
- **Endpoint công khai:**
  `https://lgbygyoiszechuxtknty.supabase.co/functions/v1/submit-survey`
- **Trang quản trị đã deploy:**
  <https://site-913e30905f4d43fc8537349cb481ee3c.freebuff.page> — site riêng,
  không chứa file khảo sát công khai. Mật khẩu đăng nhập nằm trong
  `.admin-password.local` — file này đã gitignore, **không upload lên web**.
- **Origin đã cấu hình:** `submit-survey` cho phép `http://localhost:8099`,
  `http://127.0.0.1:8099`, `http://localhost:5173`, `http://127.0.0.1:5173`
  và `null` (mở file khảo sát trực tiếp). `admin-responses` cho phép URL
  production, URL preview và localhost; **đã bỏ `null`** để không mở được
  trang quản trị bằng cách nhấp đúp file.
- **Giao diện:** tất cả lựa chọn dùng ô bo góc 7px + dấu tích, kể cả câu chọn một;
  câu 7 chỉ hiện khi câu 6 có từ 2 lựa chọn; footer “Làm bởi Đăng” kèm
  Instagram, Gmail và Facebook ở cả trang khảo sát lẫn trang quản trị.
- **Dữ liệu kiểm thử đã xoá:** bảng `survey_responses` hiện có 0 dòng.

Khi có slot free (hoặc nâng cấp Pro), có thể tạo project `pulse-survey` riêng,
chạy lại 3 migration và deploy 2 function theo mục 7, rồi đổi endpoint trong
`Pulse – Khảo sát ứng dụng sức khỏe.html` và `admin.html`.

## Cấu trúc

```
pulse-survey/
├── Pulse – Khảo sát ứng dụng sức khỏe.html   # website khảo sát đã nối API
├── admin.html                                # trang quản trị (mật khẩu)
├── admin-data.js                             # danh sách câu hỏi cho trang quản trị
├── admin-deploy/                             # bản đóng gói đã deploy lên Freebuff Sites
│   ├── manifest.json
│   ├── worker.js                             # phục vụ tĩnh + header noindex/no-store
│   └── public/                               # index.html, admin.html, admin-data.js, robots.txt
├── .admin-password.local                     # mật khẩu admin (gitignore, không commit)
├── .env.example                              # tên biến cho chạy local
├── .gitignore
├── README.md
└── supabase/
    ├── config.toml
    ├── functions/
    │   ├── submit-survey/index.ts             # API công khai nhận câu trả lời
    │   └── admin-responses/index.ts           # API quản trị, đọc danh sách bài
    └── migrations/
        ├── 20261023000000_pulse_survey.sql            # bảng, RLS, rate limit
        ├── 20261023010000_pulse_respondent_and_retention.sql  # tên/MXH, purge
        └── 20261023020000_pulse_retention_cron.sql    # lịch dọn 6 tháng
```

## 1. Database

Bảng `public.survey_responses`:

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | `uuid` | khoá chính, `gen_random_uuid()` |
| `survey` | `text` | mã khảo sát, hiện là `pulse-v1` |
| `respondent_name` | `text` | tên người làm, bắt buộc, 1–100 ký tự sau khi chuẩn hoá |
| `social_link` | `text` | liên kết MXH tuỳ chọn, chỉ nhận `http/https`, tối đa 300 ký tự |
| `submitted_at` | `timestamptz` | thời điểm trình duyệt gửi |
| `received_at` | `timestamptz` | thời điểm database nhận (`now()`) |
| `answers` | `jsonb` | toàn bộ câu trả lời, giữ mảng nhiều lựa chọn và mục “Khác” |
| `created_at` | `timestamptz` | thời điểm tạo bản ghi |

Ràng buộc và index:

- `answers` là JSON object, tối đa 64 KB;
- index `(survey, received_at desc)` và `(received_at desc)` để lọc/xuất;
- tên không rỗng sau khi trim; MXH phải bắt đầu bằng `http://` hoặc `https://`;
- RLS bật, **không có policy** cho `anon`/`authenticated`, đã `REVOKE ALL`;
  chỉ `service_role` trong Edge Function đọc/ghi được.

Rate limit: bảng `public.survey_rate_limits` + hàm
`public.survey_check_rate_limit(bucket, limit, window)`. Chỉ lưu hash SHA-256
của IP (có pepper), không lưu IP thô.

## 2. API công khai — `submit-survey`

`POST /functions/v1/submit-survey`, header `Content-Type: application/json`.

Payload hiện tại do file HTML tạo:

```json
{
  "survey": "pulse-v1",
  "submittedAt": "2026-10-24T02:16:46.796Z",
  "respondent": {
    "name": "Nguyễn Minh An",
    "social": "https://facebook.com/nguyen.minhan"
  },
  "answers": {
    "q1": { "a": ["iPhone", "Apple Watch"] },
    "q2": { "a": "Đang sử dụng thường xuyên" },
    "q6": { "a": ["Nhịp tim"], "other": "Ghi chú thêm" },
    "q35": { "a": "Mong có báo cáo tuần dễ hiểu." }
  }
}
```

- `respondent.name` bắt buộc; khoảng trắng được gộp và trim ở server.
- `respondent.social` tuỳ chọn; nếu người dùng nhập `facebook.com/...` thì
  trình duyệt tự thêm `https://` trước khi gửi.
- `answers` là object, mỗi câu một khoá `q1`…`q35`; câu bỏ trống không được gửi.
- Server kiểm tra mã khảo sát, thời gian lệch tối đa ±7 ngày, kiểu dữ liệu,
  giới hạn kích thước body/câu trả lời và trả lỗi rõ ràng.

Phản hồi:

| Trường hợp | HTTP | Body |
| --- | --- | --- |
| Lưu thành công | `201` | `{"ok":true,"id":"<uuid>"}` |
| Payload sai / thiếu tên | `400` | `{"ok":false,"error":{"code":"...","message":"..."}}` |
| Sai mã khảo sát | `400`/`422` | mã lỗi tương ứng |
| Quá giới hạn tần suất | `429` | `rate_limited` + `Retry-After` |
| Database lỗi | `500` | `storage_failed` — HTML **không** báo thành công |

Website chỉ hiện màn hình cảm ơn khi nhận `2xx` và `body.ok === true`; lỗi mạng
hoặc server lỗi giữ nguyên câu trả lời, đổi nút thành “Gửi lại”.

## 3. Xem câu trả lời — trang quản trị

Mở trang đã deploy:

**<https://site-913e30905f4d43fc8537349cb481ee3c.freebuff.page>**

Khi cần sửa giao diện, có thể chạy local bằng
`python -m http.server 8099` trong thư mục `pulse-survey` rồi mở
`http://localhost:8099/admin.html`. Không còn mở trực tiếp bằng cách nhấp đúp
file vì origin `null` đã bị bỏ khỏi danh sách cho phép.

Nhập mật khẩu trong `.admin-password.local` (dòng `ADMIN_PASSWORD=`).
Mật khẩu chỉ lưu trong `sessionStorage` của tab hiện tại; đóng tab là đăng xuất.
Sai 10 lần trong 15 phút từ cùng IP sẽ bị chặn tạm thời.

Trang quản trị có:

- **Tổng quan:** tổng số bài, số bài hôm nay/7 ngày, thống kê theo câu hỏi;
- **Bài làm:** danh sách từng người, tìm theo tên hoặc liên kết MXH, lọc theo
  khoảng ngày, mở từng bài để xem đủ 35 câu và nội dung “Khác”;
- **Xuất CSV:** tải toàn bộ bài đang có (kể cả khi đang lọc) với cột
  `id, ten, mxh, submitted_at, received_at, q1…q35`; mở được bằng Excel/Sheets.

Đổi mật khẩu quản trị:

```bash
# 1. Tạo mật khẩu mới
openssl rand -base64 24

# 2. Cập nhật secret trên Supabase (hoặc Dashboard → Edge Functions → Secrets)
cd pulse-survey
npx supabase secrets set ADMIN_PASSWORD="<mật-khẩu-mới>" --project-ref lgbygyoiszechuxtknty

# 3. Cập nhật lại .admin-password.local và đăng nhập lại
```

Secret thường có hiệu lực ngay; nếu không, deploy lại `admin-responses`.

Trang quản trị được phục vụ như một site tĩnh riêng, có `noindex`, `no-store`
và `robots.txt` chặn index. Ai biết URL vẫn thấy form đăng nhập, nhưng không có
câu trả lời nào được trả về nếu không đúng mật khẩu.

### Deploy lại trang quản trị

Bản nguồn là `admin.html` + `admin-data.js`; bản đóng gói nằm trong
`admin-deploy/public/`. Sau khi sửa giao diện, copy lại rồi deploy site
`Pulse Admin` bằng Freebuff Sites:

```bash
cd pulse-survey
cp admin.html admin-deploy/public/index.html
cp admin.html admin-deploy/public/admin.html
cp admin-data.js admin-deploy/public/admin-data.js
```

Sau đó nhờ Freebuff deploy lại từ `admin-deploy/manifest.json`. Site ID là
`7069706c-7305-47ce-80c7-ea22d853c274`; môi trường production đang published.

## 4. Xem, lọc và xuất dữ liệu bằng SQL

Dashboard → **SQL Editor**:

```sql
-- Tất cả bài, mới nhất trước
select id, respondent_name, social_link, received_at, answers
from public.survey_responses
order by received_at desc;

-- Lọc theo tên hoặc MXH
select id, respondent_name, social_link, received_at
from public.survey_responses
where respondent_name ilike '%minh%'
   or social_link ilike '%facebook.com/minh%'
order by received_at desc;

-- Đếm lựa chọn một câu chọn một (ví dụ q2)
select answers->'q2'->>'a' as tra_loi, count(*) as so_nguoi
from public.survey_responses
where answers ? 'q2'
group by 1 order by 2 desc;

-- Đếm lựa chọn câu chọn nhiều (ví dụ q12)
select jsonb_array_elements_text(answers->'q12'->'a') as lua_chon, count(*)
from public.survey_responses
where answers ? 'q12'
group by 1 order by 2 desc;

-- Nội dung "Khác" và câu hỏi mở
select id, answers->'q35'->>'a' as gop_y
from public.survey_responses
where answers ? 'q35';

-- Xuất CSV từ psql
\copy (select * from public.survey_responses order by received_at) to 'pulse-responses.csv' csv header
```

Xoá một bài cụ thể (không có nút xoá trên trang quản trị):

```sql
delete from public.survey_responses where id = '<uuid>';
```

## 5. Thời hạn lưu trữ 6 tháng

- `public.survey_purge_expired()` xoá các bài có `received_at` cũ hơn 6 tháng
  và dọn bộ đếm rate limit cũ.
- Job `pulse-survey-purge` chạy **mỗi ngày lúc 03:00 UTC** (khoảng 10:00 giờ
  Việt Nam) qua pg_cron; đã kiểm tra job ở trạng thái `active`.
- Chạy thủ công bất cứ lúc nào:

```sql
select public.survey_purge_expired();
```

- Nếu chuyển sang project khác không bật được pg_cron, migration cron sẽ lỗi;
  khi đó bỏ qua file đó và gọi hàm thủ công định kỳ.

## 6. Kiểm thử đã chạy

| Bài kiểm thử | Kết quả |
| --- | --- |
| `deno check` cả 2 Edge Function | Pass |
| `GET` endpoint công khai | `200 {"ok":true,...}` |
| Gửi đủ 7 phần qua giao diện thật | `201`, xuất hiện trong database |
| Tên có khoảng trắng thừa | Lưu thành công với tên đã trim/gộp khoảng trắng |
| MXH nhập `facebook.com/...` | Tự thành `https://facebook.com/...` |
| MXH `javascript:...` | Bị chặn tại trình duyệt, không cho bắt đầu |
| Bỏ trống tên | Báo lỗi, không chuyển sang câu hỏi |
| JSONB sau khi lưu | Đủ 34 câu trả lời, mảng nhiều lựa chọn và câu mở còn nguyên |
| Giả lập server lỗi 500 | Không hiện màn hình cảm ơn; hiện banner lỗi, nút “Gửi lại” |
| Bấm “Gửi lại” sau khi server hồi phục | Lưu thành công, hiện cảm ơn |
| Admin API đúng mật khẩu | `200`, trả danh sách bài |
| Admin API sai mật khẩu | `401 unauthorized` |
| Gửi bài từ trình duyệt thật tại `http://localhost:8099` | `201`, lưu thành công |
| Tên/MXH/câu trả lời tiếng Việt sau khi lưu | UTF-8 nguyên vẹn, không bị lỗi dấu |
| Gửi bài từ `http://127.0.0.1:8099` và `Origin: null` | `201`, lưu thành công |
| Gửi bài từ `https://evil.example` | `403 origin_not_allowed` |
| Admin từ origin local | `200`, trả danh sách bài |
| Admin từ URL production đã deploy | `200`, trả danh sách bài |
| Admin từ origin lạ hoặc `null` | `403 origin_not_allowed` |
| Trang quản trị production | `200`, tải đủ HTML + `admin-data.js`, không lỗi console |
| Header trang quản trị | `no-store`, `noindex`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` |
| Fetch từ trình duyệt tại URL production | Đến được API, nhận JSON `401` với mật khẩu sai (CORS đúng) |
| CORS preflight từ URL production | `204`, cho phép `x-admin-key` |
| Xuất CSV | Đủ cột `ten`, `mxh`, `q1…q35` |
| Hàm purge với bài 7 tháng tuổi | Xoá đúng 1 bài |
| Job pg_cron | `active`, lịch `0 3 * * *` |
| Control chọn một và chọn nhiều | Cùng bo góc 7px, cùng dấu tích, không còn ô tròn |
| Câu 7 khi câu 6 chỉ có 1 lựa chọn | Ẩn; hiện lại khi chọn từ 2 dữ liệu |
| Footer khảo sát và quản trị | Đúng tên Đăng, đúng link Instagram/Gmail/Facebook |
| Mobile 320px và 390px | Không tràn ngang; footer không bị thanh điều hướng che |
| Dữ liệu kiểm thử | Đã xoá; bảng còn 0 dòng |

## 7. Triển khai lại từ đầu

```bash
cd pulse-survey
npx supabase login
npx supabase link --project-ref <project-ref>

# Tạo bảng + RLS + rate limit + lịch dọn dữ liệu
npx supabase db push

# Deploy 2 function
npx supabase functions deploy submit-survey --no-verify-jwt
npx supabase functions deploy admin-responses --no-verify-jwt

# Secrets bắt buộc cho trang quản trị
npx supabase secrets set \
  ADMIN_PASSWORD="<mật-khẩu-dài-ngẫu-nhiên>" \
  RATE_LIMIT_PEPPER="<chuỗi-ngẫu-nhiên-khác>" \
  --project-ref <project-ref>
```

Sau đó sửa 2 chỗ:

- `CONFIG.endpoint` trong file khảo sát → URL `submit-survey`;
- `const API` trong `admin.html` → URL `admin-responses`.

`SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY` do Supabase tự inject vào function;
**không** đặt service role key trong HTML, repo hay file công khai.

## 8. Bảo mật và giới hạn còn lại

Đã làm:

- RLS bật, không policy cho `anon`/`authenticated`, `REVOKE ALL`;
- service role key chỉ ở server;
- admin API yêu cầu mật khẩu, so sánh constant-time, giới hạn 10 lần sai/15 phút;
- body công khai giới hạn 32 KB, `answers` 24 KB, tối đa 60 câu;
- rate limit 8 lần/10 phút và 40 lần/ngày theo hash IP;
- honeypot phía client; không log tên, MXH hay nội dung câu trả lời;
- tự động xoá dữ liệu sau 6 tháng.

Chưa làm / cần lưu ý:

- **Không có CAPTCHA**, không chống spam tuyệt đối; đổi IP vẫn vượt được rate limit.
- Trang quản trị dùng **một mật khẩu chung**, không có tài khoản riêng, phân quyền
  hay nhật ký truy cập. Ai có mật khẩu đều xem được tên và MXH của người làm.
- Mật khẩu admin nằm trong `sessionStorage` của tab đang mở; không gửi lên nơi
  khác, nhưng nếu máy bị malware thì vẫn có thể đọc được.
- Trang quản trị công khai ở URL riêng: người biết URL vẫn thấy form đăng nhập.
  Dữ liệu được bảo vệ bằng mật khẩu, không phải bằng VPN/IP allowlist. Nên đổi
  mật khẩu định kỳ và không chia sẻ URL công khai.
- `admin-responses` chỉ nhận origin production, preview và localhost; `null` đã bị
  bỏ nên mở file trực tiếp không gọi được API quản trị.
- Tên và liên kết MXH là dữ liệu cá nhân; đã ghi rõ trong phần giới thiệu khảo sát.
  Cần có chính sách riêng tư/consent đầy đủ trước khi công khai rộng rãi.
- Dùng chung project Cloudé: quản trị viên project vẫn có thể xem dữ liệu và quota
  dùng chung; khi có slot nên chuyển sang project riêng.
- Chưa cấu hình backup/PITR; Supabase free có backup giới hạn.
- `admin.html` tải tối đa 5.000 bài gần nhất; quá ngưỡng đó hãy lọc theo ngày
  hoặc xuất CSV từ SQL.

### Đổi sang tên miền thật khi đã deploy

Ví dụ khảo sát ở `https://pulse.tenmien.com` và trang quản trị ở
`https://admin.tenmien.com`:

```bash
cd pulse-survey
npx supabase secrets set \
  ALLOWED_ORIGINS="https://pulse.tenmien.com" \
  ADMIN_ALLOWED_ORIGINS="https://admin.tenmien.com" \
  --project-ref lgbygyoiszechuxtknty
```

Nếu khảo sát và trang quản trị cùng một tên miền, đặt cả hai biến giống nhau.
Muốn vừa dùng tên miền vừa thử local, thêm origin local vào danh sách, ví dụ:

```bash
ALLOWED_ORIGINS="https://pulse.tenmien.com,http://localhost:8099"
ADMIN_ALLOWED_ORIGINS="https://admin.tenmien.com,http://localhost:8099"
```

Sau khi đổi secret, thử lại một lượt gửi bài và đăng nhập quản trị. Nếu function
vẫn dùng giá trị cũ, deploy lại function tương ứng. Trang quản trị hiện đã bỏ
`null`; với khảo sát, bỏ `null` khi không còn nhu cầu mở file HTML trực tiếp.
