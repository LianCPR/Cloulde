import { BACKEND } from "@/config/env";
import type { GalleryBackend } from "./ports";
import { createArchiveBackend } from "./archive/archiveBackend";
import { createLocalBackend } from "./local/localBackend";
import { createSupabaseBackend } from "./supabase/supabaseBackend";

/**
 * Chọn backend theo cấu hình môi trường.
 *
 * - `archive`: kho riêng trên Cloudflare R2 + D1 (ảnh gốc tới hàng trăm MB).
 * - `supabase`: Supabase (Postgres + Storage + Auth).
 * - `local`: backend IndexedDB nội bộ, để ứng dụng vẫn chạy khi chưa cấu hình.
 *
 * Không có backend nào "mất dữ liệu âm thầm": nếu backend yêu cầu không khởi
 * tạo được, ứng dụng chuyển sang chế độ cục bộ VÀ hiển thị thông báo rõ ràng
 * thay vì trắng trang (xem `BackendNotice`).
 */

let cached: GalleryBackend | null = null;

function createBackend(): GalleryBackend {
  if (BACKEND === "archive") {
    try {
      return createArchiveBackend();
    } catch (error) {
      console.error("Không khởi tạo được backend kho lưu trữ, chuyển sang chế độ cục bộ:", error);
      return createLocalBackend();
    }
  }
  if (BACKEND === "supabase") {
    try {
      return createSupabaseBackend();
    } catch (error) {
      console.error("Không khởi tạo được backend Supabase, chuyển sang chế độ cục bộ:", error);
      return createLocalBackend();
    }
  }
  return createLocalBackend();
}

export function getBackend(): GalleryBackend {
  if (!cached) cached = createBackend();
  return cached;
}

export const backendMode = BACKEND;
export const isSupabaseMode = () => getBackend().mode === "supabase";
export const isArchiveMode = () => getBackend().mode === "archive";
/**
 * Mọi backend trừ `local` đều phục vụ ảnh gốc qua URL có chữ ký, hết hạn.
 * Dùng để chọn đường đọc theo luồng thay vì nạp cả tệp vào bộ nhớ.
 */
export const usesSignedStorage = () => getBackend().mode !== "local";
