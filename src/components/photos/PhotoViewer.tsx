import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileImage,
  Info,
  Minimize2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Photo } from "@/types";
import { formatBytes, formatDateTime } from "@/lib/format";
import { formatLabelFromMime } from "@/lib/fileTypes";
import { cn } from "@/lib/cn";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import { announce } from "@/components/ui/LiveRegion";

export interface PhotoViewerProps {
  photos: Photo[];
  index: number | null;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  /** URL ảnh full-size cho ảnh đang mở (do trang gọi cung cấp). */
  resolveViewerUrl: (photo: Photo) => Promise<string>;
  onDownload: (photo: Photo) => void;
  readOnly?: boolean;
}

/**
 * Trình xem ảnh.
 *
 * - Ảnh hiển thị là ẢNH GỐC (không crop, `object-contain`), không dùng thumbnail
 *   phóng to.
 * - Bàn phím: ←/→ chuyển ảnh, Esc đóng, +/- phóng, 0 đặt lại.
 * - Mobile: vuốt ngang để chuyển ảnh, chạm hai ngón để phóng, kéo để di chuyển
 *   khi đang phóng.
 * - Ảnh kế tiếp được nạp trước để chuyển ảnh không bị chờ.
 */
export function PhotoViewer({
  photos,
  index,
  onClose,
  onIndexChange,
  resolveViewerUrl,
  onDownload,
  readOnly = false,
}: PhotoViewerProps) {
  const photo = index === null ? null : (photos[index] ?? null);
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [showInfo, setShowInfo] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const open = photo !== null;

  const go = useCallback(
    (delta: number) => {
      if (index === null) return;
      const next = index + delta;
      if (next < 0 || next >= photos.length) return;
      setScale(1);
      onIndexChange(next);
    },
    [index, onIndexChange, photos.length],
  );

  // Nạp ảnh full-size của ảnh đang mở.
  useEffect(() => {
    if (!photo) return;
    let active = true;
    setLoading(true);
    setError(null);
    setSrc(null);
    resolveViewerUrl(photo)
      .then((url) => {
        if (active) {
          setSrc(url);
          setLoading(false);
        }
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setLoading(false);
        setError(caught instanceof Error ? caught.message : "Không mở được ảnh.");
      });
    announce(`Đang xem ${photo.originalFilename}. Ảnh ${(index ?? 0) + 1} trên ${photos.length}.`);
    return () => {
      active = false;
    };
  }, [index, photo, photos.length, resolveViewerUrl]);

  // Nạp trước ảnh kế tiếp và ảnh trước đó để chuyển ảnh tức thì.
  useEffect(() => {
    if (index === null) return;
    const neighbours = [photos[index + 1], photos[index - 1]].filter(Boolean) as Photo[];
    let cancelled = false;
    void (async () => {
      for (const neighbour of neighbours) {
        if (cancelled) return;
        if (!neighbour.previewable) continue;
        await resolveViewerUrl(neighbour).catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [index, photos, resolveViewerUrl]);

  // Bàn phím + khoá cuộn nền khi mở.
  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handler = (event: KeyboardEvent) => {
      switch (event.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowRight":
          go(1);
          break;
        case "ArrowLeft":
          go(-1);
          break;
        case "+":
        case "=":
          setScale((value) => Math.min(4, value + 0.5));
          break;
        case "-":
          setScale((value) => Math.max(1, value - 0.5));
          break;
        case "0":
          setScale(1);
          break;
        default:
          break;
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = originalOverflow;
    };
  }, [go, onClose, open]);

  // Chạm hai ngón để phóng.
  useEffect(() => {
    const element = containerRef.current;
    if (!element || !open) return;
    let initialDistance = 0;
    let initialScale = 1;

    const distance = (touches: TouchList) => {
      const [a, b] = [touches[0], touches[1]];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        initialDistance = distance(event.touches);
        initialScale = scale;
      }
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length === 2 && initialDistance > 0) {
        event.preventDefault();
        const ratio = distance(event.touches) / initialDistance;
        setScale(Math.min(4, Math.max(1, initialScale * ratio)));
      }
    };
    element.addEventListener("touchstart", onTouchStart, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
    };
  }, [open, scale]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && photo ? (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`Trình xem ảnh: ${photo.originalFilename}`}
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.99 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.99 }}
          transition={{ duration: reduced ? 0.01 : 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-50 flex flex-col bg-ink/94"
        >
          {/* Thanh trên */}
          <div className="flex items-center gap-2 px-3 py-3 pt-safe sm:px-5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium text-warm">
                {photo.originalFilename}
              </p>
              <p className="text-[11.5px] text-warm/60">
                {(index ?? 0) + 1} / {photos.length}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowInfo((value) => !value)}
              aria-expanded={showInfo}
              aria-label="Thông tin ảnh"
              className="grid size-10 place-items-center rounded-full text-warm/80 transition-colors hover:bg-warm/10 hover:text-warm"
            >
              <Info className="size-4.5" aria-hidden />
            </button>
            <div className="hidden items-center gap-1 sm:flex">
              <ViewerButton label="Thu nhỏ" onClick={() => setScale((value) => Math.max(1, value - 0.5))}>
                <ZoomOut className="size-4.5" aria-hidden />
              </ViewerButton>
              <ViewerButton
                label={scale > 1 ? "Đặt lại tỉ lệ" : "Phóng to"}
                onClick={() => setScale((value) => (value > 1 ? 1 : 2))}
              >
                {scale > 1 ? <Minimize2 className="size-4.5" aria-hidden /> : <ZoomIn className="size-4.5" aria-hidden />}
              </ViewerButton>
            </div>
            {!readOnly ? (
              <button
                type="button"
                onClick={() => onDownload(photo)}
                className="flex h-10 items-center gap-2 rounded-full bg-pastel/95 px-3.5 text-[13px] font-medium text-rose-text transition-colors hover:bg-rose/50"
              >
                <Download className="size-4" aria-hidden />
                <span className="hidden sm:inline">Tải ảnh gốc</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng trình xem ảnh"
              className="grid size-10 place-items-center rounded-full text-warm/80 transition-colors hover:bg-warm/10 hover:text-warm"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>

          {/* Vùng ảnh */}
          <div
            ref={containerRef}
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2 pb-2"
          >
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={(index ?? 0) === 0}
              aria-label="Ảnh trước"
              className="absolute left-2 z-10 grid size-11 place-items-center rounded-full bg-ink/50 text-warm transition-opacity hover:bg-ink/70 disabled:opacity-25"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>

            {error ? (
              <div className="max-w-sm rounded-3xl bg-warm/95 p-6 text-center">
                <FileImage className="mx-auto mb-3 size-6 text-ink-soft" aria-hidden />
                <p className="text-sm font-medium">Không xem trước được định dạng này</p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">
                  {formatLabelFromMime(photo.mimeType, photo.originalFilename)} có thể không được
                  trình duyệt hỗ trợ hiển thị. Ảnh gốc vẫn nguyên vẹn và tải xuống được.
                </p>
              </div>
            ) : photo.previewable && src ? (
              <motion.img
                key={photo.id}
                src={src}
                alt={`Ảnh gốc: ${photo.originalFilename}`}
                drag={scale > 1}
                dragMomentum={false}
                dragConstraints={{ left: -400, right: 400, top: -400, bottom: 400 }}
                onDragEnd={(_, info) => {
                  if (scale > 1) return;
                  if (info.offset.x < -80) go(1);
                  else if (info.offset.x > 80) go(-1);
                }}
                initial={reduced ? undefined : { opacity: 0 }}
                animate={{ opacity: 1, scale }}
                transition={{ duration: reduced ? 0.01 : 0.2 }}
                onDoubleClick={() => setScale((value) => (value > 1 ? 1 : 2))}
                draggable={false}
                className={cn(
                  "max-h-full max-w-full select-none object-contain",
                  scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
                )}
              />
            ) : loading || !src ? (
              <div className="flex flex-col items-center gap-3 text-warm/70">
                <span className="size-8 animate-spin-slow rounded-full border-2 border-warm/30 border-t-warm" />
                <p className="text-[13px]">Đang mở ảnh gốc…</p>
              </div>
            ) : (
              <div className="max-w-sm rounded-3xl bg-warm/95 p-6 text-center">
                <FileImage className="mx-auto mb-3 size-6 text-ink-soft" aria-hidden />
                <p className="text-sm font-medium">
                  Định dạng {formatLabelFromMime(photo.mimeType, photo.originalFilename)} không xem
                  trước được trong trình duyệt
                </p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">
                  Ảnh gốc vẫn được lưu nguyên vẹn. Hãy tải xuống để mở bằng phần mềm chuyên dụng
                  (Lightroom, Capture One, trình xem ảnh của hệ điều hành…).
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => go(1)}
              disabled={(index ?? 0) === photos.length - 1}
              aria-label="Ảnh tiếp theo"
              className="absolute right-2 z-10 grid size-11 place-items-center rounded-full bg-ink/50 text-warm transition-opacity hover:bg-ink/70 disabled:opacity-25"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </div>

          {/* Bảng thông tin */}
          <AnimatePresence>
            {showInfo ? (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: reduced ? 0.01 : 0.22 }}
                className="overflow-hidden border-t border-warm/15 pb-safe"
              >
                <dl className="mx-auto grid max-w-2xl grid-cols-2 gap-x-6 gap-y-2 px-5 py-4 text-[12.5px] sm:grid-cols-3">
                  <InfoItem label="Tên tệp gốc" value={photo.originalFilename} span />
                  <InfoItem label="Định dạng" value={photo.mimeType || "—"} />
                  <InfoItem label="Kích thước" value={formatBytes(photo.fileSize)} />
                  <InfoItem
                    label="Độ phân giải"
                    value={
                      photo.width && photo.height ? `${photo.width} × ${photo.height}` : "Không đọc được"
                    }
                  />
                  <InfoItem label="Tải lên" value={formatDateTime(photo.createdAt)} />
                  <InfoItem
                    label="SHA-256"
                    value={photo.checksum ? `${photo.checksum.slice(0, 16)}…` : "Chưa tính"}
                    span
                  />
                </dl>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function ViewerButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-10 place-items-center rounded-full text-warm/80 transition-colors hover:bg-warm/10 hover:text-warm"
    >
      {children}
    </button>
  );
}

function InfoItem({
  label,
  value,
  span,
}: {
  label: string;
  value: string;
  span?: boolean;
}) {
  return (
    <div className={cn(span && "col-span-2")}>
      <dt className="text-[11px] uppercase tracking-wide text-warm/50">{label}</dt>
      <dd className="truncate text-warm/90">{value}</dd>
    </div>
  );
}
