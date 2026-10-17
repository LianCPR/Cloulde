import { Link } from "react-router-dom";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/Button";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl py-10">
      <EmptyState
        title="Trang này không tồn tại"
        description="Đường dẫn có thể đã đổi hoặc bị gõ sai. Bạn vẫn có thể quay về thư viện album của mình."
        action={<LinkButton to="/">Về thư viện</LinkButton>}
      />
      <p className="mt-4 text-center text-[12.5px] text-ink-soft">
        Nếu bạn vừa mở một liên kết chia sẻ, hãy kiểm tra lại xem liên kết có bị cắt ngắn khi dán
        không.{" "}
        <Link to="/settings" className="text-rose-text underline underline-offset-2">
          Quản lý liên kết chia sẻ
        </Link>
      </p>
    </div>
  );
}
