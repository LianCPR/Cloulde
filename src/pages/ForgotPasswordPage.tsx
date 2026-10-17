import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MailCheck } from "lucide-react";
import { AuthCard } from "@/components/layout/AuthCard";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { useAuth } from "@/context/AuthContext";
import { describeError } from "@/services/errors";

const schema = z.object({
  email: z.string().trim().min(1, "Hãy nhập email.").email("Email chưa đúng định dạng."),
});

type FormValues = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await requestPasswordReset(values.email);
      setSent(true);
    } catch (caught) {
      setError(describeError(caught));
    }
  });

  return (
    <AuthCard
      title="Đặt lại mật khẩu"
      subtitle="Nhập email của tài khoản, chúng tôi sẽ gửi liên kết để bạn đặt mật khẩu mới."
      footer={
        <Link to="/login" className="font-medium text-rose-text underline underline-offset-2">
          Quay lại đăng nhập
        </Link>
      }
    >
      {sent ? (
        <div className="space-y-4">
          <p className="flex gap-2 rounded-2xl bg-pastel/60 px-3.5 py-3 text-[13px] leading-relaxed text-ink">
            <MailCheck className="mt-0.5 size-4 shrink-0 text-rose-text" aria-hidden />
            Nếu email này có tài khoản, bạn sẽ nhận được liên kết đặt lại mật khẩu trong vài phút.
            Hãy kiểm tra cả thư mục spam.
          </p>
          <Button className="w-full" variant="secondary" onClick={() => setSent(false)}>
            Dùng email khác
          </Button>
        </div>
      ) : (
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
          {error ? (
            <p role="alert" className="rounded-2xl border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-[12.5px] text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" loading={isSubmitting} className="w-full" size="lg">
            Gửi liên kết đặt lại
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
