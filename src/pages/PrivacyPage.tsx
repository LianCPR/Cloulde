import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";

export function PrivacyPage() {
  return (
    <article className="prose-lg mx-auto max-w-3xl space-y-5 text-[14px] leading-relaxed">
      <header className="space-y-2">
        <ShieldCheck className="size-8 text-rose-text" aria-hidden />
        <h1 className="font-display text-3xl leading-tight">Chính sách quyền riêng tư</h1>
        <p className="text-[13px] text-ink-soft">
          Phát hành mới nhất: tháng 10, 2026 · Cloudey (cloudey.netlify.app)
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="font-semibold text-[16px]">1. Tóm tắt nhanh</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Chúng tôi lưu <strong>ảnh gốc của bạn nguyên byte</strong> — không nén, không xem,
            không chia sẻ.
          </li>
          <li>Chúng tôi không bán dữ liệu của bạn. Không dùng ảnh của bạn cho quảng cáo.</li>
          <li>
            Thông tin cá nhân thu thập chỉ gồm <strong>email</strong> và (nếu bạn điền){" "}
            <strong>tên hiển thị</strong>.
          </li>
          <li>
            Khi tải ảnh lên, bạn phải bấm "Đã đọc và xác nhận" rồi mới gửi — để chắc chắn bạn
            hiểu mình đang gửi gì lên đâu.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-[16px]">2. Dữ liệu thu thập và lưu trữ</h2>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] uppercase tracking-wide text-ink-soft">
              <th className="py-2 pr-4">Dữ liệu</th>
              <th className="py-2 pr-4">Mục đích</th>
              <th className="py-2">Lưu ở đâu</th>
            </tr>
          </thead>
          <tbody className="align-top">
            <tr className="border-b border-line/50">
              <td className="py-2 pr-4 font-medium">Email đăng nhập</td>
              <td className="py-2 pr-4">Xác thực tài khoản, khôi phục mật khẩu</td>
              <td className="py-2">Supabase Auth</td>
            </tr>
            <tr className="border-b border-line/50">
              <td className="py-2 pr-4 font-medium">Tên hiển thị (tuỳ chọn)</td>
              <td className="py-2 pr-4">Hiện trên album được chia sẻ ("chia sẻ bởi…")</td>
              <td className="py-2">Supabase (bảng profiles)</td>
            </tr>
            <tr className="border-b border-line/50">
              <td className="py-2 pr-4 font-medium">Ảnh gốc + ảnh thu nhỏ</td>
              <td className="py-2 pr-4">Lưu trữ, xem trước, tải về đúng tệp đã lưu</td>
              <td className="py-2">Supabase Storage (bucket riêng tư)</td>
            </tr>
            <tr className="border-b border-line/50">
              <td className="py-2 pr-4 font-medium">Metadata album (tiêu đề, mô tả, kích thước)</td>
              <td className="py-2 pr-4">Sắp xếp, tìm kiếm, dùng cho trang chia sẻ</td>
              <td className="py-2">Supabase Postgres</td>
            </tr>
            <tr>
              <td className="py-2 pr-4 font-medium">Token chia sẻ (bản băm SHA-256)</td>
              <td className="py-2 pr-4">Xác minh liên kết chia sẻ, không lưu dạng thô</td>
              <td className="py-2">Supabase Postgres</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-[16px]">3. Ai thấy được ảnh của bạn?</h2>
        <p>
          <strong>Mặc định: chỉ bạn.</strong> Ảnh nằm trong bucket riêng tư, không thể truy cập
          trực tiếp từ bên ngoài bằng URL. Mỗi lần bạn (hoặc người nhận liên kết chia sẻ) muốn
          xem ảnh, hệ thống cấp một <em>signed URL</em> có thời hạn (xem trước 1 giờ, tải
          xuống 5 phút) rồi hết hiệu lực.
        </p>
        <p>
          Vì vậy, khi bạn chia sẻ album với một liên kết, đối tượng nhận được quyền{" "}
          <strong>xem/tải ảnh trong album đó</strong> — không hơn. Không thể tải lên, sửa, đổi
          tên hay xoá ảnh từ trang chia sẻ của khách.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-[16px]">4. "Đã đọc và xác nhận" khi gửi ảnh</h2>
        <p>
          Trước khi gửi ảnh lên lần đầu, bạn bấm ô xác nhận:
        </p>
        <blockquote className="rounded-2xl bg-pastel/50 px-4 py-3 text-[13.5px] italic">
          Tôi đã đọc điều khoản sử dụng và chính sách quyền riêng tư, và xác nhận toàn bộ ảnh
          tôi gửi lên là của tôi hoặc tôi có quyền chia sẻ.
        </blockquote>
        <p>
	Ô xác nhận này <strong>không</strong> phải cơ chế pháp lý thay thế điều khoản — nó
          tạo ra một bước bắt buộc để mọi người thật sự đọc trước khi tải nội dung lên dịch vụ.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-[16px]">5. Quyền của bạn</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Truy cập & tải về:</strong> mọi ảnh đã tải lên, bạn tải về nguyên bản
            bất cứ lúc nào.
          </li>
          <li>
            <strong>Xoá:</strong> xoá từng ảnh hoặc cả album. Xoá là vĩnh viễn — không khôi
            phục được.
          </li>
          <li>
            <strong>Yêu cầu xoá tài khoản:</strong> gửi email tới{" "}
            <a href="mailto:koishykana@gmail.com" className="text-rose-text underline underline-offset-2">
              koishykana@gmail.com
            </a>
            , tôi sẽ xoá toàn bộ dữ liệu gắn với tài khoản của bạn trong vòng 7 ngày.
          </li>
          <li>
            <strong>Rút lại liên kết chia sẻ:</strong> thu hồi bất cứ lúc nào, hiệu lực ngay
            lập tức.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-[16px]">6. Bảo mật</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Mật khẩu được băm (bcrypt/Supabase Auth), không lưu dạng văn bản thô trong bộ
            nhớ sau buổi làm việc.
          </li>
          <li>Mọi request chạy HTTPS.</li>
          <li>Token chia sẻ chỉ lưu bản băm SHA-256 — mất DB cũng không lộ token.</li>
          <li>Signed URL hết hạn theo thời gian thực, ràng buộc một ảnh cụ thể.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-[16px]">7. Dịch vụ bên thứ ba</h2>
        <p>Cloudey chạy trên hai dịch vụ bên thứ ba, mỗi bên xử lý dữ liệu như sau:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Supabase</strong> (lưu trữ Postgres + Storage + Auth): xử lý dữ liệu nêu ở
            mục 2. Chi tiết chính sách riêng tư của Supabase:{" "}
            <a
              href="https://supabase.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-rose-text underline underline-offset-2"
            >
              supabase.com/privacy
            </a>
          </li>
          <li>
            <strong>Netlify</strong> (hosting trang web): phục vụ tệp HTML/CSS/JS, không lưu
            ảnh của bạn.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-[16px]">8. Thay đổi chính sách</h2>
        <p>
          Chính sách này có thể được cập nhật. Lần cập nhật quan trọng sẽ được ghi chú trên
          trang này.
        </p>
      </section>

      <footer className="border-t border-line/60 pt-4 text-[12.5px] text-ink-soft">
        <Link
          to="/"
          className="text-rose-text underline underline-offset-2 transition-colors hover:text-ink"
        >
          ← Về trang chủ
        </Link>
      </footer>
    </article>
  );
}
