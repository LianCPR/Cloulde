import type {
  Album,
  AlbumQuery,
  AlbumShare,
  CreateAlbumInput,
  CreateShareInput,
  Paged,
  Photo,
  PhotoQuery,
  ShareAccess,
  StorageUsage,
  UpdateAlbumInput,
  UpdateShareInput,
} from "@/types";
import type {
  AlbumRepository,
  AuthProvider,
  GalleryBackend,
  PhotoRepository,
  ShareRepository,
  StorageProvider,
  UsageRepository,
} from "@/services/ports";
import { AuthRequiredError, ForbiddenError, NotFoundError, ShareAccessError } from "@/services/errors";
import { buildSortKeys, decodeCursor, encodeCursor } from "@/services/cursor";
import { normalizeFilenameKey } from "@/lib/fileTypes";
import { normalizeSearchKey } from "@/lib/search";
import { pbkdf2Hex, randomHex, randomToken, timingSafeEqual } from "@/lib/secret";
import { sha256Text } from "@/lib/checksum";
import { getLocalDb, type LocalAlbumRecord, type LocalPhotoRecord } from "./localDb";
import { localAuth } from "./localAuth";
import { localStorageProvider } from "./localStorageProvider";

/**
 * Backend cục bộ dùng IndexedDB.
 *
 * Mục đích: cho phép ứng dụng CHẠY ĐƯỢC và kiểm thử được toàn bộ luồng
 * (album, tải lên, tải xuống, chia sẻ, xác thực) khi chưa cấu hình Supabase.
 * Không thay thế môi trường sản xuất: dữ liệu chỉ nằm trong trình duyệt này.
 */

const HIGH_KEY = "\uffff";
const SEARCH_SCAN_LIMIT = 5000;
const SHARE_ATTEMPT_LIMIT = 10;
const SHARE_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

function compactRange(ownerId: string, from: string): IDBKeyRange {
  return IDBKeyRange.bound([ownerId, from], [ownerId, HIGH_KEY], false, false);
}

type AlbumLock = Promise<unknown>;
const albumLocks = new Map<string, AlbumLock>();

/**
 * Khoá tuần tự theo từng album.
 *
 * Hàng đợi tải lên chạy song song, nên nhiều lần tính lại số liệu album có thể
 * xen kẽ nhau và ghi đè kết quả của nhau (read-modify-write). Khoá này đảm bảo
 * mỗi lần tính lại diễn ra trọn vẹn, nên `photoCount` / `totalBytes` luôn đúng.
 */
function withAlbumLock<T>(albumId: string, task: () => Promise<T>): Promise<T> {
  const previous = albumLocks.get(albumId) ?? Promise.resolve();
  const next = previous.then(task, task);
  albumLocks.set(
    albumId,
    next.catch(() => undefined),
  );
  return next;
}

async function requireUser() {
  const user = await localAuth.getCurrentUser();
  if (!user) throw new AuthRequiredError();
  return user;
}

/** Tính lại số ảnh, tổng dung lượng và ảnh bìa của một album. */
async function recalcAlbum(albumId: string): Promise<LocalAlbumRecord | null> {
  const db = await getLocalDb();
  const album = await db.get("albums", albumId);
  if (!album) return null;

  let photoCount = 0;
  let totalBytes = 0;
  let newestId: string | null = null;
  let newestKey = "";
  let newestPreviewableId: string | null = null;
  let newestPreviewableKey = "";
  let coverStillExists = false;

  let cursor = await db.transaction("photos").store.index("byAlbumAsc").openCursor(compactRange(albumId, ""));
  while (cursor) {
    const record = cursor.value;
    photoCount += 1;
    totalBytes += record.fileSize;
    if (!newestKey || record.sortKeyAsc > newestKey) {
      newestKey = record.sortKeyAsc;
      newestId = record.id;
    }
    // Ưu tiên ảnh bìa xem trước được: RAW/TIFF không hiển thị được trong trình duyệt.
    if (record.previewable && (!newestPreviewableKey || record.sortKeyAsc > newestPreviewableKey)) {
      newestPreviewableKey = record.sortKeyAsc;
      newestPreviewableId = record.id;
    }
    if (album.coverPhotoId && record.id === album.coverPhotoId) coverStillExists = true;
    cursor = await cursor.continue();
  }

  // Giữ ảnh bìa hiện có; nếu ảnh bìa đã bị xoá thì chọn ảnh mới nhất xem trước
  // được, và chỉ khi album hoàn toàn không có ảnh xem trước được mới dùng ảnh
  // mới nhất bất kỳ.
  const coverPhotoId = coverStillExists
    ? album.coverPhotoId
    : (newestPreviewableId ?? newestId);
  const updated: LocalAlbumRecord = { ...album, photoCount, totalBytes, coverPhotoId };
  await db.put("albums", updated);
  return updated;
}

function toAlbum(
  record: LocalAlbumRecord,
  cover?: { thumbnailPath: string | null; storagePath: string; previewable: boolean } | null,
): Album {
  return {
    id: record.id,
    ownerId: record.ownerId,
    title: record.title,
    description: record.description,
    coverPhotoId: record.coverPhotoId,
    coverThumbnailPath: cover?.thumbnailPath ?? null,
    coverStoragePath: cover?.storagePath ?? null,
    coverPreviewable: cover?.previewable ?? false,
    photoCount: record.photoCount,
    totalBytes: record.totalBytes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toPhoto(record: LocalPhotoRecord): Photo {
  return {
    id: record.id,
    albumId: record.albumId,
    ownerId: record.ownerId,
    originalFilename: record.originalFilename,
    storagePath: record.storagePath,
    thumbnailPath: record.thumbnailPath,
    mimeType: record.mimeType,
    fileSize: record.fileSize,
    width: record.width,
    height: record.height,
    checksum: record.checksum,
    previewable: record.previewable,
    createdAt: record.createdAt,
  };
}

/* ── Album ────────────────────────────────────────────────────── */

const albumRepository: AlbumRepository = {
  async list(query: AlbumQuery): Promise<Paged<Album>> {
    const user = await requireUser();
    const db = await getLocalDb();
    // Lấy ảnh bìa của tất cả album trong một truy vấn thay vì N+1 truy vấn.
    const loadCovers = async (records: LocalAlbumRecord[]) => {
      const ids = records
        .map((record) => record.coverPhotoId)
        .filter((id): id is string => Boolean(id));
      const covers = new Map<string, LocalPhotoRecord>();
      if (ids.length > 0) {
        const rows = await Promise.all(ids.map((id) => db.get("photos", id)));
        for (const row of rows) if (row) covers.set(row.id, row);
      }
      return (record: LocalAlbumRecord) =>
        record.coverPhotoId ? (covers.get(record.coverPhotoId) ?? null) : null;
    };

    const limit = Math.min(Math.max(query.limit ?? 24, 1), 100);
    const sort = query.sort ?? "newest";
    const indexName =
      sort === "title" ? "byOwnerTitle" : sort === "oldest" ? "byOwnerOldest" : "byOwnerNewest";

    const cursorPayload = decodeCursor(query.cursor);
    // Với sort "title" khoá là titleKey, nên con trỏ dùng chính trường đó.
    const from = cursorPayload ? `${cursorPayload.key}\u0000` : "";
    const index = db.transaction("albums").store.index(indexName);

    const search = query.search?.trim() ? normalizeSearchKey(query.search) : "";
    const collected: LocalAlbumRecord[] = [];
    let scanned = 0;
    let lastKey: string | null = null;
    let hasMore = false;

    let cursor = await index.openCursor(compactRange(user.id, from));
    while (cursor) {
      const record = cursor.value;
      scanned += 1;
      if (!search || record.searchKey.includes(search)) {
        if (collected.length === limit) {
          hasMore = true;
          break;
        }
        collected.push(record);
        lastKey = cursor.key[1] as string;
      } else if (scanned > SEARCH_SCAN_LIMIT) {
        break;
      }
      cursor = await cursor.continue();
    }

    const coverFor = await loadCovers(collected);
    return {
      items: collected.map((record) => {
        const cover = coverFor(record);
        return toAlbum(
          record,
          cover
            ? {
                thumbnailPath: cover.thumbnailPath,
                storagePath: cover.storagePath,
                previewable: cover.previewable,
              }
            : null,
        );
      }),
      nextCursor: hasMore && lastKey ? encodeCursor({ key: lastKey, id: collected.at(-1)!.id }) : null,
    };
  },

  async get(albumId: string): Promise<Album | null> {
    const user = await requireUser();
    const db = await getLocalDb();
    const record = await db.get("albums", albumId);
    if (!record || record.ownerId !== user.id) return null;
    const cover = record.coverPhotoId ? await db.get("photos", record.coverPhotoId) : null;
    return toAlbum(
      record,
      cover
        ? {
            thumbnailPath: cover.thumbnailPath,
            storagePath: cover.storagePath,
            previewable: cover.previewable,
          }
        : null,
    );
  },

  async create(input: CreateAlbumInput): Promise<Album> {
    const user = await requireUser();
    const db = await getLocalDb();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const { sortKeyAsc, sortKeyDesc } = buildSortKeys(now, id);
    const title = input.title.trim();
    const record: LocalAlbumRecord = {
      id,
      ownerId: user.id,
      title,
      description: input.description?.trim() || null,
      coverPhotoId: null,
      coverThumbnailPath: null,
      coverStoragePath: null,
      coverPreviewable: false,
      photoCount: 0,
      totalBytes: 0,
      createdAt: now,
      updatedAt: now,
      sortKeyNewest: sortKeyDesc,
      sortKeyOldest: sortKeyAsc,
      titleKey: `${normalizeSearchKey(title)}|${id}`,
      searchKey: normalizeSearchKey(`${title} ${input.description ?? ""}`),
    };
    await db.put("albums", record);
    return toAlbum(record, null);
  },

  async update(albumId: string, input: UpdateAlbumInput): Promise<Album> {
    const user = await requireUser();
    const db = await getLocalDb();
    const record = await db.get("albums", albumId);
    if (!record) throw new NotFoundError("Album không tồn tại.");
    if (record.ownerId !== user.id) throw new ForbiddenError("Đây không phải album của bạn.");

    const title = input.title !== undefined ? input.title.trim() : record.title;
    const description =
      input.description !== undefined ? input.description?.trim() || null : record.description;
    const coverPhotoId =
      input.coverPhotoId !== undefined ? input.coverPhotoId : record.coverPhotoId;

    const updated: LocalAlbumRecord = {
      ...record,
      title,
      description,
      coverPhotoId,
      updatedAt: new Date().toISOString(),
      titleKey: `${normalizeSearchKey(title)}|${record.id}`,
      searchKey: normalizeSearchKey(`${title} ${description ?? ""}`),
    };
    await db.put("albums", updated);
    const cover = updated.coverPhotoId ? await db.get("photos", updated.coverPhotoId) : null;
    return toAlbum(
      updated,
      cover
        ? {
            thumbnailPath: cover.thumbnailPath,
            storagePath: cover.storagePath,
            previewable: cover.previewable,
          }
        : null,
    );
  },

  async remove(albumId: string): Promise<void> {
    const user = await requireUser();
    const db = await getLocalDb();
    const record = await db.get("albums", albumId);
    if (!record) throw new NotFoundError("Album không tồn tại.");
    if (record.ownerId !== user.id) throw new ForbiddenError("Đây không phải album của bạn.");

    // Chỉ xoá các object thuộc đúng album này — không đụng tới dữ liệu khác.
    const photoRecords: LocalPhotoRecord[] = [];
    let photoCursor = await db
      .transaction("photos")
      .store.index("byAlbumAsc")
      .openCursor(compactRange(albumId, ""));
    while (photoCursor) {
      photoRecords.push(photoCursor.value);
      photoCursor = await photoCursor.continue();
    }

    const paths = photoRecords.flatMap((photo) =>
      photo.thumbnailPath ? [photo.storagePath, photo.thumbnailPath] : [photo.storagePath],
    );
    if (paths.length > 0) await localStorageProvider.remove(paths);

    const tx = db.transaction(["photos", "albums", "shares"], "readwrite");
    for (const photo of photoRecords) await tx.objectStore("photos").delete(photo.id);
    const shareKeys = await tx.objectStore("shares").index("byAlbum").getAllKeys(albumId);
    for (const key of shareKeys) await tx.objectStore("shares").delete(key);
    await tx.objectStore("albums").delete(albumId);
    await tx.done;
  },

  async listRecent(limit: number): Promise<Album[]> {
    const user = await localAuth.getCurrentUser();
    if (!user) return [];
    const db = await getLocalDb();
    const records = await db.getAllFromIndex(
      "albums",
      "byOwnerNewest",
      compactRange(user.id, ""),
      limit,
    );
    return records.map((record) => toAlbum(record, null));
  },
};

/* ── Ảnh ──────────────────────────────────────────────────────── */

const photoRepository: PhotoRepository = {
  async list(query: PhotoQuery): Promise<Paged<Photo>> {
    const user = await requireUser();
    const db = await getLocalDb();
    const album = await db.get("albums", query.albumId);
    if (!album || album.ownerId !== user.id) {
      throw new ForbiddenError("Bạn không có quyền xem album này.");
    }

    const limit = Math.min(Math.max(query.limit ?? 60, 1), 200);
    const sort = query.sort ?? "uploaded-desc";
    const indexName =
      sort === "uploaded-asc"
        ? "byAlbumAsc"
        : sort === "filename-asc"
          ? "byAlbumFilename"
          : "byAlbumDesc";

    const cursorPayload = decodeCursor(query.cursor);
    const from = cursorPayload ? `${cursorPayload.key}\u0000` : "";
    const index = db.transaction("photos").store.index(indexName);

    const items: LocalPhotoRecord[] = [];
    let lastKey: string | null = null;
    let hasMore = false;

    let cursor = await index.openCursor(compactRange(query.albumId, from));
    while (cursor) {
      if (items.length === limit) {
        hasMore = true;
        break;
      }
      items.push(cursor.value);
      lastKey = cursor.key[1] as string;
      cursor = await cursor.continue();
    }

    return {
      items: items.map(toPhoto),
      nextCursor: hasMore && lastKey ? encodeCursor({ key: lastKey, id: items.at(-1)!.id }) : null,
      total: album.photoCount,
    };
  },

  async get(photoId: string): Promise<Photo | null> {
    const user = await requireUser();
    const db = await getLocalDb();
    const record = await db.get("photos", photoId);
    if (!record || record.ownerId !== user.id) return null;
    return toPhoto(record);
  },

  async listAllMetadata(albumId: string): Promise<Photo[]> {
    const user = await requireUser();
    const db = await getLocalDb();
    const album = await db.get("albums", albumId);
    if (!album || album.ownerId !== user.id) throw new ForbiddenError();
    const records = await db.getAllFromIndex("photos", "byAlbumAsc", compactRange(albumId, ""));
    return records.map(toPhoto);
  },

  async insert(input): Promise<Photo> {
    const user = await requireUser();
    const db = await getLocalDb();
    const album = await db.get("albums", input.albumId);
    if (!album) throw new NotFoundError("Album không tồn tại.");
    if (album.ownerId !== user.id) throw new ForbiddenError("Đây không phải album của bạn.");

    const id = input.id ?? crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const { sortKeyAsc, sortKeyDesc } = buildSortKeys(createdAt, id);
    const record: LocalPhotoRecord = {
      id,
      albumId: input.albumId,
      ownerId: user.id,
      originalFilename: input.originalFilename,
      storagePath: input.storagePath,
      thumbnailPath: input.thumbnailPath ?? null,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      width: input.width ?? null,
      height: input.height ?? null,
      checksum: input.checksum ?? null,
      previewable: input.previewable,
      createdAt,
      sortKeyAsc,
      sortKeyDesc,
      filenameKey: `${normalizeFilenameKey(input.originalFilename)}|${id}`,
    };
    await db.put("photos", record);
    // Ghi metadata xong mới tính lại số liệu, và làm tuần tự theo album.
    await withAlbumLock(input.albumId, () => recalcAlbum(input.albumId));
    return toPhoto(record);
  },

  async remove(photoIds: string[]): Promise<void> {
    const user = await requireUser();
    const db = await getLocalDb();
    const affectedAlbums = new Set<string>();
    const paths: string[] = [];

    for (const photoId of photoIds) {
      const record = await db.get("photos", photoId);
      if (!record) continue;
      if (record.ownerId !== user.id) throw new ForbiddenError("Đây không phải ảnh của bạn.");
      paths.push(record.storagePath);
      if (record.thumbnailPath) paths.push(record.thumbnailPath);
      affectedAlbums.add(record.albumId);
      await db.delete("photos", photoId);
    }

    if (paths.length > 0) await localStorageProvider.remove(paths);
    for (const albumId of affectedAlbums) {
      await withAlbumLock(albumId, () => recalcAlbum(albumId));
    }
  },

  async findByChecksum(albumId: string, checksum: string): Promise<Photo | null> {
    const user = await requireUser();
    const db = await getLocalDb();
    const album = await db.get("albums", albumId);
    if (!album || album.ownerId !== user.id) return null;
    const record = await db.getFromIndex("photos", "byAlbumChecksum", [albumId, checksum]);
    return record ? toPhoto(record) : null;
  },

  async setThumbnail(photoId: string, thumbnailPath: string | null): Promise<void> {
    const user = await requireUser();
    const db = await getLocalDb();
    const record = await db.get("photos", photoId);
    if (!record || record.ownerId !== user.id) return;
    await db.put("photos", { ...record, thumbnailPath });
  },
};

/* ── Chia sẻ ──────────────────────────────────────────────────── */

async function checkRateLimit(key: string): Promise<void> {
  const db = await getLocalDb();
  const record = await db.get("rateLimits", key);
  const now = Date.now();
  if (!record || now - record.windowStart > SHARE_ATTEMPT_WINDOW_MS) {
    await db.put("rateLimits", { key, attempts: 0, windowStart: now });
    return;
  }
  if (record.attempts >= SHARE_ATTEMPT_LIMIT) {
    throw new ShareAccessError(
      "rate-limited",
      "Bạn đã thử quá nhiều lần. Vui lòng chờ vài phút rồi thử lại.",
    );
  }
}

async function registerFailedAttempt(key: string): Promise<void> {
  const db = await getLocalDb();
  const record = await db.get("rateLimits", key);
  const now = Date.now();
  if (!record || now - record.windowStart > SHARE_ATTEMPT_WINDOW_MS) {
    await db.put("rateLimits", { key, attempts: 1, windowStart: now });
    return;
  }
  await db.put("rateLimits", { ...record, attempts: record.attempts + 1 });
}

async function loadShareByToken(token: string) {
  const db = await getLocalDb();
  const tokenHash = await sha256Text(token);
  const share = await db.getFromIndex("shares", "byTokenHash", tokenHash);
  return { db, tokenHash, share };
}

async function verifyShareAccess(
  token: string,
  password: string | null | undefined,
  { consumeAttempt = true } = {},
) {
  const { db, tokenHash, share } = await loadShareByToken(token);
  if (!share) {
    throw new ShareAccessError("invalid", "Liên kết chia sẻ không hợp lệ hoặc đã bị xoá.");
  }
  if (share.revokedAt) {
    throw new ShareAccessError("revoked", "Chủ album đã thu hồi liên kết này.");
  }
  if (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now()) {
    throw new ShareAccessError("expired", "Liên kết chia sẻ đã hết hạn.");
  }

  if (share.passwordHash && share.passwordSalt) {
    if (!password) {
      throw new ShareAccessError("password-required", "Album này yêu cầu mật khẩu.");
    }
    await checkRateLimit(`share:${tokenHash}`);
    const candidate = await pbkdf2Hex(password, share.passwordSalt);
    if (!timingSafeEqual(candidate, share.passwordHash)) {
      if (consumeAttempt) await registerFailedAttempt(`share:${tokenHash}`);
      throw new ShareAccessError("password-wrong", "Mật khẩu không đúng.");
    }
  }

  const album = await db.get("albums", share.albumId);
  if (!album) {
    throw new ShareAccessError("invalid", "Album của liên kết này không còn tồn tại.");
  }

  await db.put("shares", {
    ...share,
    accessCount: share.accessCount + 1,
    lastAccessedAt: new Date().toISOString(),
  });

  const owner = await db.get("users", album.ownerId);
  const ownerLabel = owner
    ? owner.displayName ||
      `${owner.email.split("@")[0].slice(0, 2)}***@${owner.email.split("@")[1] ?? ""}`
    : "Chủ album";

  return { album, share, ownerLabel };
}

const shareRepository: ShareRepository = {
  async listForAlbum(albumId: string): Promise<AlbumShare[]> {
    const user = await requireUser();
    const db = await getLocalDb();
    const album = await db.get("albums", albumId);
    if (!album || album.ownerId !== user.id) throw new ForbiddenError();
    const records = await db.getAllFromIndex("shares", "byAlbum", albumId);
    return records.map((record) => ({
      id: record.id,
      albumId: record.albumId,
      ownerId: record.ownerId,
      token: null,
      allowDownload: record.allowDownload,
      hasPassword: Boolean(record.passwordHash),
      expiresAt: record.expiresAt,
      revokedAt: record.revokedAt,
      createdAt: record.createdAt,
      accessCount: record.accessCount,
      lastAccessedAt: record.lastAccessedAt,
    }));
  },

  async create(input: CreateShareInput): Promise<AlbumShare> {
    const user = await requireUser();
    const db = await getLocalDb();
    const album = await db.get("albums", input.albumId);
    if (!album || album.ownerId !== user.id) throw new ForbiddenError("Đây không phải album của bạn.");

    const token = randomToken(32);
    const tokenHash = await sha256Text(token);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const salt = input.password ? randomHex(16) : null;
    const passwordHash = input.password && salt ? await pbkdf2Hex(input.password, salt) : null;
    const expiresAt =
      input.expiresInDays && input.expiresInDays > 0
        ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
        : null;

    await db.put("shares", {
      id,
      albumId: input.albumId,
      ownerId: user.id,
      tokenHash,
      passwordHash,
      passwordSalt: salt,
      allowDownload: input.allowDownload,
      expiresAt,
      revokedAt: null,
      createdAt: now,
      accessCount: 0,
      lastAccessedAt: null,
    });

    return {
      id,
      albumId: input.albumId,
      ownerId: user.id,
      // Token chỉ xuất hiện ở đây, đúng một lần.
      token,
      allowDownload: input.allowDownload,
      hasPassword: Boolean(passwordHash),
      expiresAt,
      revokedAt: null,
      createdAt: now,
      accessCount: 0,
      lastAccessedAt: null,
    };
  },

  async update(shareId: string, input: UpdateShareInput): Promise<AlbumShare> {
    const user = await requireUser();
    const db = await getLocalDb();
    const record = await db.get("shares", shareId);
    if (!record) throw new NotFoundError("Liên kết không tồn tại.");
    if (record.ownerId !== user.id) throw new ForbiddenError();

    let passwordHash = record.passwordHash;
    let passwordSalt = record.passwordSalt;
    if (input.removePassword) {
      passwordHash = null;
      passwordSalt = null;
    } else if (input.password) {
      passwordSalt = randomHex(16);
      passwordHash = await pbkdf2Hex(input.password, passwordSalt);
    }

    const expiresAt =
      input.expiresInDays === undefined
        ? record.expiresAt
        : input.expiresInDays === null || input.expiresInDays <= 0
          ? null
          : new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString();

    const updated = {
      ...record,
      allowDownload: input.allowDownload ?? record.allowDownload,
      passwordHash,
      passwordSalt,
      expiresAt,
    };
    await db.put("shares", updated);
    return {
      id: updated.id,
      albumId: updated.albumId,
      ownerId: updated.ownerId,
      token: null,
      allowDownload: updated.allowDownload,
      hasPassword: Boolean(updated.passwordHash),
      expiresAt: updated.expiresAt,
      revokedAt: updated.revokedAt,
      createdAt: updated.createdAt,
      accessCount: updated.accessCount,
      lastAccessedAt: updated.lastAccessedAt,
    };
  },

  async revoke(shareId: string): Promise<void> {
    const user = await requireUser();
    const db = await getLocalDb();
    const record = await db.get("shares", shareId);
    if (!record) return;
    if (record.ownerId !== user.id) throw new ForbiddenError();
    await db.put("shares", { ...record, revokedAt: new Date().toISOString() });
  },

  async resolveAccess(token: string, password?: string | null): Promise<ShareAccess> {
    const { album, share, ownerLabel } = await verifyShareAccess(token, password, {
      consumeAttempt: false,
    });
    return {
      share: {
        id: share.id,
        albumId: share.albumId,
        allowDownload: share.allowDownload,
        hasPassword: Boolean(share.passwordHash),
        expiresAt: share.expiresAt,
      },
      album: {
        id: album.id,
        title: album.title,
        description: album.description,
        coverPhotoId: album.coverPhotoId,
        photoCount: album.photoCount,
        totalBytes: album.totalBytes,
        createdAt: album.createdAt,
        updatedAt: album.updatedAt,
        ownerLabel,
      },
    };
  },

  async listSharedPhotos(token, password, query): Promise<Paged<Photo>> {
    const { album } = await verifyShareAccess(token, password);
    const db = await getLocalDb();
    const limit = Math.min(Math.max(query.limit ?? 60, 1), 200);
    const sort = query.sort ?? "uploaded-desc";
    const indexName =
      sort === "uploaded-asc"
        ? "byAlbumAsc"
        : sort === "filename-asc"
          ? "byAlbumFilename"
          : "byAlbumDesc";
    const cursorPayload = decodeCursor(query.cursor);
    const from = cursorPayload ? `${cursorPayload.key}\u0000` : "";
    const index = db.transaction("photos").store.index(indexName);

    const items: LocalPhotoRecord[] = [];
    let lastKey: string | null = null;
    let hasMore = false;
    let cursor = await index.openCursor(compactRange(album.id, from));
    while (cursor) {
      if (items.length === limit) {
        hasMore = true;
        break;
      }
      items.push(cursor.value);
      lastKey = cursor.key[1] as string;
      cursor = await cursor.continue();
    }

    return {
      items: items.map(toPhoto),
      nextCursor: hasMore && lastKey ? encodeCursor({ key: lastKey, id: items.at(-1)!.id }) : null,
      total: album.photoCount,
    };
  },

  async fetchSharedOriginalBlob(token, password, photo): Promise<Blob> {
    const { album } = await verifyShareAccess(token, password);
    // Chỉ cho phép tải ảnh thuộc đúng album của liên kết chia sẻ.
    if (photo.albumId !== album.id) throw new ForbiddenError();
    return localStorageProvider.fetchBlob(photo.storagePath);
  },
};

/* ── Dung lượng ───────────────────────────────────────────────── */

const usageRepository: UsageRepository = {
  async getUsage(): Promise<StorageUsage> {
    const user = await requireUser();
    const db = await getLocalDb();
    let usedBytes = 0;
    let photoCount = 0;
    let cursor = await db
      .transaction("photos")
      .store.index("byOwner")
      .openCursor(user.id);
    while (cursor) {
      usedBytes += cursor.value.fileSize;
      photoCount += 1;
      cursor = await cursor.continue();
    }
    const albumCount = await db.countFromIndex("albums", "byOwnerNewest", compactRange(user.id, ""));
    return {
      usedBytes,
      photoCount,
      albumCount,
      // Trình duyệt không công bố hạn mức cố định cho IndexedDB.
      quotaBytes: null,
    };
  },
};

export function createLocalBackend(): GalleryBackend {
  const auth: AuthProvider = localAuth;
  const storage: StorageProvider = localStorageProvider;
  return {
    mode: "local",
    storageKind: storage.kind,
    auth,
    albums: albumRepository,
    photos: photoRepository,
    shares: shareRepository,
    storage,
    // Cùng một kho IndexedDB; ảnh thu nhỏ được tách bằng tiền tố `thumb/`.
    thumbnailStorage: storage,
    usage: usageRepository,
    description:
      "Đang chạy ở chế độ demo cục bộ: dữ liệu chỉ lưu trong trình duyệt này. Cấu hình Supabase trong .env.local để dùng kho lưu trữ thật.",
  };
}
