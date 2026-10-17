import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AccountUser } from "@/types";
import { getBackend } from "@/services/backend";
import { describeError } from "@/services/errors";
import { mediaUrlCache } from "@/services/photoService";

/**
 * Ngữ cảnh xác thực dùng chung cho cả hai backend.
 * Không lưu mật khẩu ở bất kỳ đâu phía client.
 */

interface AuthContextValue {
  user: AccountUser | null;
  initializing: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Đọc lại danh tính hiện tại.
   * Cần cho chế độ kho lưu trữ: sau khi dán token/kết nối, danh tính chủ kho
   * đến từ server chứ không từ một phiên đăng nhập cục bộ.
   */
  refresh: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  /** Thông báo cần xác nhận email (Supabase bật xác thực email). */
  pendingConfirmation: string | null;
  clearPendingConfirmation: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [pendingConfirmation, setPendingConfirmation] = useState<string | null>(null);

  useEffect(() => {
    const backend = getBackend();
    let mounted = true;

    const unsubscribe = backend.auth.onAuthStateChange((nextUser) => {
      if (!mounted) return;
      setUser(nextUser);
      setInitializing(false);
      // Khi đăng xuất, thu hồi mọi object URL đang giữ trong bộ nhớ đệm.
      if (!nextUser) mediaUrlCache.clear();
    });

    void backend.auth
      .getCurrentUser()
      .then((nextUser) => {
        if (!mounted) return;
        setUser(nextUser);
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setInitializing(false);
      });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await getBackend().auth.signIn(email, password);
    setUser(result.user);
    setPendingConfirmation(null);
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const result = await getBackend().auth.signUp(email, password, displayName);
      setUser(result.user);
      if (!result.sessionCreated) {
        setPendingConfirmation(
          "Tài khoản đã được tạo. Hãy mở email để xác nhận trước khi đăng nhập.",
        );
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await getBackend().auth.signOut();
    } catch (error) {
      console.warn("Đăng xuất:", describeError(error));
    } finally {
      setUser(null);
      mediaUrlCache.clear();
    }
  }, []);

  const refresh = useCallback(async () => {
    const nextUser = await getBackend()
      .auth.getCurrentUser()
      .catch(() => null);
    setUser(nextUser);
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    await getBackend().auth.requestPasswordReset(email);
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    await getBackend().auth.updatePassword(password);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      initializing,
      signIn,
      signUp,
      signOut,
      refresh,
      requestPasswordReset,
      updatePassword,
      pendingConfirmation,
      clearPendingConfirmation: () => setPendingConfirmation(null),
    }),
    [
      user,
      initializing,
      signIn,
      signUp,
      signOut,
      refresh,
      requestPasswordReset,
      updatePassword,
      pendingConfirmation,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth phải được dùng bên trong <AuthProvider>.");
  return context;
}
