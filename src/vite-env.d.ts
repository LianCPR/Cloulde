/// <reference types="vite/client" />

/**
 * Khai báo kiểu cho các biến môi trường dùng ở phía trình duyệt.
 * Chỉ những biến có tiền tố VITE_ mới được Vite nhúng vào bundle.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_ORIGINALS_BUCKET?: string;
  readonly VITE_THUMBNAILS_BUCKET?: string;
  readonly VITE_ARCHIVES_BUCKET?: string;
  readonly VITE_MAX_UPLOAD_BYTES?: string;
  readonly VITE_UPLOAD_CONCURRENCY?: string;
  readonly VITE_DOWNLOAD_CONCURRENCY?: string;
  readonly VITE_ZIP_WARN_BYTES?: string;
  readonly VITE_ZIP_MAX_BYTES?: string;
  readonly VITE_ZIP_MAX_FILES?: string;
  readonly VITE_BACKEND?: string;
  readonly VITE_SHARE_FUNCTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
