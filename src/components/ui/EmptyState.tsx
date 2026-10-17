import type { ReactNode } from "react";
import { motion } from "motion/react";
import { CloudOff, ImageOff, RefreshCw } from "lucide-react";
import { Button } from "./Button";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";

/** Minh hoạ mây nhẹ nhàng, không gây rối mắt. */
function CloudIllustration() {
  const reduced = usePrefersReducedMotion();
  return (
    <motion.div
      aria-hidden
      className="relative mx-auto mb-5 h-24 w-40"
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: reduced ? 0.01 : 0.5 }}
    >
      <div className="absolute inset-x-4 bottom-6 h-14 rounded-full bg-blush/80" />
      <div className="absolute left-9 bottom-10 size-16 rounded-full bg-pastel/90" />
      <div className="absolute right-7 bottom-9 size-12 rounded-full bg-beige/80" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-line" />
      {!reduced ? (
        <motion.div
          className="absolute right-2 top-1 size-3 rounded-full bg-rose/60"
          animate={{ y: [0, -5, 0] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : null}
    </motion.div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  showIllustration = true,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  showIllustration?: boolean;
}) {
  return (
    <div className="rounded-3xl border border-line bg-warm/70 px-6 py-14 text-center">
      {showIllustration ? <CloudIllustration /> : null}
      <h3 className="text-base font-semibold sm:text-lg">{title}</h3>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Không tải được nội dung",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-3xl border border-danger/25 bg-warm px-6 py-12 text-center"
    >
      <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-danger/10 text-danger">
        {onRetry ? <CloudOff className="size-5" aria-hidden /> : <ImageOff className="size-5" aria-hidden />}
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">
          {description}
        </p>
      ) : null}
      {onRetry ? (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} onClick={onRetry}>
            Thử lại
          </Button>
        </div>
      ) : null}
    </div>
  );
}
