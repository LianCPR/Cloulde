import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { KeyRound, Link2, ShieldCheck, TriangleAlert } from "lucide-react";
import { AuthCard } from "@/components/layout/AuthCard";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { ARCHIVE_URL } from "@/config/env";
import { useAuth } from "@/context/AuthContext";
import { archiveConnection } from "@/services/archive/archiveBackend";
import { describeError } from "@/services/errors";
import { toastSuccess } from "@/components/ui/Toast";
import { formatBytes } from "@/lib/format";

/**
 * Màn hình kết nối kho lưu trữ.
 *
 * Kho lưu trữ là một Worker Cloudflare do CHÍNH BẠN triển khai, giữ khoá R2 và
 * nói chuyện với nó. Trình duyệt chỉ cần biết danh tính chủ kho, theo một trong
 * hai cách:
 *
 *   1. Cloudflare Access đứng trước Worker (khuyến nghị): trình duyệt gửi cookie
 *      do Access cấp, không có khoá nào trong JavaScript. Ở cách này để trống ô
 *      token.
 *   2. Token chủ kho: dán một lần, lưu trong localStorage của chính origin này.
 *      Nhanh để bắt đầu, nhưng bất kỳ script nào chạy trên cùng origin cũng đọc
 *      được — vì vậy cách 1 là lựa chọn nên dùng cho môi trường thật.
 *
 * Ở CẢ HAI cách: khoá truy cập R2 (access key, secret) KHÔNG BAO GIỜ xuất hiện ở
 * phía trình duyệt. Chúng chỉ nằm trong Worker.
 */
export function ArchiveConnectPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const existing = archiveConnection.current();

  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? ARCHIVE_URL);
  const [token, setToken] = useState(existing?.token ?? "");
  const [label, setLabel] = useState(existing?.label ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const connect = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const result = await archiveConnection.connect({
        baseUrl,
        token: token.trim() ? token.trim() : null,
        label: label.trim() ? label.trim() : null,
      });
      await refresh();
      toastSuccess(
        "Đã kết nối kho lưu trữ",
        `Danh tính chủ kho ${result.ownerId.slice(0, 12)}… · driver ${result.driver}`,
      );
      navigate("/", { replace: true });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Kết nối kho lưu trữ"
      subtitle="Cloudé trò chuyện với Worker Cloudflare của bạn. Khoá truy cập R2 không bao giờ rời khỏi Worker."
      footer={
        <>
          Chưa triển khai? Xem hướng dẫn trong{" "}
          <code className="rounded bg-blush px-1">README.md</code> và{" "}
          <code className="rounded bg-blush px-1">docs/kho-luu-tru.md</code>.
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
        noValidate
      >
        <TextField
          label="Địa chỉ Worker"
          placeholder="https://kho.example.com"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          hint="Để trống nếu Worker phục vụ luôn trang này (cùng origin) — cách này tránh mọi vấn đề CORS."
        />

        <TextField
          label="Token chủ kho (không bắt buộc)"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Để trống nếu dùng Cloudflare Access"
          hint="Đặt bằng: npx wrangler secret put ARCHIVE_TOKEN trong thư mục worker/."
        />

        <TextField
          label="Nhãn hiển thị (không bắt buộc)"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Ví dụ: Kho ảnh gốc"
        />

        {error ? (
          <p
            role="alert"
            className="rounded-2xl border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-[12.5px] text-danger"
          >
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          loading={submitting}
          size="lg"
          className="w-full"
          icon={<Link2 className="size-4" aria-hidden />}
        >
          Kiểm tra và kết nối
        </Button>

        <p className="text-center text-[11.5px] leading-relaxed text-ink-soft">
          Nút này thử GHI – ĐỌC – XOÁ một object thật trên bucket. Kết nối chỉ được lưu khi phép thử
          đó thành công, nên không bao giờ có cấu hình “xanh” mà thực ra hỏng.
        </p>
      </form>

      <div className="mt-6 space-y-3 rounded-2xl bg-beige/60 px-3.5 py-3.5 text-[12px] leading-relaxed text-ink-soft">
        <p className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
          <span>
            <strong className="text-ink">Không có khoá nhà cung cấp ở đây.</strong> Trình duyệt chỉ
            gửi danh tính chủ kho; Worker giữ khoá R2 (hoặc dùng binding, khi đó không có khoá nào
            cả) và tự thực hiện mọi thao tác lưu trữ.
          </span>
        </p>
        <p className="flex items-start gap-2">
          <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <strong className="text-ink">Token được lưu cục bộ</strong> trong localStorage của origin
            này và chỉ gửi tới Worker của bạn. Nếu origin bị chèn mã độc, token có thể bị đọc — dùng
            Cloudflare Access để tránh hẳn.
          </span>
        </p>
        <p className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-rose-text" aria-hidden />
          <span>
            Không có hạn mức dung lượng hay số ảnh do ứng dụng đặt. Trần thực tế là gói Cloudflare,
            trạng thái tài khoản và phương thức thanh toán của bạn; trần kỹ thuật mỗi tệp khoảng{" "}
            {formatBytes(64 * 1024 * 1024 * 9_999)} do giới hạn của R2, và mỗi request bị Cloudflare
            giới hạn ở 100 MB nên tệp lớn luôn được chia thành nhiều phần.
          </span>
        </p>
      </div>

      <p className="mt-4 text-center text-[12px] text-ink-soft">
        Đã kết nối rồi?{" "}
        <Link to="/settings" className="font-medium text-rose-text underline underline-offset-2">
          Xem sức khoẻ và chi phí trong Cài đặt
        </Link>
      </p>
    </AuthCard>
  );
}
