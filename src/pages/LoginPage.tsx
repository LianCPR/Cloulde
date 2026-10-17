import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { LogIn } from "lucide-react";
import { AuthCard } from "@/components/layout/AuthCard";
import { ArchiveConnectPage } from "./ArchiveConnectPage";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { useAuth } from "@/context/AuthContext";
import { describeError } from "@/services/errors";
import { getBackend } from "@/services/backend";
import { toastSuccess } from "@/components/ui/Toast";

const schema = z.object({
  email: z.string().trim().min(1, "Hãy nhập email.").email("Email chưa đúng định dạng."),
  password: z.string().min(6, "Mật khẩu tối thiểu 6 ký tự."),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { signIn, user, initializing } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const isDemo = getBackend().mode === "local";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  // Chế độ kho lưu trữ không có email/mật khẩu: danh tính chủ kho đến từ token
  // hoặc Cloudflare Access. Hiển thị màn hình kết nối thay vì biểu mẫu đăng nhập
  // (đặt sau tất cả các hook để không phá thứ tự hook).
  const archiveMode = getBackend().mode === "archive";

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await signIn(values.email, values.password);
      toastSuccess("Đăng nhập thành công");
      const params = new URLSearchParams(location.search);
      const next = params.get("next");
      navigate(next && next.startsWith("/") ? next : "/", { replace: true });
    } catch (caught) {
      setError(describeError(caught));
    }
  });

  if (archiveMode) return <ArchiveConnectPage />;

  // Đã đăng nhập mà tới /login (ví dụ bấm tab "Tài khoản"): chuyển thẳng
  // sang trang cài đặt — nơi có thông tin tài khoản và nút đăng xuất —
  // thay vì hỏi lại mật khẩu. Chờ phiên được đọc xong rồi mới quyết định
  // để không đá người dùng ra giữa chừng khi vừa mở trang.
  if (!initializing && user) return <Navigate to="/settings" replace />;

  return (
    <AuthCard
      title="Chào mừng trở lại"
      subtitle="Đăng nhập để tiếp tục quản lý kho ảnh gốc của bạn."
      footer={
        <>
          Chưa có tài khoản?{" "}
          <Link to="/signup" className="font-medium text-rose-text underline underline-offset-2">
            Tạo tài khoản
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          error={errors.email?.message ?? null}
          {...register("email")}
        />
        <TextField
          label="Mật khẩu"
          type="password"
          autoComplete="current-password"
          required
          error={errors.password?.message ?? null}
          {...register("password")}
        />

        {error ? (
          <p role="alert" className="rounded-2xl border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-[12.5px] text-danger">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          loading={isSubmitting}
          className="w-full"
          size="lg"
          icon={<LogIn className="size-4" aria-hidden />}
        >
          Đăng nhập
        </Button>

        <Link
          to="/forgot-password"
          className="block text-center text-[12.5px] text-ink-soft hover:text-ink"
        >
          Quên mật khẩu?
        </Link>
      </form>

      {isDemo ? (
        <p className="mt-5 rounded-2xl bg-beige/60 px-3.5 py-3 text-[12px] leading-relaxed text-ink-soft">
          Đang ở chế độ demo cục bộ: tài khoản được tạo và lưu ngay trong trình duyệt này (mật khẩu
          vẫn được băm bằng PBKDF2). Cấu hình Supabase để dùng tài khoản thật.
        </p>
      ) : null}
    </AuthCard>
  );
}
