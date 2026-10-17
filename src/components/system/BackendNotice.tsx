import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import { motion } from "motion/react";
import { getBackend } from "@/services/backend";
import { useAuth } from "@/context/AuthContext";
import { uploadLimitBytes } from "@/config/env";
import { formatBytes } from "@/lib/format";

const DISMISS_KEY = "cloude-backend-notice-dismissed";

/**
 * Thông báo thiết lập — thay vì trắng trang khi thiếu cấu hình.
 *
 * Yêu cầu: "Nếu thiếu thông tin xác thực, hãy triển khai tích hợp và giải thích
 * rõ cách cấu hình. Cung cấp trạng thái phát triển an toàn hiển thị thông báo
 * hướng dẫn thay vì bị sập."
 */
export function BackendNotice() {
  const backend = getBackend();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(DISMISS_KEY) === "true";
  });
  const reduced = usePrefersReducedMotion();
  const { user } = useAuth();

  // Supabase đã cấu hình: không cần nhắc gì.
  if (backend.mode === "supabase" || dismissed) return null;

  // Chế độ kho lưu trữ: chỉ im lặng khi ĐÃ có danh tính chủ kho xác thực được.
  //
  // Cố tình KHÔNG dùng "đã lưu kết nối" làm điều kiện: một kết nối đã lưu vẫn
  // có thể hỏng (token bị thay, bị thu hồi, hết hiệu lực). Khi đó người dùng
  // đã bị đăng xuất nhưng lại KHÔNG thấy lời nhắc nào — họ chỉ thấy trang chủ
  // và không hiểu vì sao ảnh của mình biến mất.
  if (backend.mode === "archive") {
    if (user) return null;
    return (
      <Banner
        reduced={reduced}
        onDismiss={() => {
          window.sessionStorage.setItem(DISMISS_KEY, "true");
          setDismissed(true);
        }}
        title="Chưa kết nối kho lưu trữ"
        body={
          <>
            Ứng dụng đang chạy ở chế độ kho lưu trữ nhưng chưa có danh tính chủ kho. Mở{" "}
            <a href="/connect" className="font-medium text-rose-text underline underline-offset-2">
              Kết nối kho lưu trữ
            </a>{" "}
            để dán token chủ kho, hoặc đặt một Cloudflare Access trước Worker rồi tải lại trang.
          </>
        }
        footnote={`Trần mỗi tệp: ${formatBytes(uploadLimitBytes)} · không có hạn mức dung lượng hay số ảnh do ứng dụng đặt.`}
      />
    );
  }

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-b border-warning/30 bg-beige/60"
      role="status"
    >
      <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-3 text-[13px] sm:px-6">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">Chưa cấu hình Supabase — đang chạy chế độ demo cục bộ</p>
          <p className="mt-1 leading-relaxed text-ink-soft">
            Mọi tính năng đều dùng được (tạo album, tải ảnh, tải xuống ảnh gốc, chia sẻ), nhưng dữ
            liệu chỉ nằm trong trình duyệt này và mất khi bạn xoá dữ liệu trang. Để lưu trữ thật,
            hãy tạo tệp <code className="rounded bg-warm px-1 py-0.5 text-[12px]">.env.local</code>{" "}
            với <code className="rounded bg-warm px-1 py-0.5 text-[12px]">VITE_SUPABASE_URL</code> và{" "}
            <code className="rounded bg-warm px-1 py-0.5 text-[12px]">VITE_SUPABASE_ANON_KEY</code>{" "}
            (xem <code className="rounded bg-warm px-1 py-0.5 text-[12px]">.env.example</code>), rồi
            chạy migration trong <code className="rounded bg-warm px-1 py-0.5 text-[12px]">supabase/migrations</code>.
          </p>
          <p className="mt-1 text-[12px] text-ink-soft">
            Giới hạn mỗi ảnh: {formatBytes(uploadLimitBytes)} · Hạn mức gói Supabase Free: 1GB lưu
            trữ và 50MB/tệp.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            window.sessionStorage.setItem(DISMISS_KEY, "true");
            setDismissed(true);
          }}
          aria-label="Ẩn thông báo thiết lập"
          className="grid size-8 shrink-0 place-items-center rounded-full text-ink-soft transition-colors hover:bg-warm hover:text-ink"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </motion.div>
  );
}

/** Khung thông báo dùng chung cho các chế độ — tránh lặp lại bố cục. */
function Banner({
  reduced,
  onDismiss,
  title,
  body,
  footnote,
}: {
  reduced: boolean;
  onDismiss: () => void;
  title: string;
  body: React.ReactNode;
  footnote: string;
}) {
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-b border-warning/30 bg-beige/60"
      role="status"
    >
      <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-3 text-[13px] sm:px-6">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{title}</p>
          <p className="mt-1 leading-relaxed text-ink-soft">{body}</p>
          <p className="mt-1 text-[12px] text-ink-soft">{footnote}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Ẩn thông báo thiết lập"
          className="grid size-8 shrink-0 place-items-center rounded-full text-ink-soft transition-colors hover:bg-warm hover:text-ink"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </motion.div>
  );
}
