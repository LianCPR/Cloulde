import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound } from "lucide-react";
import { AuthCard } from "@/components/layout/AuthCard";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { useAuth } from "@/context/AuthContext";
import { describeError } from "@/services/errors";
import { toastSuccess } from "@/components/ui/Toast";

const schema = z
  .object({
    password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự."),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    path: ["confirm"],
    message: "Hai mật khẩu chưa khớp nhau.",
  });

type FormValues = z.infer<typeof schema>;

/**
 * Trang đặt lại mật khẩu.
 * Supabase chuyển hướng tới đây kèm token trong URL (luồng PKCE); SDK tự xử lý
 * token đó, sau đó người dùng chỉ cần nhập mật khẩu mới.
 */
export function ResetPasswordPage() {
  const { updatePassword, user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await updatePassword(values.password);
      toastSuccess("Đã cập nhật mật khẩu", "Bạn có thể dùng mật khẩu mới từ lần đăng nhập tới.");
      navigate("/", { replace: true });
    } catch (caught) {
      setError(describeError(caught));
    }
  });

  return (
    <AuthCard
      title="Mật khẩu mới"
      subtitle={
        user
          ? `Đặt mật khẩu mới cho ${user.email}.`
          : "Mở liên kết trong email đặt lại mật khẩu, sau đó đặt mật khẩu mới tại đây."
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <TextField
          label="Mật khẩu mới"
          type="password"
          autoComplete="new-password"
          required
          error={errors.password?.message ?? null}
          {...register("password")}
        />
        <TextField
          label="Nhập lại mật khẩu mới"
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
          icon={<KeyRound className="size-4" aria-hidden />}
        >
          Cập nhật mật khẩu
        </Button>
      </form>
    </AuthCard>
  );
}
