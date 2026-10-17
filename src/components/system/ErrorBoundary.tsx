import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Props {
  children: ReactNode;
  /** Nội dung thay thế khi có lỗi; nếu không truyền thì dùng mặc định. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Ranh giới lỗi: một component hỏng không được làm sập toàn bộ ứng dụng.
 * Người dùng luôn có đường thoát (tải lại hoặc quay về thư viện).
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Ghi log đầy đủ để chẩn đoán; không hiển thị stack cho người dùng.
    console.error("Lỗi giao diện:", error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div
        role="alert"
        className="rounded-3xl border border-danger/25 bg-warm px-6 py-12 text-center"
      >
        <h2 className="font-display text-xl">Có gì đó chưa đúng</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">
          Giao diện gặp lỗi không mong đợi. Ảnh và album của bạn vẫn an toàn —
          hãy thử tải lại khu vực này.
        </p>
        <p className="mx-auto mt-3 max-w-md break-words rounded-xl bg-blush/50 px-3 py-2 text-[12px] text-ink-soft">
          {error.message}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} onClick={this.reset}>
            Thử lại
          </Button>
          <Button variant="ghost" onClick={() => window.location.assign("/")}>
            Về thư viện
          </Button>
        </div>
      </div>
    );
  }
}
