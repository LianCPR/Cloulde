import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { AppHeader } from "./AppHeader";
import { Sidebar } from "./Sidebar";
import { MobileNavigation } from "./MobileNavigation";
import { CloudBackdrop } from "@/components/ui/CloudBackdrop";
import { ErrorBoundary } from "@/components/system/ErrorBoundary";
import { BackendNotice } from "@/components/system/BackendNotice";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import { pageVariants, pageVariantsReduced } from "@/lib/motion";
import { isGuestPath } from "@/lib/appRoutes";

const SIDEBAR_KEY = "cloude-sidebar-open";

/**
 * Khung ứng dụng: nền trang trí, header dính, thanh bên (desktop), điều hướng
 * dưới (mobile), và vùng nội dung có chuyển trang nhẹ nhàng.
 */
export function AppShell() {
  const location = useLocation();
  const reduced = usePrefersReducedMotion();
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(SIDEBAR_KEY) !== "false";
  });

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_KEY, String(sidebarOpen));
  }, [sidebarOpen]);

  // Cuộn lên đầu khi đổi trang, tránh rơi vào giữa nội dung mới.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }, [location.pathname, reduced]);

  /**
   * Trang của khách (liên kết chia sẻ): chỉ hiển thị album, không hiển thị bất
   * kỳ thứ gì thuộc về chủ kho.
   *
   * Không có thanh bên (danh sách album của chủ kho), không có điều hướng dưới
   * (Tải ảnh / Cài đặt / Tài khoản — đều là việc của chủ kho), và đặc biệt không
   * có thông báo "chưa kết nối kho lưu trữ": câu đó bảo khách đi dán token chủ
   * kho, đúng thứ mà họ không cần và không thể có.
   */
  const guest = isGuestPath(location.pathname);

  return (
    <div className="relative min-h-[100dvh]">
      <CloudBackdrop />
      <a
        href="#noi-dung-chinh"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-warm focus:px-4 focus:py-2 focus:text-sm focus:shadow-float"
      >
        Bỏ qua điều hướng, tới nội dung chính
      </a>

      <AppHeader
        guest={guest}
        onToggleSidebar={guest ? undefined : () => setSidebarOpen((value) => !value)}
        sidebarOpen={sidebarOpen}
      />
      {guest ? null : <BackendNotice />}

      <div className="mx-auto flex w-full max-w-[110rem]">
        {guest ? null : <Sidebar open={sidebarOpen} />}
        <main id="noi-dung-chinh" className="min-w-0 flex-1 px-4 pb-28 pt-6 sm:px-6 sm:pt-8 md:pb-16">
          <ErrorBoundary>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                variants={reduced ? pageVariantsReduced : pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </ErrorBoundary>
        </main>
      </div>

      {guest ? null : <MobileNavigation />}
    </div>
  );
}
