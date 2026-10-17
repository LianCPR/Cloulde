import { Navigate, Route, Routes, type RouteObject } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomePage } from "@/pages/HomePage";
import { AlbumPage } from "@/pages/AlbumPage";
import { SharedAlbumPage } from "@/pages/SharedAlbumPage";
import { LoginPage } from "@/pages/LoginPage";
import { ArchiveConnectPage } from "@/pages/ArchiveConnectPage";
import { SignupPage } from "@/pages/SignupPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { UploadPage } from "@/pages/UploadPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

/**
 * Bảng tuyến đường.
 *
 * `/share/:shareToken` cố ý nằm trong cùng khung giao diện nhưng luôn xác minh
 * quyền ở phía backend trước khi hiển thị bất kỳ dữ liệu nào.
 */
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
  return (
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
  );
}
