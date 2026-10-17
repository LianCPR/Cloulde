import type { AccountUser } from "@/types";
import type { AuthProvider, AuthResult } from "@/services/ports";
import { pbkdf2Hex, randomHex, timingSafeEqual } from "@/lib/secret";
import { getLocalDb } from "./localDb";

/**
 * Xác thực cho backend `local` (chế độ phát triển/demo).
 *
 * KHÔNG dùng cho sản xuất: dữ liệu người dùng nằm ngay trong trình duyệt.
 * Mật khẩu vẫn được băm bằng PBKDF2-SHA256 (150.000 vòng, salt riêng cho từng
 * tài khoản) để không bao giờ lưu mật khẩu dạng thô — kể cả ở chế độ demo.
 */

const SESSION_KEY = "current";

type Listener = (user: AccountUser | null) => void;

class LocalAuthProvider implements AuthProvider {
  readonly kind = "local" as const;
  private listeners = new Set<Listener>();

  private toAccountUser(record: {
    id: string;
    email: string;
    displayName: string | null;
    createdAt: string;
  }): AccountUser {
    return {
      id: record.id,
      email: record.email,
      displayName: record.displayName,
      createdAt: record.createdAt,
    };
  }

  private notify(user: AccountUser | null): void {
    for (const listener of this.listeners) listener(user);
  }

  async getCurrentUser(): Promise<AccountUser | null> {
    const db = await getLocalDb();
    const session = await db.get("session", SESSION_KEY);
    if (!session) return null;
    const user = await db.get("users", session.userId);
    return user ? this.toAccountUser(user) : null;
  }

  onAuthStateChange(callback: Listener): () => void {
    this.listeners.add(callback);
    void this.getCurrentUser().then((user) => callback(user));
    return () => {
      this.listeners.delete(callback);
    };
  }

  async signUp(
    email: string,
    password: string,
    displayName?: string,
  ): Promise<AuthResult> {
    const db = await getLocalDb();
    const normalized = email.trim().toLowerCase();
    const existing = await db.getFromIndex("users", "byEmail", normalized);
    if (existing) {
      throw new Error("Email này đã được đăng ký trong trình duyệt này.");
    }
    const salt = randomHex(16);
    const passwordHash = await pbkdf2Hex(password, salt);
    const record = {
      id: crypto.randomUUID(),
      email: normalized,
      displayName: displayName?.trim() || null,
      passwordHash,
      passwordSalt: salt,
      createdAt: new Date().toISOString(),
    };
    await db.put("users", record);
    await db.put("session", {
      key: SESSION_KEY,
      userId: record.id,
      createdAt: record.createdAt,
    });
    const user = this.toAccountUser(record);
    this.notify(user);
    return { user, sessionCreated: true };
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    const db = await getLocalDb();
    const normalized = email.trim().toLowerCase();
    const record = await db.getFromIndex("users", "byEmail", normalized);
    if (!record) {
      throw new Error("Không tìm thấy tài khoản với email này.");
    }
    const hash = await pbkdf2Hex(password, record.passwordSalt);
    if (!timingSafeEqual(hash, record.passwordHash)) {
      throw new Error("Mật khẩu không đúng.");
    }
    await db.put("session", {
      key: SESSION_KEY,
      userId: record.id,
      createdAt: new Date().toISOString(),
    });
    const user = this.toAccountUser(record);
    this.notify(user);
    return { user, sessionCreated: true };
  }

  async signOut(): Promise<void> {
    const db = await getLocalDb();
    await db.delete("session", SESSION_KEY);
    this.notify(null);
  }

  async requestPasswordReset(): Promise<void> {
    // Không có email server ở chế độ local. Trả về thành công giả định là
    // không đúng — nêu rõ giới hạn để người dùng không bị đánh lừa.
    throw new Error(
      "Chế độ demo cục bộ không gửi được email đặt lại mật khẩu. Hãy cấu hình Supabase Auth để dùng tính năng này.",
    );
  }

  async updatePassword(newPassword: string): Promise<void> {
    const db = await getLocalDb();
    const session = await db.get("session", SESSION_KEY);
    if (!session) throw new Error("Bạn cần đăng nhập lại.");
    const record = await db.get("users", session.userId);
    if (!record) throw new Error("Không tìm thấy tài khoản.");
    const salt = randomHex(16);
    const passwordHash = await pbkdf2Hex(newPassword, salt);
    await db.put("users", { ...record, passwordHash, passwordSalt: salt });
  }
}

export const localAuth = new LocalAuthProvider();
