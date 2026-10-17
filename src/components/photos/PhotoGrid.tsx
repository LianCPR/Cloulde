import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import type { Photo } from "@/types";
import { PhotoCard } from "./PhotoCard";
import { PhotoGridSkeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { staggerContainer } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";

export interface PhotoGridProps {
  photos: Photo[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  selectedIds: Set<string>;
  onToggle: (photoId: string) => void;
  onOpen: (photoId: string, index: number) => void;
  resolver?: Parameters<typeof PhotoCard>[0]["resolver"];
}

/**
 * Lưới ảnh.
 *
 * - `loading="lazy"` trên mọi ảnh: trình duyệt chỉ tải ảnh gần vùng nhìn thấy.
 * - Nạp thêm khi cuộn tới cuối bằng IntersectionObserver (không dùng sự kiện
 *   scroll, tránh giật khung hình) với ngưỡng trước 600px.
 * - Nút "Tải thêm" luôn hiện để người dùng chủ động kiểm soát, kể cả khi
 *   trình duyệt không hỗ trợ IntersectionObserver.
 */
export function PhotoGrid({
  photos,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  selectedIds,
  onToggle,
  onOpen,
  resolver,
}: PhotoGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const selectionMode = selectedIds.size > 0;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, photos.length]);

  if (loading) return <PhotoGridSkeleton count={12} />;

  return (
    <div>
      <motion.ul
        variants={reduced ? undefined : staggerContainer(0.02, 0)}
        initial={reduced ? undefined : "initial"}
        animate={reduced ? undefined : "animate"}
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
      >
        {photos.map((photo, index) => (
          <motion.li
            key={photo.id}
            className="list-none"
            initial={reduced ? undefined : { opacity: 0, scale: 0.98 }}
            animate={reduced ? undefined : { opacity: 1, scale: 1 }}
            transition={{ duration: 0.24, delay: Math.min(index, 12) * 0.015 }}
          >
            <PhotoCard
              photo={photo}
              selected={selectedIds.has(photo.id)}
              selectionMode={selectionMode}
              onToggle={onToggle}
              onOpen={() => onOpen(photo.id, index)}
              resolver={resolver}
            />
          </motion.li>
        ))}
      </motion.ul>

      <div ref={sentinelRef} className="mt-6 flex flex-col items-center gap-3">
        {loadingMore ? (
          <p className="flex items-center gap-2 text-[13px] text-ink-soft">
            <Loader2 className="size-4 animate-spin-slow" aria-hidden />
            Đang tải thêm ảnh…
          </p>
        ) : hasMore ? (
          <Button variant="secondary" onClick={onLoadMore}>
            Tải thêm ảnh
          </Button>
        ) : photos.length > 0 ? (
          <p className="text-[12.5px] text-ink-soft">
            Đã hiển thị toàn bộ {photos.length} ảnh trong album.
          </p>
        ) : null}
      </div>
    </div>
  );
}
