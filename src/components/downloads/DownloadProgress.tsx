import { motion } from "motion/react";
import { AlertCircle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { DownloadProgress as Progress } from "@/types";
import { formatBytes, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

const STATUS_LABEL: Record<Progress["status"], string> = {
  idle: "Chưa bắt đầu",
  preparing: "Đang chuẩn bị",
  running: "Đang tải xuống",
  zipping: "Đang tạo gói ZIP",
  completed: "Hoàn tất",
  failed: "Thất bại",
  cancelled: "Đã huỷ",
};

/**
 * Hiển thị tiến độ tải xuống một cách trung thực.
 *
 * Chỉ hiển thị phần trăm khi trình duyệt thực sự cung cấp được số byte; nếu
 * không, ta chỉ nói đang xử lý tệp nào thay vì bịa ra con số.
 */
export function DownloadProgressView({
  progress,
  className,
}: {
  progress: Progress;
  className?: string;
}) {
  const hasFraction = progress.fraction !== null;
  const percent = hasFraction ? Math.round((progress.fraction ?? 0) * 100) : null;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2 text-[13px]">
        <StatusIcon status={progress.status} />
        <span className="font-medium">{STATUS_LABEL[progress.status]}</span>
        {progress.totalFiles > 0 ? (
          <span className="text-ink-soft">
            {formatNumber(progress.completedFiles)}/{formatNumber(progress.totalFiles)} tệp
          </span>
        ) : null}
        {percent !== null ? (
          <span className="ml-auto tabular-nums text-ink-soft">{percent}%</span>
        ) : null}
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-label="Tiến độ tải xuống"
      >
        <motion.div
          className={cn(
            "h-full rounded-full",
            progress.status === "failed" ? "bg-danger" : "bg-rose",
          )}
          animate={{ width: percent !== null ? `${percent}%` : "35%" }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-ink-soft">
        {progress.currentFile ? (
          <div className="col-span-2 min-w-0">
            <dt className="inline">Tệp hiện tại: </dt>
            <dd className="inline truncate text-ink">{progress.currentFile}</dd>
          </div>
        ) : null}
        {progress.totalBytes > 0 ? (
          <div>
            <dt className="inline">Dung lượng: </dt>
            <dd className="inline">
              {formatBytes(progress.processedBytes)} / {formatBytes(progress.totalBytes)}
            </dd>
          </div>
        ) : null}
        {progress.failedFiles > 0 ? (
          <div className="text-danger">
            <dt className="inline">Tệp lỗi: </dt>
            <dd className="inline">{progress.failedFiles}</dd>
          </div>
        ) : null}
      </dl>

      {progress.message ? (
        <p className="rounded-2xl bg-blush/50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink">
          {progress.message}
        </p>
      ) : null}

      {progress.errors.length > 0 ? (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-2xl border border-danger/25 bg-danger/5 p-2.5 text-[12px]">
          {progress.errors.map((error) => (
            <li key={`${error.filename}-${error.message}`} className="flex gap-2">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate font-medium">{error.filename}</span>
                <span className="block text-ink-soft">{error.message}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function StatusIcon({ status }: { status: Progress["status"] }) {
  if (status === "completed") {
    return <CheckCircle2 className="size-4 text-success" aria-hidden />;
  }
  if (status === "failed") {
    return <XCircle className="size-4 text-danger" aria-hidden />;
  }
  if (status === "cancelled") {
    return <XCircle className="size-4 text-ink-soft" aria-hidden />;
  }
  return <Loader2 className="size-4 animate-spin-slow text-rose" aria-hidden />;
}
