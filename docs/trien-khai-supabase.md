# Đưa Cloudé lên web qua Supabase — checklist phát hành

Tài liệu này mô tả **con đường đang được chọn** cho lần phát hành: Supabase làm
nơi lưu ảnh chính (Postgres + Storage + Auth + Edge Function). Đường R2/Worker
được giữ ở [trien-khai.md](trien-khai.md) chỉ dự phòng — mọi só kể về Cloudflare
trong đó **không áp dụng** cho lần này.

---

## 0. Trạng thái đã sẵn sàng (đang được kiểm sống)

| Hạng mục | Trạng thái |
|---|---|
| Supabase project `cloude` (ref `lgbygyoiszechuxtknty`) | ACTIVE_HEALTHY |
| Schema (5 bảng: albums, photos, album_shares, profiles, share_access_attempts) | Đã nạp, RLS bật cả 5 |
| Câu	hình FK `albums_cover_photo_id_fkey` | Đã đổi tên chuẩn khiến PostgREST nhận đúng relationship |
| 3 bucket `photo-originals`/`photo-thumbnails`/`photo-archives` | Đã tạo, private, đúng hạn mức |
| Triggers/hàm (touch_updated_at, on_photo_inserted/deleted, share_*) | Đã nạp |
| Edge Function `share` | ACTIVE, `verify_jwt=false`, CORS `Allow-Headers: "*"`, `verify_jwt` false |
| `.env.local` (máy hiện tại) | Có `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` + `VITE_BACKEND=supabase` |
| `.env.production` (đi theo repo) | Backend sop| `VITE_BACKEND=supabase` |

Đã kiểm e2e trên trình duyệt thật: đăng nhập chủ → tạo album "Đà Lạt 2026" →
tải ảnh JPEG thật → tạo liên kết chia sẻ → mở ở tab ẩn danh, ảnh hiển thị viết
qua signed URL, khách chỉ xem/tải.

---

## 1. Deployment SPA

Chọn môi trường hosting SPA. Vercel hoặc Netlify đều được:

```bash
# Trên Vercel → Environment Variables đặt:
VITE_BACKEND=supabase
VITE_SUPABASE_URL=https://lgbygyoiszechuxtknty.supabase.co
VITE_SUPABASE_ANON_KEY=<giá trị publishable/anon key>
# (tệp .env.production trong repo đã có đủ 3 biến này; Vercel vẫn cần nhận biết
#  vì Vite ưu tiên biến môi trường thật hơn tệp.)
```

```bash
npm run build   # ra dist/
vercel --prod   # hoặc npx vercel --prod
```

---

## 2. Supabase dashboard — checklist xác thực

Đi Supabase → Project Settings → API → các biến sẽ khớp .env.production:
- **Project URL** trùng `VITE_SUPABASE_URL`.
- **anon / publishable key** trùng `VITE_SUPABASE_ANON_KEY`.

Tính Auth các mục nên giữ:
- **Confirm email** nên BẬT trong production (tránh tài khoản rác). Khi đó
  muốn tải thử sau deploy phải的手动 tạo user bằng admin API hoặc cho bạn thử
  đăng ký qua đường dẫn thực tế có link xác nhận.
- **Allowed redirect URLs** thêm domain SPA của cậu (ví dụ `https://<domain>/`).

---

## 3. Edge Function `share` — con đường đã làm

Function `share` đã được deploy và đang ACTIVE. Muốn đổi code function trong
repo (supabase/functions/share/index.ts) và deploy lại:

```bash
npm run supabase:login         # tạo personal access token mở trình duyệt
npm run supabase:link -- --project-ref lgbygyoiszechuxtknty
npm run supabase:deploy        # == supabase functions deploy share
```

Lưu ý quan trọng:
- `verify_jwt` phải là **false** (khách không có JWT vẫn gọi được).
- `Access-Control-Allow-Headers` phải là `"*"` — supabase-js hiện gửi thêm
  `x-supabase-api-version` và danh sách tĩnh không đủ.
- Supabase tự nạp `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY` vào môi trường
  function; cần thêm ORIGINALS/THUMBNAILS bucket name nếu đổi tên bucket.

---

## 4. Kiểm tra sau khi deploy SPA

```bash
# Trang SPA trả 200 rồi không lỗi console
curl -s -o /dev/null -w "%{http_code}\n" https://<domain>/

# Edge Function trả 401 chuẩn cho khách
curl -s -X POST https://<ref>.supabase.co/functions/v1/share \
  -H "apikey: <anon_key>" -H "Authorization: Bearer <anon_key>" \
  -H "content-type: application/json" -d '{"action":"list"}'
# → {"data":null,"error":"Bạn cần đăng nhập."}
```

Trên trình duyệt ẩn danh:
1. Mở `{domain}/` — trang chủ, không lỗi console.
2. Đăng nhập chủ kho — tạo album, tải 1 ảnh thật, mở album.
3. Tạo liên kết chia sẻ, sao chép URL.
4. Mở URL đó ở tab ẩn danh — ảnh hiện rõ; không có nút "Tải ảnh lên",
   "Chỉnh sửa album", "Chia sẻ" (chỉ xem được).
5. Thử tắt "Cho phép tải ảnh gốc" trong hộp thoại chia sẻ, làm mới tab ẩn danh
   — nút tải biến mất.

---

## 5. Những điều chưa kiểm trên đường Supabase

Nói thẳng để không hứa hơn thực tế:

1. **Country Scale / vi шар тайكم lượng ảnh RAW lớn** — Free tier Supabase
   Storage chỉ tối đa 50 MB/tệp (bucket `photo-originals` đã đặt đúng 50 MB).
   Với RAW 500 MB cần nâng gói Pro hoặc đổi bucket limit.
2. **Kiểm định tổng ký电子商务 chữ signURL có hết hạn** — signed URL TTL 1 giờ
   (view), 5 phút (download). Chưa test luồng скачив trên trình duyệt ẩn danh
   (chỉ đã test signed URL decode vào `<img>`).
3. **Chưa test luồng supervisor chrome tạo album → upload → share xuống mobile
   Safari/Android** — chỉ test desktop Chrome.

---

## 6. Nếu có gì hỏng trên đường Supabase

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| Trang trắng, console báo PostgREST "Could not find a relationship" | Chưa `NOTIFY pgrst, 'reload schema';` sau khi tạo bảng/FK mới qua SQL |
| Album không hiện ảnh bìa | FK constraint phải tên chuẩn `albums_cover_photo_id_fkey` |
| Hộp thoại chia sẻ bào "Không gọi được Edge Function" | Function `share` chưa deploy, hoặc `verify_jwt` đang true |
| Đăng ký trả 400 "email_address_invalid" | GoTrue chặn domain example.com — dùng email thực hay bật `mailer_autoconfirm` |
| Client tokh ERR_FAILED trên fetch supabase | Thiếu CORS header `/functions/v1/share` |
| Lammage edge function 403 — khách không được phép | `verify_jwt=true` — phải tắt qua Dashboard |
