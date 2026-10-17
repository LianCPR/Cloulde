import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import { dialogVariants, overlayVariants, sheetVariants } from "@/lib/motion";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** `sheet` trượt từ dưới lên trên mobile — dễ chạm bằng ngón tay. */
  variant?: "center" | "sheet";
  size?: "sm" | "md" | "lg";
  closeOnBackdrop?: boolean;
}

const sizeClasses = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
};

/**
 * Hộp thoại có thể truy cập:
 *  - `role="dialog"` + `aria-modal`, tiêu đề gắn bằng `aria-labelledby`.
 *  - Bẫy tiêu điểm trong hộp thoại, `Esc` để đóng, khoá cuộn nền.
 *  - Khôi phục tiêu điểm về phần tử đã mở hộp thoại khi đóng.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = "center",
  size = "md",
  closeOnBackdrop = true,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const reduced = usePrefersReducedMotion();

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Đưa tiêu điểm vào hộp thoại sau khi animation bắt đầu.
    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      const target =
        panel?.querySelector<HTMLElement>("[data-autofocus]") ??
        panel?.querySelector<HTMLElement>(
          'button:not([disabled]), a[href], input, textarea, select',
        );
      target?.focus();
    }, 60);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = originalOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <motion.div
            variants={overlayVariants}
            className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]"
            onClick={closeOnBackdrop ? onClose : undefined}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            onKeyDown={handleKeyDown}
            variants={reduced ? dialogVariants : variant === "sheet" ? sheetVariants : dialogVariants}
            className={cn(
              "relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden border border-line bg-cloud shadow-float",
              variant === "sheet"
                ? "rounded-t-3xl sm:rounded-3xl"
                : "m-3 rounded-3xl sm:m-0",
              sizeClasses[size],
            )}
          >
            <header className="flex items-start gap-3 border-b border-line px-5 pt-5 pb-4">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-lg font-semibold tracking-tight">
                  {title}
                </h2>
                {description ? (
                  <p id={descriptionId} className="mt-1 text-sm text-ink-soft">
                    {description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Đóng hộp thoại"
                className="-mr-1 -mt-1 grid size-9 shrink-0 place-items-center rounded-full text-ink-soft transition-colors hover:bg-blush hover:text-ink"
              >
                <X className="size-4" aria-hidden />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

            {footer ? (
              <footer className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 pb-safe sm:flex-row sm:justify-end">
                {footer}
              </footer>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
