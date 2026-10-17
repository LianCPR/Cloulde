import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { FileImage } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Ảnh thu nhỏ với hiệu ứng chuyển từ nền trung tính sang ảnh đã tải.
 *
 * Kỹ thuật: nền là một gradient pastel nhẹ (giữ tỉ lệ khung ổn định, không gây
 * nhảy bố cục), ảnh thật mờ dần hiện lên khi `onLoad` xong. Không dùng canvas,
 * không biến đổi dữ liệu ảnh gốc.
 */
export function PhotoThumb({
  src,
  alt,
  className,
  fallbackLabel,
  rounding = "rounded-2xl",
}: {
  src: string | null;
  alt: string;
  className?: string;
  /** Nhãn định dạng khi không xem trước được (DNG, CR3, NEF…). */
  fallbackLabel?: string;
  rounding?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  /**
   * Ảnh báo lỗi tải (ví dụ object thu nhỏ không còn trên kho lưu trữ).
   *
   * Cần trạng thái riêng: nếu chỉ dựa vào `loaded`, lớp phủ chờ sẽ nhấp nháy mãi
   * mãi và người xem không biết ảnh hỏng hay còn đang tải. Hiện biểu tượng định
   * dạng thì trung thực hơn.
   */
  const [failed, setFailed] = useState(false);

  // Lưới tái sử dụng ô khi cuộn: đổi `src` phải quên kết quả của ảnh trước, nếu
  // không một ảnh lỗi sẽ làm mọi ảnh sau vào cùng ô đều không hiện được.
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  return (
    <div
      className={cn(
        "relative isolate overflow-hidden bg-gradient-to-br from-blush/70 via-pastel/50 to-beige/60",
        rounding,
        className,
      )}
    >
      {src && !failed ? (
        <motion.img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            setFailed(true);
          }}
          initial={false}
          animate={{ opacity: loaded ? 1 : 0, scale: loaded ? 1 : 1.01 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1.5 text-ink-soft">
          <FileImage className="size-5" aria-hidden />
          {fallbackLabel ? (
            <span className="text-[10.5px] font-medium uppercase tracking-wide">
              {fallbackLabel}
            </span>
          ) : null}
        </div>
      )}

      {/* Lớp phủ mờ nhẹ trong lúc chờ ảnh tải xong. */}
      {src && !failed && !loaded ? (
        <div
          aria-hidden
          className="absolute inset-0 animate-shimmer bg-gradient-to-br from-blush/60 to-beige/60"
        />
      ) : null}
    </div>
  );
}
