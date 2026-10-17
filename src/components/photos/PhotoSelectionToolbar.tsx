import { AnimatePresence, motion } from "motion/react";
import { CheckCheck, Download, FolderDown, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatBytes, formatNumber } from "@/lib/format";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import { toolbarVariants } from "@/lib/motion";

export interface PhotoSelectionToolbarProps {
  count: number;
  totalBytes: number;
  isAllSelected: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDownload: () => void;
  onChooseFolder?: () => void;
  canChooseFolder: boolean;
  onDelete?: () => void;
  /** Hiển thị ở chế độ chỉ xem (liên kết chia sẻ không cho tải). */
  readOnly?: boolean;
}

/**
 * Thanh công cụ nổi khi có ảnh được chọn.
 *
 * Desktop: thanh nổi giữa dưới màn hình. Mobile: thanh dính dưới đáy, có hỗ trợ
 * vùng an toàn iPhone và vùng chạm tối thiểu 44px.
 */
export function PhotoSelectionToolbar({
  count,
  totalBytes,
  isAllSelected,
  onSelectAll,
  onDeselectAll,
  onDownload,
  onChooseFolder,
  canChooseFolder,
  onDelete,
  readOnly = false,
}: PhotoSelectionToolbarProps) {
  const reduced = usePrefersReducedMotion();

  return (
    <AnimatePresence>
      {count > 0 ? (
        <motion.div
          variants={reduced ? undefined : toolbarVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          role="toolbar"
          aria-label="Thao tác với ảnh đã chọn"
          className="fixed inset-x-0 bottom-0 z-40 px-3 pb-safe md:bottom-6 md:px-0"
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 rounded-3xl border border-line bg-cloud/95 p-3 shadow-float backdrop-blur md:flex-row md:items-center md:gap-3">
            <div className="flex min-w-0 items-center gap-2 md:pl-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-pastel text-[12px] font-semibold text-rose-text">
                {count > 99 ? "99+" : formatNumber(count)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">
                  Đã chọn {formatNumber(count)} ảnh
                </p>
                {totalBytes > 0 ? (
                  <p className="text-[11.5px] text-ink-soft">
                    Tổng {formatBytes(totalBytes)} ảnh gốc
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onDeselectAll}
                aria-label="Bỏ chọn tất cả"
                className="ml-auto grid size-8 shrink-0 place-items-center rounded-full text-ink-soft transition-colors hover:bg-blush hover:text-ink md:hidden"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar md:ml-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={isAllSelected ? onDeselectAll : onSelectAll}
                icon={<CheckCheck className="size-4" aria-hidden />}
                className="shrink-0"
              >
                {isAllSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
              </Button>

              {!readOnly ? (
                <>
                  {canChooseFolder && onChooseFolder ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={onChooseFolder}
                      icon={<FolderDown className="size-4" aria-hidden />}
                      className="shrink-0"
                    >
                      Chọn thư mục
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    onClick={onDownload}
                    icon={<Download className="size-4" aria-hidden />}
                    className="shrink-0"
                  >
                    Tải ảnh gốc
                  </Button>
                  {onDelete ? (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={onDelete}
                      icon={<Trash2 className="size-4" aria-hidden />}
                      aria-label="Xoá ảnh đã chọn"
                      className="shrink-0"
                    >
                      <span className="hidden sm:inline">Xoá</span>
                    </Button>
                  ) : null}
                </>
              ) : (
                <Button
                  size="sm"
                  onClick={onDownload}
                  icon={<Download className="size-4" aria-hidden />}
                  className="shrink-0"
                >
                  Tải ảnh gốc
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
