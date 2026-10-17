import { memo } from "react";
import { motion } from "motion/react";
import { Check, Maximize2 } from "lucide-react";
import type { Photo } from "@/types";
import { useMediaSrc } from "@/hooks/useMediaSrc";
import { PhotoThumb } from "./PhotoThumb";
import { cn } from "@/lib/cn";
import { formatBytes, truncateMiddle } from "@/lib/format";
import { formatLabelFromMime } from "@/lib/fileTypes";

export interface PhotoCardProps {
  photo: Photo;
  selected: boolean;
  selectionMode: boolean;
  onToggle: (photoId: string) => void;
  onOpen: (photoId: string) => void;
  /** Khách xem liên kết chia sẻ dùng bộ nạp URL riêng. */
  resolver?: Parameters<typeof useMediaSrc>[2];
}

/**
 * Một ô ảnh trong lưới.
 *
 * - Nhấp để mở trình xem ảnh full-size.
 * - Nút chọn ở góc trên bên trái: xuất hiện khi rê chuột (desktop) hoặc luôn
 *   hiển thị khi đang ở chế độ chọn (mobile).
 * - `memo` để lưới vài nghìn ảnh không re-render toàn bộ khi chọn một ảnh.
 */
export const PhotoCard = memo(function PhotoCard({
  photo,
  selected,
  selectionMode,
  onToggle,
  onOpen,
  resolver,
}: PhotoCardProps) {
  const media = useMediaSrc(photo, "thumbnail", resolver);

  return (
    <motion.div
      layout={false}
      className={cn(
        "group relative overflow-hidden rounded-2xl bg-blush/40 transition-shadow duration-200",
        selected
          ? "ring-2 ring-rose ring-offset-2 ring-offset-cream"
          : "hover:shadow-lift focus-within:shadow-lift",
      )}
    >
      <button
        type="button"
        onClick={() => (selectionMode ? onToggle(photo.id) : onOpen(photo.id))}
        onDoubleClick={() => onOpen(photo.id)}
        aria-label={
          selectionMode
            ? `${selected ? "Bỏ chọn" : "Chọn"} ảnh ${photo.originalFilename}`
            : `Mở ảnh ${photo.originalFilename}`
        }
        aria-pressed={selectionMode ? selected : undefined}
        className="block w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
      >
        <PhotoThumb
          src={media.src}
          alt={`Ảnh ${photo.originalFilename}`}
          rounding="rounded-2xl"
          className="aspect-square"
          fallbackLabel={formatLabelFromMime(photo.mimeType, photo.originalFilename)}
        />
        <span className="sr-only">{photo.originalFilename}</span>
      </button>

      {/* Nút chọn ảnh */}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggle(photo.id);
        }}
        aria-label={selected ? `Bỏ chọn ${photo.originalFilename}` : `Chọn ${photo.originalFilename}`}
        aria-pressed={selected}
        // Vùng chạm được mở rộng thêm 6px mỗi phía (tổng 44px) bằng lớp
        // giả `after` trong suốt, đủ chuẩn vùng chạm trên thiết bị cảm ứng.
        className={cn(
          "absolute left-2 top-2 grid size-8 place-items-center rounded-full border transition-all duration-200 after:absolute after:-inset-1.5 after:content-['']",
          selected
            ? "border-rose bg-rose text-warm"
            : "border-line/80 bg-cloud/85 text-ink-soft backdrop-blur hover:border-rose/60 hover:text-ink",
          selectionMode || selected
            ? "opacity-100"
            : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        {selected ? (
          <motion.span
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 28 }}
          >
            <Check className="size-4" aria-hidden />
          </motion.span>
        ) : (
          <span aria-hidden className="size-3.5 rounded-full border border-ink-soft/50" />
        )}
      </button>

      {/* Nút mở nhanh trên desktop */}
      <button
        type="button"
        onClick={() => onOpen(photo.id)}
        aria-label={`Xem ảnh ${photo.originalFilename}`}
        className="absolute right-2 top-2 grid size-8 place-items-center rounded-full border border-line/80 bg-cloud/85 text-ink-soft opacity-0 backdrop-blur transition-all duration-200 after:absolute after:-inset-1.5 after:content-[''] hover:border-rose/60 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <Maximize2 className="size-3.5" aria-hidden />
      </button>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-1 bg-gradient-to-t from-ink/55 to-transparent px-2.5 pb-2 pt-6 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
        <p className="truncate text-[11.5px] font-medium text-warm">
          {truncateMiddle(photo.originalFilename, 28)}
        </p>
        <p className="text-[10.5px] text-warm/80">{formatBytes(photo.fileSize)}</p>
      </div>
    </motion.div>
  );
});
