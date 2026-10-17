import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Album, IsoDateString, Photo } from "@/types";

/**
 * Lược đồ IndexedDB cho backend `local`.
 *
 * Đây là backend dự phòng dùng khi chưa cấu hình Supabase. Nó tách rõ ảnh gốc
 * (`blobs`) khỏi metadata (`photos`) — đúng nguyên tắc "chỉ lưu metadata trong
 * database, không lưu nhị phân ảnh trong bảng" — và lưu token/mật khẩu chia sẻ
 * dưới dạng băm, không bao giờ ở dạng thô.
 */

export interface LocalUserRecord {
  id: string;
  email: string;
  displayName: string | null;
  /** PBKDF2-SHA256, 150.000 vòng, salt riêng cho từng người dùng. */
  passwordHash: string;
  passwordSalt: string;
  createdAt: IsoDateString;
}

export interface LocalBlobRecord {
  path: string;
  blob: Blob;
  mimeType: string;
  createdAt: IsoDateString;
}

export interface LocalShareRecord {
  id: string;
  albumId: string;
  ownerId: string;
  /** Chỉ lưu SHA-256 của token, không lưu token thô. */
  tokenHash: string;
  passwordHash: string | null;
  passwordSalt: string | null;
  allowDownload: boolean;
  expiresAt: IsoDateString | null;
  revokedAt: IsoDateString | null;
  createdAt: IsoDateString;
  accessCount: number;
  lastAccessedAt: IsoDateString | null;
}

/** Ghi lại số lần thử mở liên kết chia sẻ để hạn chế dò mật khẩu. */
export interface LocalRateLimitRecord {
  key: string;
  attempts: number;
  windowStart: number;
}

/** Album kèm khoá sắp xếp đã chuẩn hoá để phân trang bằng con trỏ. */
export interface LocalAlbumRecord extends Album {
  sortKeyNewest: string;
  sortKeyOldest: string;
  titleKey: string;
  searchKey: string;
}

export interface LocalPhotoRecord extends Photo {
  sortKeyAsc: string;
  sortKeyDesc: string;
  filenameKey: string;
}

interface CloudeyLocalDb extends DBSchema {
  users: {
    key: string;
    value: LocalUserRecord;
    indexes: { byEmail: string };
  };
  session: {
    key: string;
    value: { key: string; userId: string; createdAt: IsoDateString };
  };
  albums: {
    key: string;
    value: LocalAlbumRecord;
    indexes: {
      byOwnerNewest: [string, string];
      byOwnerOldest: [string, string];
      byOwnerTitle: [string, string];
    };
  };
  photos: {
    key: string;
    value: LocalPhotoRecord;
    indexes: {
      byAlbumAsc: [string, string];
      byAlbumDesc: [string, string];
      byAlbumFilename: [string, string];
      byAlbumChecksum: [string, string];
      byOwner: string;
    };
  };
  blobs: {
    key: string;
    value: LocalBlobRecord;
    indexes: { byCreatedAt: string };
  };
  shares: {
    key: string;
    value: LocalShareRecord;
    indexes: { byAlbum: string; byTokenHash: string };
  };
  rateLimits: {
    key: string;
    value: LocalRateLimitRecord;
  };
}

export const LOCAL_DB_NAME = "cloude-local";

let dbPromise: Promise<IDBPDatabase<CloudeyLocalDb>> | null = null;

export function getLocalDb(): Promise<IDBPDatabase<CloudeyLocalDb>> {
  if (!dbPromise) {
    dbPromise = openDB<CloudeyLocalDb>(LOCAL_DB_NAME, 1, {
      upgrade(db) {
        const users = db.createObjectStore("users", { keyPath: "id" });
        users.createIndex("byEmail", "email", { unique: true });

        db.createObjectStore("session", { keyPath: "key" });

        const albums = db.createObjectStore("albums", { keyPath: "id" });
        albums.createIndex("byOwnerNewest", ["ownerId", "sortKeyNewest"]);
        albums.createIndex("byOwnerOldest", ["ownerId", "sortKeyOldest"]);
        albums.createIndex("byOwnerTitle", ["ownerId", "titleKey"]);

        const photos = db.createObjectStore("photos", { keyPath: "id" });
        photos.createIndex("byAlbumAsc", ["albumId", "sortKeyAsc"]);
        photos.createIndex("byAlbumDesc", ["albumId", "sortKeyDesc"]);
        photos.createIndex("byAlbumFilename", ["albumId", "filenameKey"]);
        photos.createIndex("byAlbumChecksum", ["albumId", "checksum"]);
        photos.createIndex("byOwner", "ownerId");

        const blobs = db.createObjectStore("blobs", { keyPath: "path" });
        blobs.createIndex("byCreatedAt", "createdAt");

        const shares = db.createObjectStore("shares", { keyPath: "id" });
        shares.createIndex("byAlbum", "albumId");
        shares.createIndex("byTokenHash", "tokenHash", { unique: true });

        db.createObjectStore("rateLimits", { keyPath: "key" });
      },
    });
  }
  return dbPromise;
}

/** Xoá toàn bộ dữ liệu local (dùng ở trang Cài đặt khi người dùng yêu cầu). */
export async function wipeLocalDatabase(): Promise<void> {
  const db = await getLocalDb();
  await Promise.all([
    db.clear("users"),
    db.clear("session"),
    db.clear("albums"),
    db.clear("photos"),
    db.clear("blobs"),
    db.clear("shares"),
    db.clear("rateLimits"),
  ]);
}
