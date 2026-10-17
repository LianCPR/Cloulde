import type { AccountUser } from "@/types";
import type { AuthProvider, AuthResult } from "@/services/ports";
import { requireSupabaseClient } from "./client";

/**
 * Xác thực bằng Supabase Auth.
 * Mật khẩu được Supabase quản lý — không bao giờ lưu trong bảng tự tạo.
 */

function mapUser(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  created_at?: string;
} | null): AccountUser | null {
  if (!user) return null;
  const displayName =
    typeof user.user_metadata?.display_name === "string"
      ? (user.user_metadata.display_name as string)
      : null;
  return {
    id: user.id,
    email: user.email ?? "",
    displayName,
    createdAt: user.created_at ?? new Date().toISOString(),
  };
}

class SupabaseAuthProvider implements AuthProvider {
  readonly kind = "supabase" as const;

  async getCurrentUser(): Promise<AccountUser | null> {
    const supabase = requireSupabaseClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return mapUser(data.user);
  }

  onAuthStateChange(callback: (user: AccountUser | null) => void): () => void {
    const supabase = requireSupabaseClient();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(mapUser(session?.user ?? null));
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }

  async signUp(
    email: string,
    password: string,
    displayName?: string,
  ): Promise<AuthResult> {
    const supabase = requireSupabaseClient();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: displayName ? { display_name: displayName } : undefined,
        emailRedirectTo: `${window.location.origin}/`,
      },
    });
    if (error) throw new Error(error.message);
    const user = mapUser(data.user);
    if (!user) {
      // Trường hợp Supabase bật xác nhận email: chưa có phiên ngay.
      throw new Error(
        "Tài khoản đã được tạo. Vui lòng kiểm tra email để xác nhận trước khi đăng nhập.",
      );
    }
    return { user, sessionCreated: Boolean(data.session) };
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    const supabase = requireSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw new Error(error.message);
    const user = mapUser(data.user);
    if (!user) throw new Error("Không nhận được thông tin người dùng.");
    return { user, sessionCreated: true };
  }

  async signInWithOtp(email: string): Promise<void> {
    const supabase = requireSupabaseClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    if (error) throw new Error(error.message);
  }

  async signOut(): Promise<void> {
    const supabase = requireSupabaseClient();
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const supabase = requireSupabaseClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw new Error(error.message);
  }

  async updatePassword(newPassword: string): Promise<void> {
    const supabase = requireSupabaseClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
  }
}

export const supabaseAuth = new SupabaseAuthProvider();
