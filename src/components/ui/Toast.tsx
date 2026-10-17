import { Toaster as SonnerToaster, toast } from "sonner";
import { describeError } from "@/services/errors";
import { announce } from "./LiveRegion";

/**
 * Thông báo nhanh (toast), đã việt hoá và nối với vùng aria-live.
 * Chọn `sonner` vì nhẹ, hỗ trợ xếp chồng, tự dọn và không cần provider.
 */

export function AppToaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      offset={16}
      gap={10}
      duration={4200}
      visibleToasts={3}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-start gap-3 rounded-2xl border border-line bg-cloud/95 px-4 py-3 text-sm text-ink shadow-[0_10px_30px_rgb(81_67_75/0.12)] backdrop-blur",
          title: "font-medium leading-snug",
          description: "text-ink-soft leading-snug",
          actionButton:
            "ml-auto rounded-full bg-pastel px-3 py-1 text-xs font-medium text-rose-text hover:bg-rose/30 transition-colors",
          cancelButton:
            "ml-auto rounded-full px-3 py-1 text-xs font-medium text-ink-soft hover:text-ink",
        },
      }}
    />
  );
}

export function toastSuccess(message: string, description?: string): void {
  toast.success(message, description ? { description } : undefined);
  announce(description ? `${message}. ${description}` : message);
}

export function toastError(messageOrError: unknown, description?: string): void {
  const message =
    typeof messageOrError === "string" ? messageOrError : describeError(messageOrError);
  toast.error(message, description ? { description } : undefined);
  announce(`Lỗi: ${message}`, "assertive");
}

export function toastInfo(message: string, description?: string): void {
  toast(message, description ? { description } : undefined);
}

export function toastPromise<T>(
  promise: Promise<T>,
  messages: { loading: string; success: string | ((value: T) => string); error: string },
): Promise<T> {
  toast.promise(promise, messages);
  return promise;
}

export { toast };
