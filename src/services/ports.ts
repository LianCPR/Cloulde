import type {
  AccountUser,
  ActiveUploadSession,
  Album,
  AlbumQuery,
  AlbumShare,
  ArchiveHealth,
  ArchiveMaintenanceResult,
  ArchiveUsage,
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

/**
 * Cổng giao tiếp (ports) giữa tầng UI và tầng lưu trữ.
 *
 * Nhờ lớp trừu tượng này, ứng dụng có thể chạy trên:
 *   - Supabase (Postgres + Storage + Auth) — môi trường sản xuất.
 *   - IndexedDB nội bộ (backend `local`) — phát triển/demo không cần khoá.
 *   - Một nhà cung cấp lưu trữ khác trong tương lai (R2, S3, B2…) mà không
 *     phải viết lại bất kỳ component React nào.
 */

export interface StorageUploadOptions {
  path: string;
  file: Blob;
  contentType: string;
  /** Cho phép ghi đè object cùng đường dẫn (mặc định false). */
  upsert?: boolean;
  cacheControl?: string;
  onProgress?: (fraction: number, uploadedBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
}

/** Nhà cung cấp lưu trữ object cho ảnh GỐC, ảnh thu nhỏ và gói ZIP tạm. */
export interface StorageProvider {
  readonly kind: string;
  /** Tải lên nguyên byte tệp được truyền vào. */
  upload(options: StorageUploadOptions): Promise<void>;
  /** Tải về nguyên byte của object — dùng cho mọi thao tác tải xuống. */
  fetchBlob(path: string, signal?: AbortSignal): Promise<Blob>;
  /** URL dùng được trực tiếp trong <img src>. Có thể hết hạn. */
  createUrl(path: string, expiresInSeconds?: number): Promise<string>;
  /** URL tải xuống kèm tên tệp (Content-Disposition) nếu nhà cung cấp hỗ trợ. */
  createDownloadUrl(
    path: string,
    filename: string,
    expiresInSeconds?: number,
  ): Promise<string>;
  remove(paths: string[]): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Ký nhiều URL trong một yêu cầu (nếu nhà cung cấp hỗ trợ). */
  createUrls?(
    paths: string[],
    expiresInSeconds?: number,
  ): Promise<Record<string, string>>;
  /** Giải phóng tài nguyên URL (chỉ backend local cần). */
  releaseUrl(url: string): void;
}

export interface AlbumRepository {
  list(query: AlbumQuery): Promise<Paged<Album>>;
  get(albumId: string): Promise<Album | null>;
  create(input: CreateAlbumInput): Promise<Album>;
  update(albumId: string, input: UpdateAlbumInput): Promise<Album>;
  remove(albumId: string): Promise<void>;
  /** Album gần đây cho thanh điều hướng / trang cài đặt. */
  listRecent(limit: number): Promise<Album[]>;
}

export interface PhotoRepository {
  list(query: PhotoQuery): Promise<Paged<Photo>>;
  get(photoId: string): Promise<Photo | null>;
  /** Danh sách đầy đủ (chỉ id + đường dẫn) để tải cả album — không kèm ảnh. */
  listAllMetadata(albumId: string): Promise<Photo[]>;
  insert(photo: Omit<Photo, "id" | "createdAt"> & Partial<Pick<Photo, "id">>): Promise<Photo>;
  remove(photoIds: string[]): Promise<void>;
  /** Ảnh trùng nội dung (cùng SHA-256) trong một album. */
  findByChecksum(albumId: string, checksum: string): Promise<Photo | null>;
  setThumbnail(photoId: string, thumbnailPath: string | null): Promise<void>;
}

export interface ShareRepository {
  listForAlbum(albumId: string): Promise<AlbumShare[]>;
  /** Tạo liên kết mới và trả về token dạng thô DUY NHẤT một lần. */
  create(input: CreateShareInput): Promise<AlbumShare>;
  update(shareId: string, input: UpdateShareInput): Promise<AlbumShare>;
  revoke(shareId: string): Promise<void>;
  /**
   * Dành cho khách: xác minh token + mật khẩu ở phía server/backend.
   * Không bao giờ trả về dữ liệu album nếu token sai, đã thu hồi hoặc hết hạn.
   */
  resolveAccess(token: string, password?: string | null): Promise<ShareAccess>;
  /**
   * Danh sách ảnh của album được chia sẻ. Việc phân quyền do backend quyết
   * định dựa trên token + mật khẩu, không dựa vào bất kỳ tham số nào từ URL.
   */
  listSharedPhotos(
    token: string,
    password: string | null,
    query: Omit<PhotoQuery, "albumId">,
  ): Promise<Paged<Photo>>;
  /** Tải NGUYÊN BYTE ảnh gốc cho khách có quyền xem liên kết chia sẻ. */
  fetchSharedOriginalBlob(
    token: string,
    password: string | null,
    photo: Photo,
  ): Promise<Blob>;
  /**
   * URL xem trước cho lưới ảnh của khách (kho lưu trữ riêng tư: URL có chữ ký,
   * ngắn hạn, chỉ mở đúng ảnh trong album được chia sẻ).
   */
  resolveGuestUrls?(
    token: string,
    password: string | null,
    photos: Photo[],
    purpose: "thumbnail" | "original",
  ): Promise<Record<string, string>>;
  /** URL tải xuống ngắn hạn cho khách — dùng để đọc theo luồng, không nạp cả tệp. */
  createGuestDownloadUrl?(
    token: string,
    password: string | null,
    photo: Photo,
  ): Promise<string>;
}

export interface AuthResult {
  user: AccountUser;
  /** Chỉ backend local dùng: phiên được tạo trực tiếp. */
  sessionCreated: boolean;
}

export interface AuthProvider {
  readonly kind: "supabase" | "local" | "archive";
  getCurrentUser(): Promise<AccountUser | null>;
  onAuthStateChange(callback: (user: AccountUser | null) => void): () => void;
  signUp(email: string, password: string, displayName?: string): Promise<AuthResult>;
  signIn(email: string, password: string): Promise<AuthResult>;
  signInWithOtp?(email: string): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(newPassword: string): Promise<void>;
}

export interface UsageRepository {
  getUsage(): Promise<StorageUsage>;
}

/* ── Tải lên nhiều phần (kho lưu trữ thật) ─────────────────────────────── */

/**
 * Giai đoạn của một lần tải lên nhiều phần.
 * `hashing` chạy TRƯỚC khi gửi byte nào — nhờ vậy ảnh trùng bị chặn trước khi
 * tốn bằng thông để gửi 500 MB.
 */
export type MultipartPhase = "hashing" | "uploading" | "verifying";

export interface MultipartProgress {
  phase: MultipartPhase;
  /** Phiên trên server — dùng để nối tiếp sau khi đóng tab. */
  sessionId: string | null;
  /** Byte đã nằm trên kho lưu trữ (các phần đã xác nhận), không phải ước lượng. */
  uploadedBytes: number;
  totalBytes: number;
  /** Số thứ tự các phần đã xác nhận (1-based), đọc từ server. */
  completedParts: number[];
  totalParts: number;
  /** Kích thước mỗi phần do SERVER chọn — client không được tự đoán. */
  partSize: number;
  /** Phiên cũ được nối tiếp thay vì tạo mới. */
  resumed: boolean;
}

export interface MultipartUploadRequest {
  albumId: string;
  file: File;
  filename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  previewable: boolean;
  /** SHA-256 hex của tệp gốc; `null` nếu chưa băm. */
  checksum: string | null;
  /**
   * Nối tiếp phiên đã có thay vì tạo phiên mới. Khi resume, checksum đã có thể
   * bỏ trống — server vẫn tự băm lại sau khi ghép.
   */
  resumeSessionId?: string | null;
  onProgress?: (progress: MultipartProgress) => void;
  signal?: AbortSignal;
}

export interface MultipartUploadResult {
  photo: Photo;
  sessionId: string;
  resumed: boolean;
  /** Kích thước server đã xác minh sau khi ghép các phần. */
  verifiedBytes: number;
}

/**
 * Khả năng tải lên nhiều phần của một kho lưu trữ.
 *
 * Tồn tại vì một request duy nhất KHÔNG thể mang 500 MB: Cloudflare giới hạn
 * thân request ở 100 MB và không thể vượt bằng cách stream. Chia phần còn mang
 * lại lợi ích thật: resume sau khi mất mạng, chỉ gửi lại phần lỗi.
 */
export interface MultipartUploader {
  readonly kind: string;
  upload(request: MultipartUploadRequest): Promise<MultipartUploadResult>;
  /**
   * Gắn ảnh thu nhỏ cho một ảnh đã lưu trữ (không thay đổi ảnh gốc).
   *
   * Trả về ĐƯỜNG DẪN của ảnh thu nhỏ để tầng gọi cập nhật lại đối tượng ảnh
   * đang giữ trong bộ nhớ. Nếu bỏ qua việc cập nhật này, lưới thư viện sẽ tưởng
   * ảnh chưa có bản thu nhỏ và tải thẳng ẢNH GỐC để hiển thị — với tệp hàng trăm
   * MB thì đó là thảm hoạ băng thông. Trả `null` khi backend không biểu diễn
   * được đường dẫn ảnh thu nhỏ.
   */
  attachThumbnail(photoId: string, blob: Blob, mimeType: string): Promise<string | null>;
  /** Phiên còn dở, đọc từ SERVER — không phải từ bộ nhớ trình duyệt. */
  listActiveSessions(): Promise<ActiveUploadSession[]>;
  abortSession(sessionId: string): Promise<void>;
  /** Xác minh lại SHA-256 cho một ảnh ngay bây giờ. */
  verifyPhoto(photoId: string): Promise<void>;
}

export interface GalleryBackend {
  readonly mode: "supabase" | "local" | "archive";
  readonly storageKind: string;
  readonly auth: AuthProvider;
  readonly albums: AlbumRepository;
  readonly photos: PhotoRepository;
  readonly shares: ShareRepository;
  /** Bucket/kho chứa ẢNH GỐC (bất biến). */
  readonly storage: StorageProvider;
  /** Kho riêng cho ảnh thu nhỏ — có thể xoá và tạo lại bất cứ lúc nào. */
  readonly thumbnailStorage: StorageProvider;
  readonly usage: UsageRepository;
  /** Có khi backend hỗ trợ tải lên nhiều phần (kho lưu trữ thật). */
  readonly multipart?: MultipartUploader;
  /** Chi tiết dung lượng/chi phí/hàng đợi — chỉ backend kho lưu trữ có. */
  readonly usageDetails?: () => Promise<ArchiveUsage>;
  /** Kiểm tra sức khoẻ thật (ghi/đọc/xoá object thử). */
  readonly health?: () => Promise<ArchiveHealth>;
  /**
   * Chạy bảo trì: dọn phiên tải lên bỏ dở và xác minh checksum theo lô.
   * Không có Cron Trigger thì đây chính là cách hàng đợi tiến lên.
   */
  readonly runMaintenance?: () => Promise<ArchiveMaintenanceResult>;
  /** Thông tin hiển thị cho người dùng về môi trường đang chạy. */
  readonly description: string;
}
