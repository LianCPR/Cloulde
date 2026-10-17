import { Link } from "react-router-dom";
import { Mail } from "lucide-react";

/**
 * Logo Instagram/Facebook vẽ inline (SVG chính thức thu nhỏ).
 *
 * lucide-react đã bỏ các icon thương hiệu khỏi bộ, nên tôi dùng SVG inline —
 * vừa đúng hình dáng vừa không cần thêm thư viện.
 */
function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

/**
 * Footer toàn cục.
 *
 * Xuất hiện trên mọi trang (kể cả trang của khách xem liên kết chia sẻ) với
 * chữ ký nhẹ, các kênh liên hệ của chủ kho và đường dẫn pháp lý. Credit "Hải
 * Đăng" là con dấu của người dựng sản phẩm — không phải quảng cáo.
 */
export function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-line/70 bg-warm/60 px-4 py-8 sm:px-6">
      <div className="mx-auto flex max-w-[110rem] flex-col gap-6 md:flex-row md:items-start md:justify-between">
        {/* Khối thương hiệu + credit */}
        <div className="space-y-2 md:max-w-sm">
          <p className="font-display text-lg tracking-wide">Cloudey</p>
          <p className="text-[12.5px] leading-relaxed text-ink-soft">
            Cloudey storage lưu ảnh và video của bạn trên đám mây
          </p>
          <p className="text-[12px] text-ink-soft">
            Make by{" "}
            <span className="font-medium text-rose-text">Hải Đăng</span>
          </p>
        </div>

        {/* Pháp lý */}
        <nav aria-label="Thiết lập pháp lý" className="space-y-1.5 text-[13px]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft/70">
            Pháp lý
          </p>
          <Link
            to="/terms"
            className="block text-ink-soft transition-colors hover:text-rose-text hover:underline underline-offset-2"
          >
            Điều khoản sử dụng
          </Link>
          <Link
            to="/privacy"
            className="block text-ink-soft transition-colors hover:text-rose-text hover:underline underline-offset-2"
          >
            Chính sách quyền riêng tư
          </Link>
        </nav>

        {/* Liên hệ */}
        <div className="space-y-1.5 text-[13px]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft/70">
            Liên hệ
          </p>
          <a
            href="https://www.instagram.com/4ang_d/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-ink-soft transition-colors hover:text-rose-text hover:underline underline-offset-2"
          >
            <InstagramIcon className="size-3.5" />
            Instagram
          </a>
          <a
            href="https://www.facebook.com/ethprr"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-ink-soft transition-colors hover:text-rose-text hover:underline underline-offset-2"
          >
            <FacebookIcon className="size-3.5" />
            Facebook
          </a>
          <a
            href="mailto:koishykana@gmail.com"
            className="inline-flex items-center gap-2 text-ink-soft transition-colors hover:text-rose-text hover:underline underline-offset-2"
          >
            <Mail className="size-3.5" aria-hidden />
            Gmail
          </a>
        </div>
      </div>

      <p className="mx-auto mt-6 max-w-[110rem] border-t border-line/60 pt-4 text-[11.5px] text-ink-soft/80">
        © {new Date().getFullYear()} Cloudey all rights reserved
      </p>
    </footer>
  );
}
