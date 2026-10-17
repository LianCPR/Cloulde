import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "@/app/router";
import { AuthProvider } from "@/context/AuthContext";
import { AppToaster } from "@/components/ui/Toast";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { ErrorBoundary } from "@/components/system/ErrorBoundary";

/**
 * Gốc ứng dụng:
 *  - `BrowserRouter` cho điều hướng phía client (Vercel đã cấu hình rewrite về index.html).
 *  - `AuthProvider` bọc toàn bộ để mọi trang dùng chung một nguồn chân lý về phiên đăng nhập.
 *  - `LiveRegion` đảm bảo tiến độ tải lên/tải xuống được đọc cho người dùng trình đọc màn hình.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
      <AppToaster />
      <LiveRegion />
    </ErrorBoundary>
  );
}
