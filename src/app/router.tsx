import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, type RouteObject } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Bảng tuyến đường.
 *
 * Mọi trang đều được lazy-load (React.lazy + code-splitting của Vite): bundle
 * ban đầu chỉ còn khung ứng dụng, mỗi trang là một tệp JS nhỏ tải song song
 * khi người dùng bấm tới. Suspense fallback là bộ xương nhẹ để trang xuất
 * hiện gần như ngay lập tức thay vì trắng trang chờ tải.
 *
 * `/share/:shareToken` cố ý nằm trong cùng khung giao diện nhưng luôn xác minh
 * quyền ở phía backend trước khi hiển thị bất kỳ dữ liệu nào.
 */

const HomePage = lazy(() => import("@/pages/HomePage").then((m) => ({ default: m.HomePage })));
const AlbumPage = lazy(() => import("@/pages/AlbumPage").then((m) => ({ default: m.AlbumPage })));
const SharedAlbumPage = lazy(() =>
  import("@/pages/SharedAlbumPage").then((m) => ({ default: m.SharedAlbumPage })),
);
const LoginPage = lazy(() => import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const ArchiveConnectPage = lazy(() =>
  import("@/pages/ArchiveConnectPage").then((m) => ({ default: m.ArchiveConnectPage })),
);
const SignupPage = lazy(() => import("@/pages/SignupPage").then((m) => ({ default: m.SignupPage })));
const ForgotPasswordPage = lazy(() =>
  import("@/pages/ForgotPasswordPage").then((m) => ({ default: m.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import("@/pages/ResetPasswordPage").then((m) => ({ default: m.ResetPasswordPage })),
);
const SettingsPage = lazy(() =>
  import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const UploadPage = lazy(() => import("@/pages/UploadPage").then((m) => ({ default: m.UploadPage })));
const NotFoundPage = lazy(() =>
  import("@/pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })),
);

/**
 * Prefetch toàn bộ chunk trang lúc CPU rảnh.
 *
 * React.lazy chỉ bắt đầu tải tệp JS khi trang được render lần đầu. Nếu người
 * dùng bấm tab chưa từng mở, navigation phải chờ tải chunk — trong lúc đó
 * React giữ UI cũ (suspend), các bấm tiếp theo xếp chồng lên nhau và có thể
 * resolve sai thứ tự (bị "kéo về mục cũ"). Nạp sẵn lúc rảnh: chuyển trang
 * gần như tức thì và không còn race. Tổng các chunk trang chỉ ~50 KB gzip.
 */
const routeImports: Array<() => Promise<unknown>> = [
  () => import("@/pages/HomePage"),
  () => import("@/pages/AlbumPage"),
  () => import("@/pages/SharedAlbumPage"),
  () => import("@/pages/LoginPage"),
  () => import("@/pages/ArchiveConnectPage"),
  () => import("@/pages/SignupPage"),
  () => import("@/pages/ForgotPasswordPage"),
  () => import("@/pages/ResetPasswordPage"),
  () => import("@/pages/SettingsPage"),
  () => import("@/pages/UploadPage"),
  () => import("@/pages/NotFoundPage"),
];

let prefetched = false;

/** Gọi một lần sau khi app đã render; an toàn gọi nhiều lần. */
export function prefetchRoutes() {
  if (prefetched) return;
  prefetched = true;
  const run = () => void Promise.all(routeImports.map((load) => load().catch(() => undefined)));
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 3000 });
  } else {
    setTimeout(run, 1500);
  }
}

/** Bộ xương tạm thời trong lúc tải tệp JS của trang. */
function RouteFallback() {
  return (
    <div className="mx-auto max-w-4xl space-y-4 animate-fade-in" aria-busy="true" aria-label="Đang tải trang">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-72" />
      <div className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="aspect-photo w-full rounded-3xl" />
        <Skeleton className="aspect-photo w-full rounded-3xl" />
        <Skeleton className="aspect-photo w-full rounded-3xl" />
      </div>
    </div>
  );
}

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "albums/:albumId", element: <AlbumPage /> },
      { path: "share/:shareToken", element: <SharedAlbumPage /> },
      { path: "upload", element: <UploadPage /> },
      { path: "settings", element: <SettingsPage /> },
      // Kết nối kho lưu trữ riêng (Worker + R2). Cũng chính là màn hình đăng
      // nhập khi backend đang chạy ở chế độ `archive`.
      { path: "connect", element: <ArchiveConnectPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "signup", element: <SignupPage /> },
      { path: "forgot-password", element: <ForgotPasswordPage /> },
      { path: "reset-password", element: <ResetPasswordPage /> },
      // Các đường dẫn cũ / thường gặp
      { path: "album/:albumId", element: <AlbumRedirect /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

/** Hỗ trợ liên kết cũ dạng `/album/:id`. */
function AlbumRedirect() {
  return <AlbumRouteRedirect />;
}

function AlbumRouteRedirect() {
  // Chuyển hướng mềm, giữ nguyên tham số trên URL.
  return <Navigate to=".." replace relative="path" />;
}

/** Cây tuyến đường dạng JSX cho RouterProvider-less setup. */
export function AppRoutes() {
  // Nạp sẵn chunk trang sau lần render đầu, để các lần chuyển trang sau là tức thì.
  useEffect(() => {
    prefetchRoutes();
  }, []);

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {routes.map((route) => (
          <Route key={route.path ?? "root"} path={route.path} element={route.element}>
            {route.children?.map((child) =>
              child.index ? (
                <Route key="index" index element={child.element} />
              ) : (
                <Route key={child.path} path={child.path} element={child.element} />
              ),
            )}
          </Route>
        ))}
      </Routes>
    </Suspense>
  );
}
