import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { UserPlus } from "lucide-react";
import { AuthCard } from "@/components/layout/AuthCard";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { useAuth } from "@/context/AuthContext";
import { describeError } from "@/services/errors";
import { toastSuccess } from "@/components/ui/Toast";

const schema = z
  .object({
    displayName: z.string().trim().max(60, "Tên hiển thị tối đa 60 ký tự.").optional(),
    email: z.string().trim().min(1, "Hãy nhập email.").email("Email chưa đúng định dạng."),
    password: z
      .string()
      .min(8, "Mật khẩu tối thiểu 8 ký tự để bảo vệ kho ảnh của bạn.")
      .max(72, "Mật khẩu tối đa 72 ký tự."),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    path: ["confirm"],
    message: "Hai mật khẩu chưa khớp nhau.",
  });

type FormValues = z.infer<typeof schema>;

export function SignupPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { displayName: "", email: "", password: "", confirm: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await signUp(values.email, values.password, values.displayName?.trim() || undefined);
      toastSuccess("Tài khoản đã sẵn sàng", "Hãy tạo album đầu tiên và tải ảnh lên.");
      navigate("/", { replace: true });
    } catch (caught) {
      setError(describeError(caught));
    }
  });

  return (
    <AuthCard
      title="Tạo tài khoản Cloudey"
      subtitle="Miễn phí để bắt đầu. Ảnh gốc của bạn được lưu nguyên vẹn và chỉ mình bạn quyết định ai xem được."
      footer={
        <>
          Đã có tài khoản?{" "}
          <Link to="/login" className="font-medium text-rose-text underline underline-offset-2">
            Đăng nhập
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <TextField
          label="Tên hiển thị (không bắt buộc)"
          placeholder="Ví dụ: Minh Anh"
          autoComplete="name"
          error={errors.displayName?.message ?? null}
          {...register("displayName")}
        />
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
          autoComplete="new-password"
          required
          hint="Tối thiểu 8 ký tự. Nên dùng mật khẩu riêng cho Cloudey."
          error={errors.password?.message ?? null}
          {...register("password")}
        />
        <TextField
          label="Nhập lại mật khẩu"
          type="password"
          autoComplete="new-password"
          required
          error={errors.confirm?.message ?? null}
          {...register("confirm")}
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
          icon={<UserPlus className="size-4" aria-hidden />}
        >
          Tạo tài khoản
        </Button>

        <p className="text-[11.5px] leading-relaxed text-ink-soft">
          Mật khẩu không bao giờ được lưu trong cơ sở dữ liệu của Cloudey — Supabase Auth quản lý
          riêng phần xác thực.
        </p>
      </form>
    </AuthCard>
  );
}
