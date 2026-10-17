import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    /**
     * Chế độ kho lưu trữ chạy hai tiến trình: Vite (giao diện) và `wrangler dev`
     * (Worker + R2 + D1). Chuyển tiếp `/api` và `/dl` sang Worker để trình duyệt
     * thấy MỘT origin — nhờ vậy không cần CORS, cookie của Cloudflare Access
     * hoạt động đúng, và môi trường phát triển giống môi trường thật (một Worker
     * phục vụ cả API lẫn trang).
     *
     * Đổi cổng Worker bằng biến ARCHIVE_DEV_ORIGIN nếu cần.
     */
    proxy: {
      "/api": { target: process.env.ARCHIVE_DEV_ORIGIN ?? "http://127.0.0.1:8787" },
      "/dl": { target: process.env.ARCHIVE_DEV_ORIGIN ?? "http://127.0.0.1:8787" },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep heavy, rarely-changing libraries out of the app chunk so the
        // gallery stays fast on slow connections and updates stay small.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)/.test(id)) {
            return "react";
          }
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("jszip")) return "archive";
          if (/[\\/]node_modules[\\/]motion/.test(id)) return "motion";
          return undefined;
        },
      },
    },
  },
});
