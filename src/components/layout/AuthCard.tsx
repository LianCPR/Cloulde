import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { Wordmark } from "./Wordmark";

/** Khung trang xác thực — bố cục gọn, tập trung vào một hành động duy nhất. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center py-6 sm:py-12">
      <Link to="/" className="mx-auto mb-6 inline-flex" aria-label="Cloudey — về trang chủ">
        <Wordmark />
      </Link>

      <div className="rounded-3xl border border-line bg-warm/90 px-5 py-7 shadow-soft sm:px-7 sm:py-8">
        <h1 className="font-display text-2xl leading-tight">{title}</h1>
        {subtitle ? (
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{subtitle}</p>
        ) : null}
        <div className="mt-6">{children}</div>
      </div>

      {footer ? (
        <div className="mt-5 text-center text-[13px] text-ink-soft">{footer}</div>
      ) : null}
    </div>
  );
}
