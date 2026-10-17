import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabaseCredentials } from "@/config/env";

/**
 * Client Supabase phía trình duyệt.
 *
 * Chỉ dùng anon key (khoá công khai). Anon key không phải bí mật: toàn bộ việc
 * bảo vệ dữ liệu dựa trên Row Level Security ở phía PostgreSQL và các Edge
 * Function. TUYỆT ĐỐI không đặt service_role key trong mã frontend.
 */

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!hasSupabaseCredentials) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        storageKey: "cloude-auth",
      },
      global: {
        headers: { "x-application-name": "cloude" },
      },
    });
  }
  return client;
}

/** Client bắt buộc phải tồn tại — dùng ở nơi đã xác nhận backend là supabase. */
export function requireSupabaseClient(): SupabaseClient {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error(
      "Chưa cấu hình Supabase. Hãy thêm VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY vào .env.local.",
    );
  }
  return supabase;
}

export const supabaseConfigured = hasSupabaseCredentials;
