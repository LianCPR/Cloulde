import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  UploadCloud,
  X,
} from "lucide-react";
import type { ActiveUploadSession, Photo, UploadItem } from "@/types";
import { uploadLimitBytes } from "@/config/env";
import { isUploadAckValid, markUploadAck } from "@/lib/uploadAck";
import { PHOTO_ACCEPT_ATTRIBUTE as ACCEPT } from "@/lib/fileTypes";
import { useUploadQueue } from "@/hooks/useUploadQueue";
import { Button } from "@/components/ui/Button";
import { formatBytes, formatCount, truncateMiddle } from "@/lib/format";
import { cn } from "@/lib/cn";
import { announce } from "@/components/ui/LiveRegion";
import { toastSuccess } from "@/components/ui/Toast";

/**
 * Khu vực tải ảnh lên.
 *
 * - Kéo thả trên desktop, chọn tệp trên desktop và mobile.
 * - Nhiều tệp cùng lúc, có giới hạn số luồng (mặc định 3).
 * - Tiến độ theo từng tệp và tiến độ tổng; huỷ và thử lại được.
 * - Ảnh gốc được tải lên nguyên byte; ảnh thu nhỏ sinh riêng sau đó.
 */
export function UploadPanel({
  albumId,
  onPhotoUploaded,
  compact = false,
  resumeRequest = null,
}: {
  albumId: string;
  onPhotoUploaded?: (photo: Photo) => void;
  compact?: boolean;
  /**
   * Yêu cầu nối tiếp một phiên dở: tệp gốc người dùng vừa chọn lại cho phiên đó.
   * Đặt ở đây (thay vì tạo hàng đợi thứ hai) để mọi tệp dùng chung một hàng đợi
   * và chung giới hạn số luồng.
   */
  resumeRequest?: { session: ActiveUploadSession; file: File } | null;
}) {
  const [dragging, setDragging] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  /**
   * "Đã đọc và xác nhận": mỗi trình duyệt chỉ cần xác nhận MỘT lần. Đã lưu
   * localStorage từ trước thì ô này tự được coi là đã tick — người dùng không
   * phải tick lại mỗi lần tải ảnh.
   */
  const [ackPlanned, setAckPlanned] = useState<boolean | null>(null);
  useEffect(() => {
    setAckPlanned(isUploadAckValid());
  }, []);
  const [ack, setAck] = useState(false);

  const {
    items,
    summary,
    addFiles,
    resumeSession,
    retryFailed,
    retryItem,
    cancelItem,
    cancelAll,
    clearFinished,
  } = useUploadQueue(albumId, (photo) => {
    onPhotoUploaded?.(photo);
  });

  // Mỗi yêu cầu nối tiếp chỉ được xử lý MỘT lần (React có thể gọi lại effect).
  const handledResume = useRef<string | null>(null);
  useEffect(() => {
    if (!resumeRequest) return;
    const { session, file } = resumeRequest;
    const key = `${session.id}:${file.size}:${file.lastModified}`;
    if (handledResume.current === key) return;
    handledResume.current = key;
    setShowDetails(true);
    try {
      resumeSession(session, file);
      announce(`Đang nối tiếp phiên cho ${session.originalFilename}.`);
    } catch (error) {
      announce(
        error instanceof Error ? error.message : "Không nối tiếp được phiên tải lên.",
        "assertive",
      );
    }
  }, [resumeRequest, resumeSession]);

  // Thông báo kết quả một lần khi cả phiên tải lên kết thúc.
  const lastReported = useRef(0);
  useEffect(() => {
    if (summary.total === 0 || summary.isRunning || summary.active > 0) return;
    const finished = summary.completed + summary.failed + summary.duplicates + summary.cancelled;
    if (finished === 0 || finished === lastReported.current) return;
    lastReported.current = finished;
    if (summary.failed > 0) {
      announce(`Đã tải lên ${summary.completed} ảnh, ${summary.failed} ảnh lỗi.`);
    } else if (summary.completed > 0) {
      toastSuccess(
        `Đã tải lên ${formatCount(summary.completed)} ảnh gốc`,
        summary.duplicates > 0
          ? `${summary.duplicates} ảnh trùng nội dung đã được bỏ qua.`
          : undefined,
      );
    }
  }, [summary]);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      // Rào chắn "Đã đọc và xác nhận": chặn ngay khi CHƯA tick, trước khi
      // cần thêm tệp vào hàng đợi.
      if (ackPlanned === null) {
        announce("Hãy chờ một nhịp — trang đang chuẩn bị xác nhận điều khoản.", "assertive");
        return;
      }
      if (!ackPlanned && !ack) {
        announce(
          "Bạn cần tích vào ô 'Đã đọc và xác nhận' phía trên trước khi gửi ảnh.",
          "assertive",
        );
        return;
      }
      // Lần đầu tiên xác nhận xong — ghi nhớ vĩnh viễn cho trình duyệt này.
      if (!ackPlanned && ack) {
        markUploadAck();
        setAckPlanned(true);
      }
      if (!files || files.length === 0) return;
      const list = Array.from(files);
      const tooLarge = list.filter((file) => file.size > uploadLimitBytes);
      announce(`Đang thêm ${list.length} ảnh vào hàng đợi tải lên.`);
      addFiles(list);
      if (tooLarge.length > 0) {
        announce(
          `${tooLarge.length} tệp vượt giới hạn ${formatBytes(uploadLimitBytes)} mỗi ảnh.`,
          "assertive",
        );
      }
    },
    [addFiles, ack, ackPlanned],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      handleFiles(event.dataTransfer?.files ?? null);
    },
    [handleFiles],
  );

  const uploadsVisible = items.length > 0;

  return (
    <section aria-label="Tải ảnh lên" className={cn("space-y-3", compact && "text-sm")}>
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          "relative rounded-3xl border-2 border-dashed px-5 py-7 text-center transition-all duration-200",
          dragging
            ? "border-rose bg-pastel/50 scale-[1.01]"
            : "border-line bg-warm/70 hover:border-rose/40",
        )}
      >
        {/* CHECKBOX ĐÃ ĐỌC VÀ XÁC NHẬN — người dùng phải đọc rồi tick trước khi gửi */}
        {ackPlanned === false ? (
          <motion.label
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 flex max-w-md cursor-pointer items-start gap-3 rounded-2xl border border-rose/30 bg-pastel/40 px-4 py-3 text-left text-[12.5px] leading-relaxed"
          >
            <input
              type="checkbox"
              checked={ack}
              onChange={(event) => setAck(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-rose"
              aria-required="true"
            />
            <span>
              Tôi đã đọc{" "}
              <a
                href="/terms"
                target="_blank"
                className="font-medium text-rose-text underline underline-offset-2"
              >
                Điều khoản sử dụng
              </a>{" "}
              và{" "}
              <a
                href="/privacy"
                target="_blank"
                className="font-medium text-rose-text underline underline-offset-2"
              >
                Chính sách quyền riêng tư
              </a>
              , và xác nhận toàn bộ ảnh tôi gửi lên là của tôi hoặc tôi có quyền chia sẻ.
            </span>
          </motion.label>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          onChange={(event) => {
            handleFiles(event.target.files);
            // Cho phép chọn lại cùng tệp ở lần sau.
            event.target.value = "";
          }}
        />
        <motion.div
          animate={dragging ? { y: -3, scale: 1.06 } : { y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 26 }}
          className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-pastel/80 text-rose-text"
        >
          <UploadCloud className="size-5" aria-hidden />
        </motion.div>
        <p className="text-[14.5px] font-medium">
          {dragging ? "Thả ảnh để tải lên" : "Kéo thả ảnh vào đây"}
        </p>
        <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-ink-soft">
          Hoặc chọn tệp từ thiết bị. Ảnh gốc được lưu nguyên byte — không nén lại, không đổi định
          dạng, giữ nguyên tên tệp và metadata. Trần mỗi tệp {formatBytes(uploadLimitBytes)}, và tệp
          lớn được chia thành nhiều phần để có thể nối tiếp khi mất mạng.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button
            onClick={() => inputRef.current?.click()}
            icon={<ImageIcon className="size-4" aria-hidden />}
          >
            Chọn ảnh
          </Button>
          {uploadsVisible ? (
            <Button variant="ghost" onClick={() => setShowDetails((value) => !value)}>
              {showDetails ? "Ẩn chi tiết" : `Chi tiết (${items.length})`}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Tiến độ tổng */}
      <AnimatePresence>
        {uploadsVisible ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="rounded-3xl border border-line bg-warm/85 p-4"
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
              <span className="font-medium">
                {summary.completed}/{summary.total} ảnh xong
              </span>
              {summary.active > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-ink-soft">
                  <Loader2 className="size-3.5 animate-spin-slow" aria-hidden />
                  Đang tải {summary.active} tệp
                </span>
              ) : null}
              {summary.failed > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-danger">
                  <AlertCircle className="size-3.5" aria-hidden />
                  {summary.failed} lỗi
                </span>
              ) : null}
              {summary.duplicates > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-ink-soft">
                  <Copy className="size-3.5" aria-hidden />
                  {summary.duplicates} ảnh trùng
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-2">
                {summary.active > 0 ? (
                  <Button variant="ghost" size="sm" onClick={cancelAll}>
                    Huỷ tất cả
                  </Button>
                ) : null}
                {summary.failed > 0 ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={retryFailed}
                    icon={<RotateCcw className="size-3.5" aria-hidden />}
                  >
                    Thử lại
                  </Button>
                ) : null}
                {summary.active === 0 ? (
                  <Button variant="ghost" size="sm" onClick={clearFinished}>
                    Dọn danh sách
                  </Button>
                ) : null}
              </div>
            </div>

            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(summary.fraction * 100)}
              aria-label="Tiến độ tải lên"
            >
              <motion.div
                className="h-full rounded-full bg-rose"
                animate={{ width: `${(summary.fraction * 100).toFixed(1)}%` }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            </div>

            <AnimatePresence initial={false}>
              {showDetails || summary.failed > 0 ? (
                <motion.ul
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="mt-3 max-h-64 space-y-1.5 overflow-y-auto"
                >
                  {items.map((item) => (
                    <UploadRow
                      key={item.id}
                      item={item}
                      onCancel={() => cancelItem(item.id)}
                      onRetry={() => retryItem(item.id)}
                    />
                  ))}
                </motion.ul>
              ) : null}
            </AnimatePresence>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function UploadRow({
  item,
  onCancel,
  onRetry,
}: {
  item: UploadItem;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const statusLabel: Record<UploadItem["status"], string> = {
    pending: "Đang chờ",
    preparing: "Đang đọc dữ liệu",
    hashing: "Đang tính SHA-256 của tệp gốc",
    uploading: "Đang tải ảnh gốc lên",
    verifying: "Đang lưu metadata",
    completed: "Hoàn tất",
    failed: "Lỗi",
    cancelled: "Đã huỷ",
    duplicate: "Ảnh trùng — bỏ qua",
  };

  // Chi tiết RIÊNG của luồng nhiều phần: số phần đến từ server, nên đây là
  // tiến độ thật chứ không phải ước lượng của trình duyệt.
  const multipartDetail = item.multipart
    ? [
        `${item.multipart.completedParts.length}/${item.multipart.totalParts} phần`,
        `${formatBytes(item.multipart.uploadedBytes)} đã nằm trên kho lưu trữ`,
        item.multipart.sessionResumed ? "nối tiếp phiên cũ" : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <li className="flex items-center gap-3 rounded-2xl bg-blush/40 px-3 py-2">
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full",
          item.status === "completed"
            ? "bg-success/20 text-success"
            : item.status === "failed"
              ? "bg-danger/15 text-danger"
              : "bg-warm text-ink-soft",
        )}
      >
        {item.status === "completed" ? (
          <CheckCircle2 className="size-4" aria-hidden />
        ) : item.status === "failed" ? (
          <AlertCircle className="size-4" aria-hidden />
        ) : item.status === "duplicate" ? (
          <Copy className="size-3.5" aria-hidden />
        ) : (
          <Loader2 className="size-3.5 animate-spin-slow" aria-hidden />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium">
          {truncateMiddle(item.filename, 40)}
        </p>
        <p className="truncate text-[11.5px] text-ink-soft">
          {item.error ??
            `${statusLabel[item.status]} · ${formatBytes(item.fileSize)}${multipartDetail ? ` · ${multipartDetail}` : ""}`}
        </p>
        {["uploading", "preparing", "hashing", "verifying"].includes(item.status) ? (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-warm">
            <div
              className="h-full rounded-full bg-rose transition-[width] duration-200"
              style={{ width: `${(item.progress * 100).toFixed(1)}%` }}
            />
          </div>
        ) : null}
      </div>

      {item.status === "failed" ? (
        <Button variant="ghost" size="sm" onClick={onRetry} aria-label={`Thử lại ${item.filename}`}>
          Thử lại
        </Button>
      ) : null}
      {["pending", "preparing", "hashing", "uploading", "verifying"].includes(item.status) ? (
        <button
          type="button"
          onClick={onCancel}
          aria-label={`Huỷ tải lên ${item.filename}`}
          className="grid size-7 shrink-0 place-items-center rounded-full text-ink-soft transition-colors hover:bg-warm hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </li>
  );
}
