import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";
type Size = "sm" | "md" | "lg" | "icon";

const base =
  "relative inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-200 ease-out select-none disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose active:scale-[0.98] motion-reduce:active:scale-100";

const variants: Record<Variant, string> = {
  primary:
    "bg-pastel text-rose-text shadow-soft hover:bg-rose/45 hover:shadow-lift hover:-translate-y-[1px] motion-reduce:hover:translate-y-0",
  secondary:
    "border border-line bg-warm text-ink hover:border-rose/45 hover:bg-blush/70 hover:-translate-y-[1px] motion-reduce:hover:translate-y-0",
  soft: "bg-blush/80 text-rose-text hover:bg-pastel",
  ghost: "text-ink-soft hover:bg-blush/70 hover:text-ink",
  danger: "bg-danger/15 text-danger hover:bg-danger/25",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-[13px]",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-[15px]",
  icon: "h-10 w-10 p-0",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], sizes[size], className)}
      {...rest}
    >
      {loading ? (
        <Loader2 aria-hidden className="size-4 animate-spin-slow" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});

export interface LinkButtonProps {
  to: string;
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Nút hoạt động như liên kết (giữ được hành vi bàn phím và mở tab mới). */
export function LinkButton({
  to,
  variant = "primary",
  size = "md",
  icon,
  className,
  children,
}: LinkButtonProps) {
  return (
    <Link
      to={to}
      className={cn(base, variants[variant], sizes[size], className)}
    >
      {icon}
      {children}
    </Link>
  );
}

export function IconButton({
  label,
  className,
  variant = "ghost",
  size = "icon",
  icon,
  ...rest
}: ButtonProps & { label: string }) {
  return (
    <Button
      {...rest}
      variant={variant}
      size={size}
      icon={icon}
      aria-label={label}
      title={label}
      className={className}
    />
  );
}
