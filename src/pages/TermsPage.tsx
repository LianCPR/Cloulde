import { Link } from "react-router-dom";
import { ScrollText } from "lucide-react";

export function TermsPage() {
  return (
    <article className="prose-lg mx-auto max-w-3xl space-y-5 text-[14px] leading-relaxed">
      <header className="space-y-2">
        <ScrollText className="size-8 text-rose-text" aria-hidden />
        <h1 className="font-display text-3xl leading-tight">Điều khoản sử dụng</h1>
        <p className="text-[13px] text-ink-soft">
          Phát hành mới nhất: tháng 10, 2026 · Cloudey (cloudey.netlify.app)
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="font-semibold text-[16px]">1. Cloudey là gì?</h2>
        <p>
          Cloudey là dịch vụ lưu trữ và chia sẻ ảnh trực tuyến cho phép bạn: tải ảnh gốc lên, sắp
          xếp theo album và chia sẻ bằng liên kết riêng tư. Dịch vụ không nén lại, không chuyển
          đổi hoặc chỉnh sửa ảnh gốc của bạn.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-[16px]">2. Tài khoản của bạn</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Bạn cần một địa chỉ email hợp lệ để tạo tài khoản.</li>
          <li>
            Bạn chịu trách nhiệm giữ mật khẩu an toàn. Mọi hành động thực hiện qua tài khoản của
            bạn được coi là của bạn.
          </li>
          <li>
            Độ tuổi tối thiểu: đủ điều kiện sử dụng dịch vụ trực tuyến theo pháp luật nơi bạn
            sinh sống.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-[16px]">3. Nội dung của bạn</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Toàn bộ ảnh bạn tải lên thuộc quyền sở hữu của bạn. Cloudey{" "}
            <strong>không</strong> sử dụng ảnh của bạn để đào tạo mô hình, không bán, không chia
            sẻ cho bên thứ ba.
          </li>
          <li>
            Bạn chịu trách nhiệm đảm bảo ảnh bạn tải lên là hợp pháp và bạn có quyền chia
            sẻ/cất giữ chúng (ví dụ: không vi phạm bản quyền, không nội dung bất pháp).
          </li>
          <li>
            Cloudey chỉ lưu ảnh theo yêu cầu của bạn. Việc bạn tải ảnh lên không tạo ra cho
            Cloudey bất kỳ quyền sở hữu nào với nội dung đó.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-[16px]">4. Chia sẻ liên kết</h2>
        <p>
          Khi tạo một liên kết chia sẻ, Cloudey cấp quyền cho người mở liên kết đó{" "}
          <strong>xem và/hoặc tải xuống</strong> ảnh trong album (theo lựa chọn của bạn). Tuy
          nhiên:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Liên kết được bảo vệ bằng mật khẩu (nếu bạn đặt) hoặc bằng token bí mật.</li>
          <li>
            Bất cứ ai có liên kết (và mật khẩu nếu có) đều xem được ảnh trong album đó, đến khi
            bạn thu hồi.
          </li>
          <li>
            <strong>Đừng chia sẻ liên kết với người bạn không muốn cho xem ảnh.</strong> Đối với
            liên kết không mật khẩu, ai có liên kết là xem được.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-[16px]">5. Sử dụng hợp lý</h2>
        <p>Dịch vụ không cho phép:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Tải lên nội dung bất hợp pháp, xâm phạm quyền của người khác</li>
          <li>Sử dụng dịch vụ để phát tán nội dung spam, quấy rối hoặc thương mại không phép</li>
          <li>
            Cố tình quá tải hệ thống, hack, khai thác lỗ hổng, xâm phạm dữ liệu của người dùng
            khác
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-[16px]">6. Miễn trừ và giới hạn trách nhiệm</h2>
        <p>
          Cloudey nỗ lực cao nhất để bảo vệ dữ liệu của bạn (checksum SHA-256 cho từng tệp, đề
          phòng trùng lặp, liên kết chia sẻ có kiểm soát). Tuy nhiên dịch vụ được cung cấp
          "nguyên trạng", nghĩa là:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Cloudey không bảo đảm dịch vụ sẽ liên tục không có gián đoạn.</li>
          <li>
            Cloudey không chịu trách nhiệm với thiệt hại gián tiếp phát sinh từ việc mất dữ liệu
            hay ngừng hoạt động.
          </li>
          <li>
            Bạn <strong>nên giữ bản sao ảnh gốc</strong> ở nơi khác. Cloudey là bản sao lưu
            tiện lợi, không phải phương án lưu trữ duy nhất của bạn.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-[16px]">7. Thay đổi điều khoản</h2>
        <p>
          Điều khoản này có thể được cập nhật. Thay đổi quan trọng sẽ được thông báo trên trang
          này với ngày phát hành mới. Việc tiếp tục sử dụng dịch vụ sau khi điều khoản thay đổi
          đồng nghĩa với việc bạn chấp nhận các thay đổi đó.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-[16px]">8. Liên hệ</h2>
        <p>
          Mọi câu hỏi về điều khoản này xin gửi về{" "}
          <a href="mailto:koishykana@gmail.com" className="text-rose-text underline underline-offset-2">
            koishykana@gmail.com
          </a>{" "}
          hoặc qua{" "}
          <a
            href="https://www.instagram.com/4ang_d/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-rose-text underline underline-offset-2"
          >
            Instagram
          </a>
          .
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
